import crypto from "crypto";
import { DatabaseAdapter, getDatabaseAdapter } from "@/data/database";
import { AuthContext, authorizePersonScope } from "@/lib/security/auth";
import { runEngineSingleIntrinsic } from "./engine";
import { validateCandidateProjection } from "../domain/candidate_projection";
import { validateEvaluationConsistency } from "@/lib/domain/evaluation_fingerprint";
import { buildCanonicalEvaluatedPayload, buildCanonicalUnavailablePayload, materializeCanonicalPayload, resolveArtifactEvaluationState } from "./evaluation/PayloadMapper";
import { buildCanonicalDossierPresentation } from "./dossier/CanonicalDossierBuilder";
import type { EvaluationContext } from "@/lib/domain/evaluation_context";
import type { OpportunitySource } from "@/data/opportunity-fixtures";
import { resolveExactCandidateProjectionForScope } from "@/data/sqlite/repositories/profile-projection-version";

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
      `SELECT ej.id, ej.tenant_id, ej.person_id, ej.search_plan_id, ej.canonical_job_id, ej.opportunity_version, ej.evaluation_context_fingerprint, ej.attempts, ej.max_attempts
       FROM evaluation_jobs ej
       LEFT JOIN evaluation_requirements er 
         ON er.tenant_id = ej.tenant_id 
        AND er.person_id = ej.person_id 
        AND er.search_plan_id = ej.search_plan_id 
        AND er.canonical_job_id = ej.canonical_job_id 
        AND er.opportunity_version = ej.opportunity_version 
        AND er.evaluation_context_fingerprint = ej.evaluation_context_fingerprint
       WHERE (er.status = 'READY' OR er.id IS NULL)
         AND ((ej.status = 'pending' AND ej.next_attempt_at <= CURRENT_TIMESTAMP)
          OR (ej.status = 'processing' AND ej.locked_at < datetime('now', '-300 seconds')))
       ORDER BY 
         CASE WHEN ej.status = 'processing' THEN 0 ELSE 1 END ASC,
         ej.next_attempt_at ASC, 
         ej.created_at ASC
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
        // Claimed work may never leave a lease stranded.  Treat scope failure
        // as a normal durable worker failure so the catch block releases or
        // dead-letters it under the job's retry policy.
        throw new Error(`AUTHORIZATION_FAILED: ${authErr?.message || "Authorization failed"}`);
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

      const ctxRow = await this.db.one<{
        search_plan_snapshot_id: string;
        ontology_version: string;
        ontology_fingerprint: string;
        policy_version: string;
        profile_version: string;
        created_at: string;
      }>(
        `SELECT ec.search_plan_snapshot_id,
                ec.ontology_version, ec.ontology_fingerprint,
                ec.policy_version, ec.profile_version, ec.created_at
         FROM evaluation_contexts ec
         WHERE ec.context_fingerprint = ?
           AND ec.tenant_id = ?
           AND ec.person_id = ?`,
        [job.evaluationContextFingerprint, job.tenantId, job.personId]
      );

      if (!ctxRow) {
        throw new Error(`[EvaluationWorker] Missing evaluation context for fingerprint: ${job.evaluationContextFingerprint}`);
      }

      const context: EvaluationContext = {
        contextFingerprint: job.evaluationContextFingerprint,
        tenantId: job.tenantId,
        personId: job.personId,
        searchPlanSnapshotId: ctxRow.search_plan_snapshot_id,
        ontologyVersion: ctxRow.ontology_version,
        ontologyFingerprint: ctxRow.ontology_fingerprint,
        policyVersion: ctxRow.policy_version,
        profileVersion: ctxRow.profile_version,
        createdAt: ctxRow.created_at || new Date().toISOString(),
      };

      // Dual Guard: Acquisition Trustworthiness + Active Lifecycle
      if (!isAcquired || !isLifecycleActive) {
        const evalState = (versionRow.lifecycle_state === "EXPIRED" || versionRow.lifecycle_state === "REMOVED_404")
          ? "EXPIRED"
          : (versionRow.acquisition_status === "CAPTURE_FAILED" || versionRow.acquisition_status === "RECOVERY_FAILED")
          ? "ACQUISITION_FAILED"
          : "ACQUISITION_PENDING";

        const unavailable = buildCanonicalUnavailablePayload(
          job.canonicalJobId,
          evalState,
          context,
          job.canonicalJobId,
          job.opportunityVersion,
          new Date().toISOString()
        );
        const materialized = materializeCanonicalPayload(unavailable);
        validateEvaluationConsistency(materialized);
        return await this.commitEvaluationMaterialization(job, materialized);
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
      oppSource.jobHash ||= job.canonicalJobId;

      const snapshotRow = await this.db.one<{ payload_json: string }>(
        `SELECT sps.payload_json
         FROM evaluation_contexts ec
         JOIN search_plan_snapshots sps ON ec.search_plan_snapshot_id = sps.id
         WHERE ec.context_fingerprint = ?
           AND ec.tenant_id = ?
           AND ec.person_id = ?`,
        [job.evaluationContextFingerprint, job.tenantId, job.personId]
      );

      if (!snapshotRow) {
        throw new Error(`[EvaluationWorker] Missing evaluation context snapshot for fingerprint: ${job.evaluationContextFingerprint}`);
      }

      // Authoritative Candidate Profile Resolution for (job.tenantId, job.personId)
      // 1. Authoritative candidate projection resolution via TenantScopedPersonStore
      // The immutable context pins the projection version. A later CV upload
      // must not change a queued job's candidate input.
      const rawProjection = await resolveExactCandidateProjectionForScope(
        this.db,
        { tenantId: job.tenantId, personId: job.personId },
        context.profileVersion,
      );
      if (!rawProjection) {
        // A missing profile is a domain state, not permission to evaluate a
        // synthetic executive. Persist an explicitly non-advisory result.
        const unavailable = buildCanonicalUnavailablePayload(
          oppSource.jobHash || job.canonicalJobId,
          "NOT_EVALUABLE",
          context,
          job.canonicalJobId,
          job.opportunityVersion,
          new Date().toISOString(),
        );
        const materialized = materializeCanonicalPayload(unavailable);
        validateEvaluationConsistency(materialized);
        return await this.commitEvaluationMaterialization(job, materialized);
      }
      const projection = rawProjection;

      // 2. CandidateProjection integrity verification
      const validation = validateCandidateProjection(projection);
      if (!validation.valid) {
        throw new Error(
          `[EvaluationWorker] Authoritative candidate projection for person '${job.personId}' failed integrity check: missing [${validation.missingFields.join(", ")}]`
        );
      }

      const artifact = runEngineSingleIntrinsic(
        oppSource.jobHash || job.canonicalJobId,
        projection,
        0,
        [oppSource]
      );

      if (!artifact) {
        throw new Error(`[EvaluationWorker] Intrinsic evaluation artifact missing for ${job.canonicalJobId}`);
      }

      const isGenuinelySparse =
        artifact.record?.verb === "SPARSE_SPEC" ||
        (versionRow.evidence_state === "GENUINELY_SPARSE" &&
          isAcquired &&
          versionRow.acquisition_quality === "COMPLETE");

      const evaluationState = isGenuinelySparse
        ? "SPARSE_SPEC"
        : resolveArtifactEvaluationState(artifact);
      const evaluatedAt = new Date().toISOString();
      const canonicalPayload = evaluationState === "EVALUATED"
        ? (() => {
            const intrinsic = buildCanonicalEvaluatedPayload(
              artifact, context, job.canonicalJobId, job.opportunityVersion, evaluatedAt,
            );
            return {
              ...intrinsic,
              dossierPresentation: buildCanonicalDossierPresentation(
                artifact,
                projection,
                intrinsic.evaluationInputHash,
                evaluatedAt,
                evaluatedAt,
              ),
            };
          })()
        : buildCanonicalUnavailablePayload(
            oppSource.jobHash || job.canonicalJobId,
            evaluationState,
            context,
            job.canonicalJobId,
            job.opportunityVersion,
            evaluatedAt
          );
      const materialized = materializeCanonicalPayload(canonicalPayload);
      materialized.evaluationFingerprint = evaluationState === "EVALUATED"
        ? canonicalPayload.evaluationInputHash
        : null;
      validateEvaluationConsistency(materialized);
      const isVetoed = Boolean(artifact.record?.vetoed ?? false);
      const vetoedScalar = isVetoed ? 1 : 0;

      return await this.commitEvaluationMaterialization(job, materialized);
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

        // Fail-Closed: Mark evaluation_requirement FAILED and fail referencing runs
        await this.db.execute(
          `UPDATE evaluation_requirements
           SET status = 'FAILED', blocked_reason = 'EVALUATION_DEAD_LETTER:' || ?
           WHERE tenant_id = ? AND person_id = ? AND search_plan_id = ?
             AND canonical_job_id = ? AND opportunity_version = ?
             AND evaluation_context_fingerprint = ?`,
          [
            errorMsg,
            job.tenantId,
            job.personId,
            job.searchPlanId,
            job.canonicalJobId,
            job.opportunityVersion,
            job.evaluationContextFingerprint,
          ]
        );

        // Fail referencing scrape runs
        await this.db.execute(
          `UPDATE scrape_runs
           SET status = 'failed', error_message = 'EVALUATION_DEAD_LETTER: ' || ?, finished_at = CURRENT_TIMESTAMP
           WHERE id IN (
             SELECT srer.run_id 
             FROM scrape_run_evaluation_requirements srer
             JOIN evaluation_requirements er ON srer.evaluation_requirement_id = er.id
             WHERE er.tenant_id = ? AND er.person_id = ? AND er.search_plan_id = ?
               AND er.canonical_job_id = ? AND er.opportunity_version = ?
               AND er.evaluation_context_fingerprint = ?
           ) AND status NOT IN ('completed', 'failed', 'aborted')`,
          [
            errorMsg,
            job.tenantId,
            job.personId,
            job.searchPlanId,
            job.canonicalJobId,
            job.opportunityVersion,
            job.evaluationContextFingerprint,
          ]
        );

        return {
          status: "dead_letter",
          jobId: job.id,
          error: errorMsg,
        };
      }
    }
  }

  private async commitEvaluationMaterialization(
    job: ClaimedJob,
    materialized: any
  ): Promise<WorkerProcessingResult> {
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
           evaluation_context_fingerprint, evaluation_fingerprint, evaluation_state, decision, quality_score,
           rationale, evidence_ids, evaluation_json, vetoed, materialized_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint) 
         DO UPDATE SET
           evaluation_state = EXCLUDED.evaluation_state,
           evaluation_fingerprint = EXCLUDED.evaluation_fingerprint,
           decision = EXCLUDED.decision,
           quality_score = EXCLUDED.quality_score,
           rationale = EXCLUDED.rationale,
           evidence_ids = EXCLUDED.evidence_ids,
           evaluation_json = EXCLUDED.evaluation_json,
           vetoed = EXCLUDED.vetoed,
           materialized_at = CURRENT_TIMESTAMP`,
        [
          materialized.id,
          job.tenantId,
          job.personId,
          job.canonicalJobId,
          job.opportunityVersion,
          job.evaluationContextFingerprint,
          materialized.evaluationFingerprint || null,
          materialized.evaluationState,
          materialized.decision || null,
          materialized.qualityScore || null,
          materialized.rationale || null,
          typeof materialized.evidenceIds === "string" ? materialized.evidenceIds : JSON.stringify(materialized.evidenceIds || []),
          materialized.evaluationJson,
          materialized.vetoed ? 1 : 0,
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

      // Mark requirement SATISFIED
      await tx.execute(
        `UPDATE evaluation_requirements
         SET status = 'SATISFIED', satisfied_at = CURRENT_TIMESTAMP
         WHERE tenant_id = ? AND person_id = ? AND search_plan_id = ?
           AND canonical_job_id = ? AND opportunity_version = ?
           AND evaluation_context_fingerprint = ?`,
        [
          job.tenantId,
          job.personId,
          job.searchPlanId,
          job.canonicalJobId,
          job.opportunityVersion,
          job.evaluationContextFingerprint,
        ]
      );

      return {
        status: "completed",
        jobId: job.id,
        decision: (materialized.decision ?? null) as any,
      };
    });
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
