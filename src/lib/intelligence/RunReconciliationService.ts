import { DatabaseAdapter, getDatabaseAdapter } from "@/data/database";
import { SqliteScrapeRunStore } from "@/data/sqlite/repositories/SqliteScrapeRunStore";
import { EnrichmentQueue } from "../../../scripts/scraper/persist/queue";

export interface RunProgress {
  runId: string;
  status: string;
  enrichment: {
    total: number;
    completed: number;
    failed: number;
    processing: number;
    pending: number;
  };
  evaluation: {
    total: number;
    satisfied: number;
    waitingEnrichment: number;
    ready: number;
    failed: number;
  };
}

export class RunReconciliationService {
  private db: DatabaseAdapter;
  private runStore: SqliteScrapeRunStore;
  private enrichmentQueue: EnrichmentQueue;

  constructor(db?: DatabaseAdapter) {
    this.db = db || getDatabaseAdapter();
    this.runStore = new SqliteScrapeRunStore(this.db);
    this.enrichmentQueue = new EnrichmentQueue(this.db);
  }

  public async getRunProgress(runId: string): Promise<RunProgress | null> {
    const run = await this.runStore.systemGetRun(runId);
    if (!run) return null;

    const [enrichmentStats, evalProgress] = await Promise.all([
      this.enrichmentQueue.getRunStats(runId),
      this.runStore.getRunEvaluationProgress(runId),
    ]);

    return {
      runId,
      status: run.status,
      enrichment: {
        total: enrichmentStats.total,
        completed: enrichmentStats.completed,
        failed: enrichmentStats.failed,
        processing: enrichmentStats.processing,
        pending: enrichmentStats.pending,
      },
      evaluation: evalProgress,
    };
  }

  /**
   * Reconciles a single run based on its current enrichment & evaluation states.
   * State transitions:
   *   enriching -> completing (when all required enrichment jobs are complete)
   *   completing -> completed (when all required evaluation requirements are satisfied)
   *   * -> failed (if any required enrichment or evaluation permanently fails - fail-closed)
   */
  public async reconcileRun(runId: string): Promise<{ transitioned: boolean; newStatus: string }> {
    const run = await this.runStore.systemGetRun(runId);
    if (!run) return { transitioned: false, newStatus: "unknown" };

    // Terminal states do not transition
    if (["completed", "failed", "aborted"].includes(run.status)) {
      return { transitioned: false, newStatus: run.status };
    }

    const [enrichmentStats, evalProgress] = await Promise.all([
      this.enrichmentQueue.getRunStats(runId),
      this.runStore.getRunEvaluationProgress(runId),
    ]);

    // 0. Explicit durable check: Fail closed if acquisition reported unrecovered integrity failures
    let metrics: any = {};
    if (run.metricsJson) {
      try {
        metrics = typeof run.metricsJson === "string" ? JSON.parse(run.metricsJson) : run.metricsJson;
      } catch {}
    }
    if ((metrics?.acquisitionIntegrityFailures ?? 0) > 0) {
      await this.runStore.systemUpdateRunStatus(
        runId,
        "failed",
        `Acquisition integrity failure: ${metrics.acquisitionIntegrityFailures} fatal integrity failure(s) occurred during acquisition`
      );
      return { transitioned: true, newStatus: "failed" };
    }

    // 1. Fail-closed check: Any failed enrichment or evaluation fails the run
    if (enrichmentStats.failed > 0) {
      await this.runStore.systemUpdateRunStatus(
        runId,
        "failed",
        `Enrichment failure: ${enrichmentStats.failed} required enrichment job(s) failed`
      );
      return { transitioned: true, newStatus: "failed" };
    }

    if (evalProgress.failed > 0) {
      await this.runStore.systemUpdateRunStatus(
        runId,
        "failed",
        `Evaluation failure: ${evalProgress.failed} required evaluation obligation(s) failed`
      );
      return { transitioned: true, newStatus: "failed" };
    }

    // 2. enriching -> completing
    if (run.status === "enriching") {
      const enrichmentRemaining = enrichmentStats.pending + enrichmentStats.processing;
      if (enrichmentRemaining === 0) {
        await this.runStore.systemUpdateRunStatus(runId, "completing");
        // Also check if evaluations are already satisfied to transition immediately
        if (
          evalProgress.waitingEnrichment === 0 &&
          evalProgress.ready === 0 &&
          (evalProgress.total === 0 || evalProgress.satisfied === evalProgress.total)
        ) {
          await this.runStore.systemUpdateRunStatus(runId, "completed");
          return { transitioned: true, newStatus: "completed" };
        }
        return { transitioned: true, newStatus: "completing" };
      }
    }

    // 3. completing -> completed
    if (run.status === "completing") {
      if (
        evalProgress.waitingEnrichment === 0 &&
        evalProgress.ready === 0 &&
        (evalProgress.total === 0 || evalProgress.satisfied === evalProgress.total)
      ) {
        await this.runStore.systemUpdateRunStatus(runId, "completed");
        return { transitioned: true, newStatus: "completed" };
      }
    }

    return { transitioned: false, newStatus: run.status };
  }

