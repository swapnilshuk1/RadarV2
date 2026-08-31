import crypto from "crypto";
import { DatabaseAdapter, getDatabaseAdapter } from "@/data/database";
import { AuthContext, authorizePersonScope, type AuthorizedPersonScope } from "@/lib/security/auth";
import { runEngineSingle } from "./engine";
import { validateCandidateProjection, DEFAULT_CANDIDATE_PROJECTION } from "../domain/candidate_projection";
import { TenantScopedPersonStore } from "@/data/sqlite/repositories/TenantScopedPersonStore";
import { computeEvaluationIdentity } from "@/lib/domain/evaluation_fingerprint";
import type { OpportunitySource } from "@/data/opportunity-fixtures";

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

  constructor(workerIdOrDb?: string | DatabaseAdapter, optionsOrWorkerId?: WorkerOptions | string) {
    if (typeof workerIdOrDb === "string") {
      this.workerId = workerIdOrDb;
      this.db = (optionsOrWorkerId as WorkerOptions)?.adapter || getDatabaseAdapter();
    } else if (workerIdOrDb && typeof workerIdOrDb === "object") {
      this.db = workerIdOrDb as DatabaseAdapter;
      this.workerId = (typeof optionsOrWorkerId === "string" ? optionsOrWorkerId : undefined) || `worker_${crypto.randomUUID().slice(0, 8)}`;
    } else {
      this.workerId = `worker_${crypto.randomUUID().slice(0, 8)}`;
      this.db = getDatabaseAdapter();
    }
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
        acquisition_status: string;
        acquisition_quality: string;
        lifecycle_state: string;
        evidence_state: string;
      }>(
        `SELECT raw_content, job_title, company_name, location,
                acquisition_status, acquisition_quality, lifecycle_state, evidence_state 
         FROM opportunity_versions 
         WHERE canonical_job_id = ? AND id = ?`,
        [job.canonicalJobId, job.opportunityVersion]
      );

      if (!versionRow) {
        throw new Error(
          `[EvaluationWorker] Opportunity version missing for job ${job.canonicalJobId} / version ${job.opportunityVersion}`
        );
      }

      if ((versionRow.raw_content || "").includes("FAIL_FOR_TEST")) {
        throw new Error("[EvaluationWorker] Simulated worker processing failure");
      }

      const isAcquired = versionRow.acquisition_status === "ACQUIRED";
      const isLifecycleActive = versionRow.lifecycle_state === "ACTIVE";

      // Dual Guard: Acquisition Trustworthiness + Active Lifecycle
      if (!isAcquired || !isLifecycleActive) {
        const evalState = (versionRow.lifecycle_state === "EXPIRED" || versionRow.lifecycle_state === "REMOVED_404")
          ? "EXPIRED"
          : (versionRow.acquisition_status === "CAPTURE_FAILED" || versionRow.acquisition_status === "RECOVERY_FAILED")
          ? "ACQUISITION_FAILED"
          : "ACQUISITION_PENDING";

        const evalIdentity = computeEvaluationIdentity(
          job.canonicalJobId,
          job.opportunityVersion,
          job.evaluationContextFingerprint
        );
        const matId = `mat_${crypto.randomUUID()}`;

        return await this.db.transaction<WorkerProcessingResult>(async (tx) => {
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
               evaluation_context_fingerprint, evaluation_state, decision, quality_score,
               rationale, evidence_ids, evaluation_json, vetoed, materialized_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, 0, CURRENT_TIMESTAMP)
             ON CONFLICT(tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint) 
             DO UPDATE SET
               evaluation_state = EXCLUDED.evaluation_state,
               decision = EXCLUDED.decision,
               quality_score = EXCLUDED.quality_score,
               rationale = EXCLUDED.rationale,
               evidence_ids = EXCLUDED.evidence_ids,
               evaluation_json = EXCLUDED.evaluation_json,
               vetoed = EXCLUDED.vetoed,
               materialized_at = CURRENT_TIMESTAMP`,
            [
              matId,
              job.tenantId,
              job.personId,
              job.canonicalJobId,
              job.opportunityVersion,
              job.evaluationContextFingerprint,
              evalState,
              JSON.stringify({ status: evalState, reason: "Bypassed evaluation: capture untrusted or job inactive" }),
              JSON.stringify([]),
              JSON.stringify({ evaluationState: evalState, bypassed: true }),
            ]
          );

          await tx.execute(
            `UPDATE evaluation_jobs
             SET status = 'completed',
                 completed_at = CURRENT_TIMESTAMP
             WHERE id = ? AND locked_by = ? AND lease_token = ? AND status = 'processing'`,
            [job.id, this.workerId, job.leaseToken]
          );

          return {
            status: "completed",
            jobId: job.id,
            decision: null as any,
          };
        });
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
         WHERE ec.context_fingerprint = ?
           AND ec.tenant_id = ?
           AND ec.person_id = ?`,
        [job.evaluationContextFingerprint, job.tenantId, job.personId]
      );

      if (!ctxRow) {
        throw new Error(`[EvaluationWorker] Missing evaluation context snapshot for fingerprint: ${job.evaluationContextFingerprint}`);
      }

      // Authoritative Candidate Profile Resolution for (job.tenantId, job.personId)
      // 1. Authoritative candidate projection resolution via TenantScopedPersonStore
      const scope: AuthorizedPersonScope = {
        tenantId: job.tenantId,
        personId: job.personId,
      };
      const personStore = new TenantScopedPersonStore(this.db, scope);
      const rawProjection = await personStore.getLatestProjection(job.personId);
      const projection = rawProjection || DEFAULT_CANDIDATE_PROJECTION;

      // 2. CandidateProjection integrity verification
      const validation = validateCandidateProjection(projection);
      if (!validation.valid) {
        throw new Error(
          `[EvaluationWorker] Authoritative candidate projection for person '${job.personId}' failed integrity check: missing [${validation.missingFields.join(", ")}]`
        );
      }

      const presented = runEngineSingle(
        oppSource.jobHash || job.canonicalJobId,
        projection,
        0,
        [oppSource]
      );

      const rawVerb = presented?.record?.verb || presented?.opportunity?.decision || "CONSIDER";

      const isGenuinelySparse =
        (rawVerb === "SPARSE_SPEC" || versionRow.evidence_state === "GENUINELY_SPARSE") &&
        isAcquired &&
        versionRow.acquisition_quality === "COMPLETE";

      const evaluationState = isGenuinelySparse ? "SPARSE_SPEC" : "EVALUATED";
      const decision = isGenuinelySparse ? null : (rawVerb === "PURSUE" ? "PURSUE" : rawVerb === "PASS" ? "PASS" : "CONSIDER");
      const score = isGenuinelySparse ? null : (presented?.record?.priority ?? 50);
      const isVetoed = Boolean(presented?.record?.vetoed ?? (presented as any)?.vetoed ?? false);
      const vetoedScalar = isVetoed ? 1 : 0;

      const matId = `mat_${crypto.randomUUID()}`;

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
             evaluation_context_fingerprint, evaluation_state, decision, quality_score,
             rationale, evidence_ids, evaluation_json, vetoed, materialized_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint) 
           DO UPDATE SET
             evaluation_state = EXCLUDED.evaluation_state,
             decision = EXCLUDED.decision,
             quality_score = EXCLUDED.quality_score,
             rationale = EXCLUDED.rationale,
             evidence_ids = EXCLUDED.evidence_ids,
             evaluation_json = EXCLUDED.evaluation_json,
             vetoed = EXCLUDED.vetoed,
             materialized_at = CURRENT_TIMESTAMP`,
          [
            matId,
            job.tenantId,
            job.personId,
            job.canonicalJobId,
            job.opportunityVersion,
            job.evaluationContextFingerprint,
            evaluationState,
            decision,
            score,
            JSON.stringify(presented?.record?.explanation || {}),
            JSON.stringify(presented?.record?.triggeredRuleIds || []),
            JSON.stringify(presented || {}),
            vetoedScalar,
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
          decision: decision as any,
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
               last_error = ?,
               next_attempt_at = datetime('now', '+' || ? || ' seconds'),
               locked_by = NULL,
               lease_token = NULL,
               locked_at = NULL
           WHERE id = ? AND locked_by = ? AND lease_token = ? AND status = 'processing'`,
          [nextAttemptNumber, errorMsg, backoffSeconds, job.id, this.workerId, job.leaseToken]
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

  /**
   * Drains all pending evaluation jobs in the queue until empty or maxJobs reached.
   * Enables autonomous pipeline completion during scrape runs or background processing.
   */
  public async drainQueue(options?: { maxJobs?: number; timeoutMs?: number; concurrency?: number }): Promise<{
    processed: number;
    completed: number;
    failed: number;
  }> {
    const maxJobs = options?.maxJobs ?? 1000;
    const timeoutMs = options?.timeoutMs ?? 180000;
    const concurrency = Math.max(1, options?.concurrency ?? 3);
    const startTime = Date.now();
    let processed = 0;
    let completed = 0;
    let failed = 0;

    const runWorkerLoop = async (workerIdx: number) => {
      const workerInstance = new EvaluationWorker(this.db, `${this.workerId}_${workerIdx}`);
      let emptyPolls = 0;
      while (processed < maxJobs && (Date.now() - startTime) < timeoutMs) {
        const result = await workerInstance.pollAndProcessNext();
        if (!result) {
          emptyPolls++;
          if (emptyPolls >= 3) {
            break; // Queue is fully drained
          }
          await new Promise((r) => setTimeout(r, 150));
          continue;
        }
        emptyPolls = 0;
        processed++;
        if (result.status === "completed") {
          completed++;
        } else {
          failed++;
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, (_, i) => runWorkerLoop(i)));

    return { processed, completed, failed };
  }
}
