import crypto from "crypto";
import { EvaluationWorker } from "./EvaluationWorker";
import type { DatabaseAdapter } from "@/data/database";

export class EvaluationDaemon {
  private worker: EvaluationWorker;
  private isRunning: boolean = false;
  private abortController: AbortController | null = null;
  private pollIntervalMs: number;

  constructor(workerId?: string, pollIntervalMs: number = 5000, options?: { adapter?: DatabaseAdapter }) {
    const id = workerId || `daemon_${crypto.randomUUID().slice(0, 8)}`;
    this.worker = new EvaluationWorker(id, options);
    this.pollIntervalMs = pollIntervalMs;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    console.log(`[EvaluationDaemon] Started orchestration loop (poll: ${this.pollIntervalMs}ms)`);

    const loop = async () => {
      if (signal.aborted) return;
      
      try {
        const result = await this.worker.pollAndProcessNext();
        
        if (signal.aborted) return;

        if (result) {
          // M5.4 Observability semantics
          console.log(`[EvaluationDaemon] Processed job ${result.jobId} - Status: ${result.status}`);
          
          if (result.error) {
            console.warn(`[EvaluationDaemon] Job ${result.jobId} encountered error: ${result.error}`);
          }
          
          // Immediate continuation to drain the queue if there's work
          setTimeout(loop, 0);
        } else {
          // Idle backoff
          setTimeout(loop, this.pollIntervalMs);
        }
      } catch (err: any) {
        if (signal.aborted) return;
        
        // M5.4 Isolation semantics: Daemon survives worker exceptions and continues polling
        console.error(`[EvaluationDaemon] Orchestrator exception survived:`, err?.message || err);
        setTimeout(loop, this.pollIntervalMs);
      }
    };

    loop();
  }

  public stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isRunning = false;
    console.log(`[EvaluationDaemon] Stopped orchestration loop.`);
  }

  public get isDaemonRunning(): boolean {
    return this.isRunning;
  }
}
