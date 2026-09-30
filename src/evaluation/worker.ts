import crypto from "crypto";
import { classifyModelFailure } from '@/lib/model/provider-unavailable';
import { DatabaseAdapter, getDatabaseAdapter } from "@/data/database";
import type { EvaluationContext } from "@/evaluation/context-contracts";
import { createBedrockGlmResearchModel } from "@/lib/model/bedrock-glm-research-model";
import { ProductionStagedEvaluationService } from "@/evaluation/service";
import { StagedServingPublisher } from '@/dossier/runtime/serving-publisher';
import { SqliteDossierCompositionQueue } from "@/data/sqlite/repositories/SqliteDossierCompositionQueue";
import {
  createStagedEvaluationFingerprint,
  parseCanonicalStagedDecisionResult,
} from "@/dossier/staged-decision-integrity";
import { createSqliteModelInvocationSink } from "@/lib/model/model-invocation";
import { EmptySourceEvidenceError } from '@/dossier/evidence';
import { DeterministicStagedInputUnavailableError } from "@/evaluation/staged-input";
import { SqliteStagedEvaluationStore, stagedUnavailableEvaluation } from "@/data/sqlite/repositories/SqliteStagedEvaluationStore";
import {supportsStagedPolicy} from '@/evaluation/policy';
import { EvaluationRuntimeControl } from "@/evaluation/runtime-control";

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
  private runtimeControl: EvaluationRuntimeControl;

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
    this.runtimeControl = new EvaluationRuntimeControl(this.db);
  }

  public async claimNextJob(contextFingerprint?: string): Promise<ClaimedJob | null> {
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
      `SELECT ej.id, ej.tenant_id, ej.person_id, ej.search_plan_id, ej.canonical_job_id,
              ej.opportunity_version, ej.evaluation_context_fingerprint, ej.attempts, ej.max_attempts
       FROM evaluation_jobs ej
       JOIN evaluation_requirements er
         ON er.tenant_id = ej.tenant_id
        AND er.person_id = ej.person_id
        AND er.search_plan_id = ej.search_plan_id
        AND er.canonical_job_id = ej.canonical_job_id
        AND er.opportunity_version = ej.opportunity_version
        AND er.evaluation_context_fingerprint = ej.evaluation_context_fingerprint
       WHERE er.status = 'READY'
         AND ej.status IN ('staged_pending', 'staged_processing')
         AND COALESCE((SELECT desired_state FROM evaluation_runtime_control c WHERE c.tenant_id=ej.tenant_id AND c.person_id=ej.person_id), 'STOPPED') = 'RUNNING'
         AND NOT EXISTS (
           SELECT 1
           FROM search_plan_candidates newer_spc
           JOIN opportunity_versions newer_ov
             ON newer_ov.id = newer_spc.opportunity_version
            AND newer_ov.canonical_job_id = newer_spc.canonical_job_id
           JOIN opportunity_versions current_ov
             ON current_ov.id = ej.opportunity_version
            AND current_ov.canonical_job_id = ej.canonical_job_id
           WHERE newer_spc.tenant_id = ej.tenant_id
             AND newer_spc.person_id = ej.person_id
             AND newer_spc.search_plan_id = ej.search_plan_id
             AND newer_spc.canonical_job_id = ej.canonical_job_id
             AND newer_ov.created_at > current_ov.created_at
         )
         ${contextFingerprint
           ? 'AND ej.evaluation_context_fingerprint = ?'
           : `AND EXISTS (
                SELECT 1
                FROM active_evaluation_contexts aec
                WHERE aec.tenant_id = ej.tenant_id
                  AND aec.person_id = ej.person_id
                  AND aec.search_plan_id = ej.search_plan_id
                  AND aec.context_fingerprint = ej.evaluation_context_fingerprint
              )`}
         AND ((ej.status = 'staged_pending' AND ej.next_attempt_at <= CURRENT_TIMESTAMP)
          OR (ej.status = 'staged_processing' AND ej.locked_at < datetime('now', '-300 seconds')))
       ORDER BY
         CASE WHEN ej.status = 'staged_processing' THEN 0 ELSE 1 END ASC,
         ej.next_attempt_at ASC,
         ej.created_at ASC
       LIMIT 1`,
      contextFingerprint ? [contextFingerprint] : [],
    );
    if (!job) return null;

    const leaseToken = crypto.randomUUID();
    const claimRes = await this.db.execute(
      `UPDATE evaluation_jobs
       SET status='staged_processing',
           locked_by=?, lease_token=?, locked_at=CURRENT_TIMESTAMP,
           first_claimed_at=COALESCE(first_claimed_at,CURRENT_TIMESTAMP)
       WHERE id=? AND (
         (status='staged_pending' AND next_attempt_at<=CURRENT_TIMESTAMP) OR
         (status='staged_processing' AND locked_at<datetime('now','-300 seconds'))
       )`,
      [this.workerId, leaseToken, job.id],
    );
    if (claimRes.rowsAffected === 0) return null;

    // Any prior running telemetry belongs to a process that lost/expired this
    // lease. Close it when reclaiming so the evaluator page never shows a
    // phantom provider call after the worker is gone.
    await this.db.execute(
      `UPDATE model_invocations
       SET status='transport_error', completed_at=COALESCE(completed_at,?),
           latency_ms=COALESCE(latency_ms, ?-started_at),
           error_code=COALESCE(error_code,'ORPHANED_WORKER_LEASE')
       WHERE evaluation_job_id=? AND status='running' AND started_at<?`,
      [Date.now(), Date.now(), job.id, Date.now() - 1],
    );

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
    // Reasoning can exceed the five-minute claim lease. Renew only the lease we
    // own; a replacement worker's token must never be extended by this worker.
    let renewal: Promise<void> | undefined;
    const heartbeat = setInterval(() => {
      if (renewal) return;
      renewal = this.db.execute(
        `UPDATE evaluation_jobs SET locked_at=CURRENT_TIMESTAMP WHERE id=? AND locked_by=? AND lease_token=? AND status='staged_processing'`,
        [job.id, this.workerId, job.leaseToken],
      ).then(() => {}).catch(() => {
        console.warn('[EvaluationWorker] Lease renewal failed; completion remains token-fenced', job.id);
      }).finally(() => { renewal = undefined; });
    }, 60_000);
    heartbeat.unref();
    try {
      return await this.processClaimedJob(job);
    } finally {
      clearInterval(heartbeat);
      await renewal;
    }
  }

  private async processClaimedJob(job: ClaimedJob): Promise<WorkerProcessingResult> {
    try {
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
         JOIN search_plan_snapshots sps ON sps.id=ec.search_plan_snapshot_id
         JOIN search_plans sp ON sp.id=sps.search_plan_id
         WHERE ec.context_fingerprint = ?
           AND ec.tenant_id = ?
           AND ec.person_id = ?
           AND sp.id = ? AND sp.tenant_id = ec.tenant_id AND sp.person_id = ec.person_id`,
        [job.evaluationContextFingerprint, job.tenantId, job.personId, job.searchPlanId]
      );

      if (!ctxRow) {
        throw new Error(`[EvaluationWorker] DURABLE_LINEAGE_MISMATCH for context: ${job.evaluationContextFingerprint}`);
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

      if (!supportsStagedPolicy(context.policyVersion)) {
        throw new Error(`UNSUPPORTED_EVALUATION_POLICY:${context.policyVersion}`);
      }

      const stagedStore = new SqliteStagedEvaluationStore(this.db);
      const identity = {
        tenantId: job.tenantId,
        personId: job.personId,
        canonicalJobId: job.canonicalJobId,
        opportunityVersion: job.opportunityVersion,
        evaluationContextFingerprint: job.evaluationContextFingerprint,
        profileVersion: context.profileVersion,
        policyVersion: context.policyVersion,
        ontologyVersion: context.ontologyVersion,
        ontologyFingerprint: context.ontologyFingerprint,
      };
      if (!isAcquired || !isLifecycleActive) {
        const unavailable = stagedUnavailableEvaluation(
          identity,
          !isAcquired ? 'CANONICAL_JD_UNAVAILABLE' : 'OPPORTUNITY_NOT_ACTIVE',
        );
        await stagedStore.save(unavailable);
        return this.commitDeterministicStagedFailure(job, unavailable.blockedReason!);
      }

      try {
        const invocationSink = createSqliteModelInvocationSink(this.db, {
          pipeline: "evaluation",
          evaluationJobId: job.id,
          tenantId: job.tenantId,
          personId: job.personId,
          canonicalJobId: job.canonicalJobId,
          opportunityVersion: job.opportunityVersion,
          evaluationContextFingerprint: job.evaluationContextFingerprint,
        });
        const evaluationModel = createBedrockGlmResearchModel({ invocationSink });
        const evaluated = await new ProductionStagedEvaluationService(
          this.db,
          evaluationModel,
        ).evaluate({ ...identity, context });
        await this.db.execute(
          `UPDATE evaluation_jobs
           SET evaluation_persisted_at=COALESCE(evaluation_persisted_at,?)
           WHERE id=? AND locked_by=? AND lease_token=? AND status='staged_processing'`,
          [evaluated.evaluatedAt, job.id, this.workerId, job.leaseToken],
        );

        const serving = await this.db.one<{ context_fingerprint: string }>(
          `SELECT context_fingerprint FROM active_evaluation_contexts
           WHERE tenant_id=? AND person_id=? AND search_plan_id=? AND context_fingerprint=?`,
          [job.tenantId, job.personId, job.searchPlanId, job.evaluationContextFingerprint],
        );
        if (serving && evaluated.decision !== 'PASS') {
          const staged = parseCanonicalStagedDecisionResult(evaluated.evaluation);
          const evaluationFingerprint = createStagedEvaluationFingerprint({
            evaluationContextFingerprint: evaluated.evaluationContextFingerprint,
            inputFingerprint: evaluated.inputFingerprint,
            evaluation: staged,
          });
          const compositionQueue = new SqliteDossierCompositionQueue(this.db);
          await compositionQueue.enqueue(identity, evaluationFingerprint);
          const compositionJob = await compositionQueue.find(identity, evaluationFingerprint);
          if (!compositionJob) throw new Error('DOSSIER_COMPOSITION_JOB_NOT_PERSISTED');
          await this.db.execute(
            `UPDATE evaluation_jobs
             SET dossier_queued_at=COALESCE(dossier_queued_at,?)
             WHERE id=? AND locked_by=? AND lease_token=? AND status='staged_processing'`,
            [new Date(compositionJob.created_at).toISOString(), job.id, this.workerId, job.leaseToken],
          );
          await new StagedServingPublisher(this.db).publish(identity, { allowPreparing: true });
        }
        return this.commitStagedCompletion(job, evaluated.decision);
      } catch (error) {
        if (error instanceof EmptySourceEvidenceError) {
          const reason = `SOURCE_EXTRACTION_EMPTY:${error.plane}`;
          await stagedStore.save(stagedUnavailableEvaluation(identity, reason));
          return this.commitDeterministicStagedFailure(job, reason);
        }
        if (error instanceof DeterministicStagedInputUnavailableError) {
          const unavailable = stagedUnavailableEvaluation(identity, error.reason);
          await stagedStore.save(unavailable);
          return this.commitDeterministicStagedFailure(job, error.reason);
        }
        throw error;
      }
    } catch (err: any) {
      const modelFailure = classifyModelFailure(err);
      if (modelFailure.transient) {
        // Release only our lease. Keep the requirement READY and do not consume
        // job attempts or classify provider access as a candidate/source failure.
        await this.db.execute(`UPDATE evaluation_jobs SET status=?,last_error=?,next_attempt_at=datetime('now','+' || ? || ' seconds'),locked_by=NULL,lease_token=NULL,locked_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND locked_by=? AND lease_token=? AND status=?`,
          ['staged_pending',`${modelFailure.code}: ${modelFailure.message}`,Math.ceil(modelFailure.retryAfterMs/1000),job.id,this.workerId,job.leaseToken,'staged_processing']);
        throw err;
      }
      const errorMsg = `${modelFailure.code}: ${modelFailure.message}`;
      const nextAttemptNumber = job.attempts + 1;
      const processingStatus = "staged_processing";
      const pendingStatus = "staged_pending";
      const deadLetterStatus = "staged_dead_letter";

      if (nextAttemptNumber < job.maxAttempts) {
        // Structured-output repair is a bounded semantic retry, not an
        // operational provider outage. It releases this lease immediately.
        const backoffSeconds = modelFailure.code === "MODEL_INVALID_OUTPUT"
          ? Math.max(1, Math.ceil(modelFailure.retryAfterMs / 1000))
          : 5 * Math.pow(2, job.attempts);
        const retryRes = await this.db.execute(
          `UPDATE evaluation_jobs
           SET status = ?,
               attempts = ?,
               last_error = ?,
               next_attempt_at = datetime('now', '+' || ? || ' seconds'),
               locked_by = NULL,
               lease_token = NULL,
               locked_at = NULL
           WHERE id = ? AND locked_by = ? AND lease_token = ? AND status = ?`,
          [pendingStatus, nextAttemptNumber, errorMsg, backoffSeconds, job.id, this.workerId, job.leaseToken, processingStatus]
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
           SET status = ?,
               attempts = ?,
               last_error = ?,
               locked_by = NULL,
               lease_token = NULL,
               locked_at = NULL
           WHERE id = ? AND locked_by = ? AND lease_token = ? AND status = ?`,
          [deadLetterStatus, nextAttemptNumber, errorMsg, job.id, this.workerId, job.leaseToken, processingStatus]
        );

        if (deadRes.rowsAffected === 0) {
          return {
            status: "stale_lease_lost",
            jobId: job.id,
            error: "Lease token lost during dead-letter transition",
          };
        }

        // Retry exhaustion parks only this evaluation job. The requirement remains
        // READY so an explicit Start/Resume can re-enter the same normal queue
        // after a semantic/provider fix without fabricating a source failure.
        return {
          status: "dead_letter",
          jobId: job.id,
          error: errorMsg,
        };
      }
    }
  }

  private async commitStagedCompletion(job: ClaimedJob, decision?: string): Promise<WorkerProcessingResult> {
    return this.completeStagedJob(job, 'SATISFIED', decision);
  }

  private async commitDeterministicStagedFailure(job: ClaimedJob, reason: string): Promise<WorkerProcessingResult> {
    return this.completeStagedJob(job, 'FAILED', undefined, `STAGED_INPUT_UNAVAILABLE:${reason}`);
  }

  private async completeStagedJob(job: ClaimedJob, requirementStatus: 'SATISFIED'|'FAILED', decision?: string, error?: string): Promise<WorkerProcessingResult> {
    return this.db.transaction(async tx => {
      const lease = await tx.one<{id:string}>(`SELECT id FROM evaluation_jobs WHERE id=? AND locked_by=? AND lease_token=? AND status='staged_processing'`, [job.id,this.workerId,job.leaseToken]);
      if (!lease) return {status:'stale_lease_lost' as const,jobId:job.id,error:'Lease token was lost before staged completion'};
      await tx.execute(`UPDATE evaluation_jobs SET status=?, completed_at=CURRENT_TIMESTAMP,last_error=?,locked_by=NULL,lease_token=NULL,locked_at=NULL WHERE id=? AND locked_by=? AND lease_token=? AND status='staged_processing'`, [requirementStatus==='SATISFIED'?'staged_completed':'staged_dead_letter',error??null,job.id,this.workerId,job.leaseToken]);
      await tx.execute(`UPDATE evaluation_requirements SET status=?, satisfied_at=CASE WHEN ?='SATISFIED' THEN CURRENT_TIMESTAMP ELSE satisfied_at END, blocked_reason=CASE WHEN ?='FAILED' THEN ? ELSE blocked_reason END WHERE tenant_id=? AND person_id=? AND search_plan_id=? AND canonical_job_id=? AND opportunity_version=? AND evaluation_context_fingerprint=?`, [requirementStatus,requirementStatus,requirementStatus,error??null,job.tenantId,job.personId,job.searchPlanId,job.canonicalJobId,job.opportunityVersion,job.evaluationContextFingerprint]);
      return {status: requirementStatus==='SATISFIED'?'completed' as const:'dead_letter' as const,jobId:job.id,decision,error};
    });
  }
  public async pollAndProcessNext(contextFingerprint?: string): Promise<WorkerProcessingResult | null> {
    const job = await this.claimNextJob(contextFingerprint);
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
