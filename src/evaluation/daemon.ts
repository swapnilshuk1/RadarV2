import crypto from "crypto";
import { classifyModelFailure } from "@/lib/model/provider-unavailable";
import { EvaluationWorker } from "@/evaluation/worker";
import { RunReconciliationService } from "@/lib/intelligence/RunReconciliationService";
import { getDatabaseAdapter, type DatabaseAdapter } from "@/data/database";
import { runtimeLog } from "@/lib/intelligence/runtime-log";

/** A global repair is crash recovery, not a per-poll health check. */
export const GLOBAL_RECONCILIATION_INTERVAL_MS = 5 * 60_000;
export const MAX_IDLE_POLL_INTERVAL_MS = 30_000;

export class EvaluationDaemon {
  private readonly workers: EvaluationWorker[];
  private readonly reconciler: RunReconciliationService;
  private isRunning = false;
  private abortController: AbortController | null = null;
  private readonly pollIntervalMs: number;
  private lastGlobalReconcileAt = 0;
  private reconciliationInFlight: Promise<void> | null = null;

  constructor(
    workerId?: string,
    pollIntervalMs = 5000,
    options?: { adapter?: DatabaseAdapter; concurrency?: number },
  ) {
    const id = workerId || `daemon_${crypto.randomUUID().slice(0, 8)}`;
    const concurrency =
      options?.concurrency ??
      Number(process.env.RADAR_EVALUATION_JOB_CONCURRENCY || "2");
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8)
      throw new Error("EVALUATION_JOB_CONCURRENCY_INVALID");
    this.workers = Array.from(
      { length: concurrency },
      (_value, index) =>
        new EvaluationWorker(`${id}_slot${index + 1}`, { adapter: options?.adapter }),
    );
    const adapter = options?.adapter ?? getDatabaseAdapter();
    this.reconciler = new RunReconciliationService(adapter);
    this.pollIntervalMs = pollIntervalMs;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    runtimeLog("info", "evaluation_daemon_started", { pollIntervalMs: this.pollIntervalMs, workers: this.workers.length });

    const loop = async (worker: EvaluationWorker, slot: number, idlePolls = 0) => {
      if (signal.aborted) return;
      try {
        const result = await worker.pollAndProcessNext();
        if (signal.aborted) return;

        // Job transitions reconcile their own runs. A full system scan is only
        // a slow crash-recovery safety net.
        if (Date.now() - this.lastGlobalReconcileAt >= GLOBAL_RECONCILIATION_INTERVAL_MS)
          void this.reconcileActiveRuns("safety");

        if (result) {
          runtimeLog("info", "evaluation_job_processed", { slot, jobId: result.jobId, status: result.status });
          if (result.error) {
            runtimeLog("warn", "evaluation_job_error", { slot, jobId: result.jobId, status: result.status });
          }
          setTimeout(() => void loop(worker, slot, 0), 0);
        } else {
          const nextIdlePolls = Math.min(idlePolls + 1, 4);
          const idleDelayMs = Math.min(
            this.pollIntervalMs * 2 ** nextIdlePolls,
            MAX_IDLE_POLL_INTERVAL_MS,
          );
          setTimeout(() => void loop(worker, slot, nextIdlePolls), idleDelayMs);
        }
      } catch (err: any) {
        if (signal.aborted) return;
        const modelFailure = classifyModelFailure(err);
        if (modelFailure.transient) {
          // The job has already released its lease with next_attempt_at. Do
          // not idle this worker slot through provider backoff: it can claim
          // unrelated eligible work immediately.
          runtimeLog("warn", "evaluation_model_retry_released", { slot, code: modelFailure.code });
          setTimeout(() => void loop(worker, slot, 0), 0);
          return;
        }
        runtimeLog("error", "evaluation_daemon_error", { slot, code: modelFailure.code });
        setTimeout(() => void loop(worker, slot, idlePolls), this.pollIntervalMs);
      }
    };

    // Repair dangling work once before accepting normal work. This preserves
    // crash recovery without making every daemon poll scan every active run.
    void this.reconcileActiveRuns("startup").finally(() => {
      if (!signal.aborted)
        this.workers.forEach((worker, index) => {
          void loop(worker, index + 1, 0);
        });
    });
  }

  private reconcileActiveRuns(reason: "startup" | "safety"): Promise<void> {
    if (this.reconciliationInFlight) return this.reconciliationInFlight;

    this.lastGlobalReconcileAt = Date.now();
    this.reconciliationInFlight = this.reconciler
      .reconcileActiveRuns()
      .then(() => {})
      .catch((recErr: any) => {
        runtimeLog("warn", "evaluation_reconciliation_error", { reason });
      })
      .finally(() => {
        this.reconciliationInFlight = null;
      });
    return this.reconciliationInFlight ?? Promise.resolve();
  }

  public stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isRunning = false;
    runtimeLog("info", "evaluation_daemon_stopped");
  }

  public get isDaemonRunning(): boolean {
    return this.isRunning;
  }

}
