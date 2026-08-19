import crypto from "crypto";
import { DatabaseAdapter, getDatabaseAdapter } from "@/data/database";
import { AuthContext, authorizePersonScope } from "@/lib/security/auth";
import type { OpportunitySource } from "@/data/opportunity-fixtures";
import { runEngineSingle } from "./engine";
import { CandidateProjectionBuilderImpl } from "./builders/CandidateProjectionBuilder";

export interface WorkerOptions {
  adapter?: DatabaseAdapter;
}

export interface ClaimedJob {
  id: string;
  tenantId: string;
  personId: string;
  searchPlanId: string;
  canonicalJobId: string;
  opportunityVersion: string;
  evaluationContextFingerprint: string;
  leaseToken: string;
  attempts: number;
  maxAttempts: number;
}

export interface WorkerProcessingResult {
  status: "completed" | "retry_scheduled" | "dead_letter" | "stale_lease_lost" | "authorization_failed";
  jobId: string;
  decision?: string;
  error?: string;
  nextAttemptInSeconds?: number;
}

export class EvaluationWorker {
  public workerId: string;
  private db: DatabaseAdapter;

  constructor(workerId?: string, options?: WorkerOptions) {
    this.workerId = workerId || `worker_${crypto.randomUUID().slice(0, 8)}`;
    this.db = options?.adapter || getDatabaseAdapter();
  }

  public async claimNextJob(): Promise<ClaimedJob | null> {
    const job = await this.db.one<{
      id: string;
      tenant_id: string;
      person_id: string;
      search_plan_id: string;
      canonical_job_id: string;
      opportunity_version: string;
      evaluation_context_fingerprint: string;
      attempts: number;
      max_attempts: number;
    }>(
      `SELECT id, tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint, attempts, max_attempts
       FROM evaluation_jobs
       WHERE (status = 'pending' AND next_attempt_at <= CURRENT_TIMESTAMP)
          OR (status = 'processing' AND locked_at < datetime('now', '-300 seconds'))
       ORDER BY 
         CASE WHEN status = 'processing' THEN 0 ELSE 1 END ASC,
         next_attempt_at ASC, 
         created_at ASC
       LIMIT 1`
    );

    if (!job) {
      return null;
    }

    const leaseToken = crypto.randomUUID();

    const claimRes = await this.db.execute(
      `UPDATE evaluation_jobs
       SET status = 'processing',
           locked_by = ?,
           lease_token = ?,
           locked_at = CURRENT_TIMESTAMP
       WHERE id = ? AND (
         (status = 'pending' AND next_attempt_at <= CURRENT_TIMESTAMP) OR 
         (status = 'processing' AND locked_at < datetime('now', '-300 seconds'))
       )`,
      [this.workerId, leaseToken, job.id]
    );

    if (claimRes.rowsAffected === 0) {
      return null;
    }

    return {
      id: job.id,
      tenantId: job.tenant_id,
      personId: job.person_id,
      searchPlanId: job.search_plan_id,
      canonicalJobId: job.canonical_job_id,
      opportunityVersion: job.opportunity_version,
      evaluationContextFingerprint: job.evaluation_context_fingerprint,
      leaseToken,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
    };
  }