  /**
   * Self-healing reconciler:
   * 1. Heals crash windows where enrichment completed but requirement stayed WAITING_ENRICHMENT
   * 2. Heals crash windows where requirement is READY:
   *    - no job -> create pending evaluation job
   *    - job in waiting_enrichment -> update to pending
   *    - job in pending / processing -> preserve
   *    - job completed + materialization exists -> transition requirement to SATISFIED
   *    - job dead_letter -> transition requirement to FAILED (do NOT resurrect)
   * 3. Heals crash windows where enrichment permanently failed -> transition requirement to FAILED
   */
  public async repairDanglingWork(): Promise<{ requirementsHealed: number; jobsCreated: number }> {
    let requirementsHealed = 0;
    let jobsCreated = 0;

    // 1. WAITING_ENRICHMENT -> READY when exact matching enrichment is COMPLETE
    const readyCandidates = await this.db.many<{
      id: string;
      tenant_id: string;
      person_id: string;
      search_plan_id: string;
      canonical_job_id: string;
      opportunity_version: string;
      evaluation_context_fingerprint: string;
    }>(
      `SELECT er.id, er.tenant_id, er.person_id, er.search_plan_id, er.canonical_job_id,
              er.opportunity_version, er.evaluation_context_fingerprint
       FROM evaluation_requirements er
       JOIN enrichment_jobs ej
         ON er.canonical_job_id = ej.canonical_job_id
        AND er.opportunity_version = ej.opportunity_version
        AND er.required_enrichment_pipeline_version = ej.pipeline_version
       WHERE er.status = 'WAITING_ENRICHMENT' AND ej.status = 'COMPLETE'`
    );

    for (const req of readyCandidates) {
      await this.db.execute(
        `UPDATE evaluation_requirements SET status = 'READY', ready_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'WAITING_ENRICHMENT'`,
        [req.id]
      );
      requirementsHealed++;
    }

    // 2. WAITING_ENRICHMENT -> FAILED when exact matching enrichment is FAILED
    const failedEnrichments = await this.db.many<{ id: string }>(
      `SELECT er.id
       FROM evaluation_requirements er
       JOIN enrichment_jobs ej
         ON er.canonical_job_id = ej.canonical_job_id
        AND er.opportunity_version = ej.opportunity_version
        AND er.required_enrichment_pipeline_version = ej.pipeline_version
       WHERE er.status = 'WAITING_ENRICHMENT' AND ej.status = 'FAILED'`
    );

    for (const req of failedEnrichments) {
      await this.db.execute(
        `UPDATE evaluation_requirements SET status = 'FAILED', blocked_reason = 'ENRICHMENT_FAILED' WHERE id = ? AND status = 'WAITING_ENRICHMENT'`,
        [req.id]
      );
      requirementsHealed++;
    }

    // 2b. WAITING_ENRICHMENT -> FAILED when NO matching enrichment job exists at all
    const missingEnrichments = await this.db.many<{ id: string }>(
      `SELECT er.id
       FROM evaluation_requirements er
       LEFT JOIN enrichment_jobs ej
         ON er.canonical_job_id = ej.canonical_job_id
        AND er.opportunity_version = ej.opportunity_version
        AND er.required_enrichment_pipeline_version = ej.pipeline_version
       WHERE er.status = 'WAITING_ENRICHMENT' AND ej.id IS NULL`
    );

    for (const req of missingEnrichments) {
      await this.db.execute(
        `UPDATE evaluation_requirements SET status = 'FAILED', blocked_reason = 'MISSING_ENRICHMENT_JOB' WHERE id = ? AND status = 'WAITING_ENRICHMENT'`,
        [req.id]
      );
      requirementsHealed++;
    }

    // 3. For all READY requirements, ensure evaluation job exists in appropriate state
    const readyReqs = await this.db.many<{
      id: string;
      tenant_id: string;
      person_id: string;
      search_plan_id: string;
      canonical_job_id: string;
      opportunity_version: string;
      evaluation_context_fingerprint: string;
    }>(
      `SELECT id, tenant_id, person_id, search_plan_id, canonical_job_id,
              opportunity_version, evaluation_context_fingerprint
       FROM evaluation_requirements
       WHERE status = 'READY'`
    );

    for (const req of readyReqs) {
      const job = await this.db.one<{ id: string; status: string }>(
        `SELECT id, status FROM evaluation_jobs
         WHERE tenant_id = ? AND search_plan_id = ? AND canonical_job_id = ?
           AND opportunity_version = ? AND evaluation_context_fingerprint = ?
         LIMIT 1`,
        [req.tenant_id, req.search_plan_id, req.canonical_job_id, req.opportunity_version, req.evaluation_context_fingerprint]
      );

      if (!job) {
        const evalJobId = `eval_${req.tenant_id}_${req.canonical_job_id}_${req.opportunity_version}_${req.evaluation_context_fingerprint.substring(0, 8)}`.replace(/[^a-zA-Z0-9_-]/g, "_");
        await this.db.execute(
          `INSERT INTO evaluation_jobs (
             id, tenant_id, person_id, search_plan_id, canonical_job_id,
             opportunity_version, evaluation_context_fingerprint, status, attempts, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(tenant_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
           DO UPDATE SET status = CASE WHEN evaluation_jobs.status = 'waiting_enrichment' THEN 'pending' ELSE evaluation_jobs.status END, updated_at = CURRENT_TIMESTAMP`,
          [
            evalJobId,
            req.tenant_id,
            req.person_id,
            req.search_plan_id,
            req.canonical_job_id,
            req.opportunity_version,
            req.evaluation_context_fingerprint,
          ]
        );
        jobsCreated++;
      } else if (job.status === "waiting_enrichment") {
        await this.db.execute(
          `UPDATE evaluation_jobs SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [job.id]
        );
      } else if (job.status === "dead_letter") {
        await this.db.execute(
          `UPDATE evaluation_requirements SET status = 'FAILED', blocked_reason = 'EVALUATION_JOB_DEAD_LETTER' WHERE id = ?`,
          [req.id]
        );
        requirementsHealed++;
      } else if (job.status === "completed") {
        const mat = await this.db.one<{ id: string }>(
          `SELECT id FROM materialized_evaluations
           WHERE tenant_id = ? AND person_id = ? AND canonical_job_id = ?
             AND opportunity_version = ? AND evaluation_context_fingerprint = ?
           LIMIT 1`,
          [req.tenant_id, req.person_id, req.canonical_job_id, req.opportunity_version, req.evaluation_context_fingerprint]
        );
        if (mat) {
          await this.db.execute(
            `UPDATE evaluation_requirements SET status = 'SATISFIED', satisfied_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [req.id]
          );
          requirementsHealed++;
        }
      }
    }

