import { getRepositories } from "../../../data/sqlite/provider";
import { SqliteEvaluationStore } from "../../../data/sqlite/repositories/SqliteEvaluationStore";
import { OpportunityService } from "../opportunity-service";
import { candidateProfile } from "../../../data/candidate-profile";

export class EvaluationWorker {
  /**
   * Executes a single evaluation job cycle from the database job queue.
   */
  public static async processNextJob(workerId: string = `worker_${process.pid}`): Promise<boolean> {
    const repos = getRepositories();
    const evalStore = repos.evaluations;

    // 1. Claim next pending or expired job
    const job = await evalStore.claimJob(workerId, 5);
    if (!job) {
      return false; // Queue empty
    }

    try {
      // 2. Validate input hash freshness before running expensive evaluation
      const currentInputHash = SqliteEvaluationStore.computeInputHash(
        (candidateProfile as any).version || (candidateProfile as any).id || "v1",
        job.jobHash,
        "v4.1",
        "v2"
      );

      if (job.inputHash !== currentInputHash) {
        // Job inputs have been superseded by newer candidate profile or policy
        await evalStore.markJobFailed(job.id, "Superseded by newer input hash", true);
        return true;
      }

      // 3. Execute V4 evaluation engines for candidate-opportunity pair
      const recommendation = await OpportunityService.evaluateSingleOpportunity(job.personId, job.jobHash);

      if (!recommendation) {
        await evalStore.markJobFailed(job.id, "Opportunity or details unavailable for evaluation");
        return true;
      }

      // 4. Save materialized candidate evaluation record while protecting user overrides
      const engineVerdict = (["PURSUE", "CONSIDER", "PASS"].includes(recommendation.decision)
        ? recommendation.decision
        : "CONSIDER") as "PURSUE" | "CONSIDER" | "PASS";

      await evalStore.saveEvaluation({
        personId: job.personId,
        jobHash: job.jobHash,
        policyVersion: recommendation.policyVersion || "v4.1",
        evaluationInputHash: currentInputHash,
        engineVerdict,
        engineQualityScore: recommendation.score || 70.0,
        effectiveDecision: engineVerdict,
        qualityScore: recommendation.score || 70.0,
        evaluationStatus: "COMPLETE",
        evaluationJson: JSON.stringify(recommendation),
      });

      // 5. Mark job completed in queue
      await evalStore.markJobCompleted(job.id);
      return true;
    } catch (err: any) {
      await evalStore.markJobFailed(job.id, err?.message || String(err));
      return true;
    }
  }

  /**
   * Runs the worker loop until all pending jobs in queue are processed.
   */
  public static async processAllPending(workerId: string = `worker_${process.pid}`): Promise<number> {
    let count = 0;
    while (await this.processNextJob(workerId)) {
      count++;
    }
    return count;
  }

  private static isDaemonRunning = false;
  private static daemonAbortController: AbortController | null = null;

  /**
   * Starts a persistent background worker daemon that continuously polls and drains
   * the evaluation_jobs queue with idle backoff and graceful termination.
   */
  public static startDaemon(
    pollIntervalMs: number = 2000,
    workerId: string = `worker_daemon_${process.pid}`
  ): { stop: () => void; isRunning: () => boolean } {
    if (this.isDaemonRunning) {
      return {
        stop: () => this.stopDaemon(),
        isRunning: () => this.isDaemonRunning,
      };
    }

    this.isDaemonRunning = true;
    this.daemonAbortController = new AbortController();
    const signal = this.daemonAbortController.signal;

    (async () => {
      while (!signal.aborted) {
        try {
          const hadWork = await this.processNextJob(workerId);
          if (!hadWork) {
            // Queue empty: wait for poll interval before checking again
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          }
        } catch (err: any) {
          console.error("⚠️ [EvaluationDaemon] Unhandled loop error:", err?.message || err);
          await new Promise((resolve) => setTimeout(resolve, Math.max(pollIntervalMs * 2, 5000)));
        }
      }
      this.isDaemonRunning = false;
    })();

    return {
      stop: () => this.stopDaemon(),
      isRunning: () => this.isDaemonRunning,
    };
  }

  /**
   * Gracefully terminates the running evaluation worker daemon.
   */
  public static stopDaemon(): void {
    if (this.daemonAbortController) {
      this.daemonAbortController.abort();
      this.daemonAbortController = null;
    }
    this.isDaemonRunning = false;
  }
}
