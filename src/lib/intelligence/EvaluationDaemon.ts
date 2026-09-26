import crypto from "crypto";
import { ModelProviderUnavailableError } from "../model/provider-unavailable";
import { EvaluationWorker } from "./EvaluationWorker";
import { RunReconciliationService } from "./RunReconciliationService";
import { getDatabaseAdapter, type DatabaseAdapter } from "@/data/database";
import { EvaluationRuntimeControl } from "./EvaluationRuntimeControl";

/** A global repair is crash recovery, not a per-poll health check. */
export const GLOBAL_RECONCILIATION_INTERVAL_MS = 5 * 60_000;

export class EvaluationDaemon {
  private readonly workers: EvaluationWorker[];
  private readonly reconciler: RunReconciliationService;
  private readonly runtimeControl: EvaluationRuntimeControl;
  private isRunning = false;
  private lastObservedControlState: "RUNNING" | "PAUSED" | "STOPPED" | null = null;
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
    this.runtimeControl = new EvaluationRuntimeControl(adapter);
    this.pollIntervalMs = pollIntervalMs;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    console.log(
      `[EvaluationDaemon] Started orchestration loop (poll: ${this.pollIntervalMs}ms, jobs: ${this.workers.length})`,
    );

    const loop = async (worker: EvaluationWorker, slot: number) => {
      if (signal.aborted) return;
      try {

        const result = await worker.pollAndProcessNext();
        if (signal.aborted) return;

        // Job transitions reconcile their own runs. A full system scan is only
        // a slow crash-recovery safety net.
        if (Date.now() - this.lastGlobalReconcileAt >= GLOBAL_RECONCILIATION_INTERVAL_MS)
          void this.reconcileActiveRuns("safety");

        if (result) {
          console.log(
            `[EvaluationDaemon] Slot ${slot} processed job ${result.jobId} - Status: ${result.status}`,
          );
          if (result.error) {
            console.warn(
              `[EvaluationDaemon] Job ${result.jobId} encountered error: ${result.error}`,
            );
          }
          setTimeout(() => void loop(worker, slot), 0);
        } else {
          setTimeout(() => void loop(worker, slot), this.pollIntervalMs);
        }
      } catch (err: any) {
        if (signal.aborted) return;
        if (err instanceof ModelProviderUnavailableError) {
          console.error(
            `[EvaluationDaemon] Slot ${slot} model provider unavailable; paused for ${Math.ceil(err.retryAfterMs / 1000)} seconds: ${err.message}`,
          );
          setTimeout(() => void loop(worker, slot), err.retryAfterMs);
          return;
        }
        console.error(
          `[EvaluationDaemon] Slot ${slot} orchestrator exception survived:`,
          err?.message || err,
        );
        setTimeout(() => void loop(worker, slot), this.pollIntervalMs);
      }
    };

    // Repair dangling work once before accepting normal work. This preserves
    // crash recovery without making every daemon poll scan every active run.
    void this.reconcileActiveRuns("startup").finally(() => {
      if (!signal.aborted)
        this.workers.forEach((worker, index) => {
          void loop(worker, index + 1);
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
        console.warn(
          `[EvaluationDaemon] ${reason === "startup" ? "Startup" : "Safety"} active-run reconciliation error:`,
          recErr?.message || recErr,
        );
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
    console.log("[EvaluationDaemon] Stopped orchestration loop.");
  }

  public get isDaemonRunning(): boolean {
    return this.isRunning;
  }

  public static getGlobalDaemon(
    pollIntervalMs = 2000,
    options?: { adapter?: DatabaseAdapter; concurrency?: number },
  ): EvaluationDaemon {
    const g = globalThis as any;
    if (!g.__RADAR_EVALUATION_DAEMON__) {
      g.__RADAR_EVALUATION_DAEMON__ = new EvaluationDaemon(
        `daemon_singleton_${process.pid || "node"}`,
        pollIntervalMs,
        options,
      );
    }
    return g.__RADAR_EVALUATION_DAEMON__;
  }

  public static startGlobalDaemon(
    pollIntervalMs = 2000,
    options?: { adapter?: DatabaseAdapter; concurrency?: number },
  ): EvaluationDaemon {
    const daemon = EvaluationDaemon.getGlobalDaemon(pollIntervalMs, options);
    if (!daemon.isDaemonRunning) daemon.start();
    return daemon;
  }

  public static stopGlobalDaemon(): void {
    const g = globalThis as any;
    const daemon = g.__RADAR_EVALUATION_DAEMON__ as EvaluationDaemon | undefined;
    daemon?.stop();
  }

  public static getGlobalDaemonRuntimeStatus(): {
    exists: boolean;
    running: boolean;
  } {
    const g = globalThis as any;
    const daemon = g.__RADAR_EVALUATION_DAEMON__ as EvaluationDaemon | undefined;
    return {
      exists: Boolean(daemon),
      running: Boolean(daemon?.isDaemonRunning),
    };
  }
}
