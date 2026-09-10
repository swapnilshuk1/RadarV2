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
   * Targeted reconciliation for runs associated with a specific canonical job and version.
   */
  public async reconcileRunsForJob(
    canonicalJobId: string,
    opportunityVersion: string
  ): Promise<void> {
    const rows = await this.db.many<{ run_id: string }>(
      `SELECT DISTINCT srer.run_id
       FROM scrape_run_evaluation_requirements srer
       JOIN evaluation_requirements er ON srer.evaluation_requirement_id = er.id
       WHERE er.canonical_job_id = ? AND er.opportunity_version = ?`,
      [canonicalJobId, opportunityVersion]
    );

    for (const row of rows) {
      await this.reconcileRun(row.run_id);
    }
  }

  /**
   * Periodic global reconciliation sweep over all active runs.
   * Uses system-level queries without requiring a forged user context.
   */
  public async reconcileActiveRuns(): Promise<number> {
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