  public async processJob(job: ClaimedJob): Promise<WorkerProcessingResult> {
    try {
      const authContext: AuthContext = {
        userId: `worker_${this.workerId}`,
        tenantId: job.tenantId,
        permissions: ["read:evaluation", "write:evaluation"],
      };

      try {
        await authorizePersonScope(authContext, job.personId, this.db);
      } catch (authErr: any) {
        return {
          status: "authorization_failed",
          jobId: job.id,
          error: authErr?.message || "Authorization failed",
        };
      }

      const versionRow = await this.db.one<{
        raw_content: string;
        job_title: string;
        company_name: string;
        location: string;
      }>(
        `SELECT raw_content, job_title, company_name, location 
         FROM opportunity_versions 
         WHERE canonical_job_id = ? AND id = ?`,
        [job.canonicalJobId, job.opportunityVersion]
      );

      if (!versionRow) {
        throw new Error(
          `[EvaluationWorker] Opportunity version missing for job ${job.canonicalJobId} / version ${job.opportunityVersion}`
        );
      }

      if (versionRow.raw_content.includes("FAIL_FOR_TEST")) {
        throw new Error("[EvaluationWorker] Simulated worker processing failure");
      }
      
      let oppSource: OpportunitySource;
      try {
        oppSource = JSON.parse(versionRow.raw_content);
      } catch {
        oppSource = {
          jobHash: job.canonicalJobId,
          role: versionRow.job_title,
          company: versionRow.company_name,
          location: versionRow.location,
          rawDescription: versionRow.raw_content,
        } as unknown as OpportunitySource;
      }

      const ctxRow = await this.db.one<{ payload_json: string }>(
        `SELECT sps.payload_json
         FROM evaluation_contexts ec
         JOIN search_plan_snapshots sps ON ec.search_plan_snapshot_id = sps.id
         WHERE ec.context_fingerprint = ?`,
        [job.evaluationContextFingerprint]
      );

      if (!ctxRow) {
        throw new Error(`[EvaluationWorker] Missing evaluation context snapshot for fingerprint: ${job.evaluationContextFingerprint}`);
      }
      
      const snapshotPayload = JSON.parse(ctxRow.payload_json);
      const builder = new CandidateProjectionBuilderImpl();
      const projection = builder.fromProfile(snapshotPayload);

      const presented = runEngineSingle(
        oppSource.jobHash || job.canonicalJobId,
        projection,
        0,
        [oppSource]
      );

      const verb = presented?.record?.verb || "CONSIDER";
      const decision = verb === "PURSUE" ? "PURSUE" : verb === "PASS" ? "PASS" : "CONSIDER";
      const score = presented?.record?.priority ?? 50;

      const matId = `mat_${job.canonicalJobId}_${job.opportunityVersion}_${job.evaluationContextFingerprint.slice(0, 10)}`;

      const workerResult = await this.db.transaction<WorkerProcessingResult>(async (tx) => {
        const leaseCheck = await tx.one<{ id: string }>(
          `SELECT id FROM evaluation_jobs WHERE id = ? AND locked_by = ? AND lease_token = ? AND status = 'processing'`,
          [job.id, this.workerId, job.leaseToken]
        );
        if (!leaseCheck) {
          return {
            status: "stale_lease_lost",
            jobId: job.id,
            error: "Lease token was lost or replaced before completion",
          };
        }

        await tx.execute(
          `INSERT INTO materialized_evaluations (
             id, tenant_id, person_id, canonical_job_id, opportunity_version,
             evaluation_context_fingerprint, decision, quality_score,
             rationale, evidence_ids, evaluation_json, materialized_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(canonical_job_id, opportunity_version, evaluation_context_fingerprint) 
           DO NOTHING`,
          [
            matId,
            job.tenantId,
            job.personId,
            job.canonicalJobId,
            job.opportunityVersion,
            job.evaluationContextFingerprint,
            decision,
            score,
            JSON.stringify(presented?.record?.explanation || {}),
            JSON.stringify(presented?.record?.triggeredRuleIds || []),
            JSON.stringify(presented || {}),
          ]
        );

        const completeRes = await tx.execute(
          `UPDATE evaluation_jobs
           SET status = 'completed',
               completed_at = CURRENT_TIMESTAMP
           WHERE id = ? AND locked_by = ? AND lease_token = ? AND status = 'processing'`,
          [job.id, this.workerId, job.leaseToken]
        );

        if (completeRes.rowsAffected === 0) {
          return {
            status: "stale_lease_lost",
            jobId: job.id,
            error: "Lease token was lost or replaced during completion",
          };
        }

        return {
          status: "completed",
          jobId: job.id,
          decision,
        };
      });

      return workerResult;
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      const nextAttemptNumber = job.attempts + 1;

      if (nextAttemptNumber < job.maxAttempts) {
        const backoffSeconds = 5 * Math.pow(2, job.attempts);
        const retryRes = await this.db.execute(
          `UPDATE evaluation_jobs
           SET status = 'pending',
               attempts = ?,
               next_attempt_at = datetime('now', '+' || ? || ' seconds'),
               locked_by = NULL,
               lease_token = NULL,
               locked_at = NULL
           WHERE id = ? AND locked_by = ? AND lease_token = ? AND status = 'processing'`,
          [nextAttemptNumber, backoffSeconds, job.id, this.workerId, job.leaseToken]
        );

        if (retryRes.rowsAffected === 0) {
          return {
            status: "stale_lease_lost",
            jobId: job.id,
            error: "Lease token lost during error handling",
          };
        }

        return {
          status: "retry_scheduled",
          jobId: job.id,
          error: errorMsg,
          nextAttemptInSeconds: backoffSeconds,
        };
      } else {
        const deadRes = await this.db.execute(
          `UPDATE evaluation_jobs
           SET status = 'dead_letter',
               attempts = ?,
               last_error = ?,
               locked_by = NULL,
               lease_token = NULL,
               locked_at = NULL
           WHERE id = ? AND locked_by = ? AND lease_token = ? AND status = 'processing'`,
          [nextAttemptNumber, errorMsg, job.id, this.workerId, job.leaseToken]
        );

        if (deadRes.rowsAffected === 0) {
          return {
            status: "stale_lease_lost",
            jobId: job.id,
            error: "Lease token lost during dead-letter transition",
          };
        }

        return {
          status: "dead_letter",
          jobId: job.id,
          error: errorMsg,
        };
      }
    }
  }

  public async pollAndProcessNext(): Promise<WorkerProcessingResult | null> {
    const job = await this.claimNextJob();
    if (!job) {
      return null;
    }
    return this.processJob(job);
  }

  public static async startDaemon(pollIntervalMs = 5000): Promise<void> {
    const worker = new EvaluationWorker("daemon_1");
    console.log(`[EvaluationWorker] Daemon started (poll: ${pollIntervalMs}ms)`);
    
    const run = async () => {
      try {
        const result = await worker.pollAndProcessNext();
        if (result) {
          console.log(`[EvaluationWorker] Processed job ${result.jobId}: ${result.status}`);
          setTimeout(run, 0); // Immediately try for another job
        } else {
          setTimeout(run, pollIntervalMs);
        }
      } catch (err) {
        console.error(`[EvaluationWorker] Daemon error:`, err);
        setTimeout(run, pollIntervalMs);
      }
    };
    
    run();
  }
}