    return { requirementsHealed, jobsCreated };
  }

  /**
   * Targeted reconciliation for runs associated with a specific canonical job and version.
   */
  public async reconcileRunsForJob(
    canonicalJobId: string,
    opportunityVersion: string,
    pipelineVersion?: string
  ): Promise<void> {
    let query = `
      SELECT DISTINCT srer.run_id
      FROM scrape_run_evaluation_requirements srer
      JOIN evaluation_requirements er ON srer.evaluation_requirement_id = er.id
      WHERE er.canonical_job_id = ? AND er.opportunity_version = ?
    `;
    const params: unknown[] = [canonicalJobId, opportunityVersion];
    if (pipelineVersion) {
      query += ` AND er.required_enrichment_pipeline_version = ?`;
      params.push(pipelineVersion);
    }
    const rows = await this.db.many<{ run_id: string }>(query, params);

    for (const row of rows) {
      await this.reconcileRun(row.run_id);
    }
  }

  /**
   * Periodic global reconciliation sweep over all active runs.
   * Uses system-level queries without requiring a forged user context.
   */
  public async reconcileActiveRuns(): Promise<number> {
    // 1. Self-heal any dangling work across crash windows
    await this.repairDanglingWork();

    const activeRuns = await this.runStore.getSystemActiveRuns();
    let transitionedCount = 0;

    for (const run of activeRuns) {
      if (["enriching", "completing"].includes(run.status)) {
        const res = await this.reconcileRun(run.id);
        if (res.transitioned) transitionedCount++;
      }
    }

    return transitionedCount;
  }
}
