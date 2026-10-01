import { AcquisitionOutbox, type OutboxEntry } from "./outbox";
import { decodeEnvelope, type AcquisitionEnvelope, type AcquisitionReference } from "./handoff";
import type { CanonicalIngestionResult, IngestOpportunityPayload } from "./ingestion-service";

export class TransferIncompleteError extends Error {
  constructor(public readonly retryable: boolean, count: number, reason: string) {
    super(`ACQUISITION_TRANSFER_INCOMPLETE: ${count} payload(s) retained for recovery; ${reason}`);
    this.name = "TransferIncompleteError";
  }
}

/** A bounded uploader over the existing fsynced spool. No canonical receipt is invented. */
export class AcquisitionTransferSession {
  private readonly queued: string[] = [];
  private readonly scheduled = new Set<string>();
  private readonly active = new Set<Promise<void>>();
  private readonly failures = new Map<string, Error>();
  private accepting = true;

  constructor(private readonly outbox: AcquisitionOutbox,
    private readonly scope: AcquisitionEnvelope["scope"],
    private readonly lease: AcquisitionReference["lease"],
    private readonly apply: (entry: OutboxEntry, envelope: AcquisitionEnvelope, result: CanonicalIngestionResult) => Promise<void>,
    private readonly onError: (entry: OutboxEntry, error: Error) => void,
    private readonly concurrency = 2) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error("INVALID_TRANSFER_CONCURRENCY");
  }

  stage(payload: IngestOpportunityPayload, context: Record<string, unknown>): void {
    if (!this.accepting) throw new Error("TRANSFER_SESSION_CLOSED");
    // The local durability boundary finishes before upload is scheduled.
    this.schedule(this.outbox.stage(payload, this.scope, context));
  }

  recover(): void {
    for (const file of this.outbox.filesForRun(this.scope)) this.schedule(file);
  }

  private schedule(file: string): void {
    if (this.scheduled.has(file)) return;
    this.scheduled.add(file);
    this.queued.push(file);
    this.pump();
  }

  private pump(): void {
    while (this.queued.length && this.active.size < this.concurrency) {
      const file = this.queued.shift()!;
      let task: Promise<void>;
      task = Promise.resolve().then(async () => {
        const entry = this.outbox.read(file);
        const envelope = decodeEnvelope(Buffer.from(entry.bytesBase64, "base64"));
        if (envelope.scope.tenantId !== this.scope.tenantId || envelope.scope.personId !== this.scope.personId || envelope.scope.runId !== this.scope.runId) throw new Error("TRANSFER_SCOPE_MISMATCH");
        const result = await this.outbox.replay(file, this.lease);
        await this.apply(this.outbox.read(file), envelope, result);
        this.outbox.markApplied(file);
      }).catch(error => {
        const failure = error instanceof Error ? error : new Error(String(error));
        this.failures.set(file, failure);
        try { this.onError(this.outbox.read(file), failure); } catch { /* Keep the original failure and durable bytes. */ }
      }).finally(() => { this.active.delete(task); this.pump(); });
      this.active.add(task);
    }
  }

  async drain(): Promise<void> {
    this.accepting = false;
    while (this.active.size || this.queued.length) {
      this.pump();
      await Promise.all([...this.active]);
    }
    if (this.failures.size) {
      const errors = [...this.failures.values()];
      const retryable = errors.every(error => (error as { retryable?: boolean }).retryable ||
        (error as { code?: string }).code === "PERSISTENCE_UNAVAILABLE" ||
        error instanceof TypeError || error.name === "TimeoutError" || error.name === "AbortError" ||
        ["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code || ""));
      throw new TransferIncompleteError(retryable, errors.length, errors[0].message);
    }
  }
}
