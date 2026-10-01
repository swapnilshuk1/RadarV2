import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { BlobStore } from "../lib/storage/blob-store";
import type { CanonicalIngestionResult, IngestOpportunityPayload } from "./ingestion-service";
import { byteHash, decodeEnvelope, encodeEnvelope, handoffPrefix, type AcquisitionEnvelope, type AcquisitionReference } from "./handoff";

interface Entry {
  reference: Omit<AcquisitionReference, "lease">;
  bytesBase64: string;
  result?: CanonicalIngestionResult;
}

function atomicWrite(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, "wx", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

/** Durable acquisition retry spool. Entries remain until an explicit retention operation. */
export class AcquisitionOutbox {
  constructor(private readonly directory: string, private readonly store: BlobStore,
    private readonly submit: (reference: AcquisitionReference) => Promise<CanonicalIngestionResult>) {}

  async acquire(payload: IngestOpportunityPayload, scope: AcquisitionEnvelope["scope"], lease: AcquisitionReference["lease"]) {
    const bytes = encodeEnvelope(payload, scope);
    const hash = byteHash(bytes);
    const file = path.join(this.directory, `${hash}.json`);
    if (!fs.existsSync(file)) {
      const entry = { reference: { submissionId: hash, sha256: hash,
        sizeBytes: bytes.length, payloadKey: `${handoffPrefix(scope.tenantId, scope.personId)}${hash}.json` }, bytesBase64: bytes.toString("base64") };
      const entries = fs.existsSync(this.directory) ? fs.readdirSync(this.directory).filter(n => n.endsWith(".json")) : [];
      const used = entries.reduce((n,name) => n+fs.statSync(path.join(this.directory,name)).size,0);
      if (entries.length >= 5000 || used+Buffer.byteLength(JSON.stringify(entry)) > 512 * 1024 * 1024) {
        throw new Error("ACQUISITION_OUTBOX_CAPACITY_EXCEEDED: pending entries are preserved");
      }
      atomicWrite(file, entry);
    }
    return this.replay(file, lease);
  }

  async replay(file: string, lease: AcquisitionReference["lease"]): Promise<CanonicalIngestionResult> {
    const entry = JSON.parse(fs.readFileSync(file, "utf8")) as Entry;
    if (entry.result) return entry.result;
    const bytes = Buffer.from(entry.bytesBase64, "base64");
    if (byteHash(bytes) !== entry.reference.sha256 || bytes.length !== entry.reference.sizeBytes) throw new Error("OUTBOX_INTEGRITY_FAILURE");
    await this.store.put(entry.reference.payloadKey, bytes, "application/json");
    if (!(await this.store.get(entry.reference.payloadKey))?.equals(bytes)) throw new Error("OUTBOX_UPLOAD_VERIFICATION_FAILED");
    const result = await this.submit({ ...entry.reference, lease });
    atomicWrite(file, { ...entry, result });
    return result;
  }

  async replayRun(runId: string, lease: AcquisitionReference["lease"]): Promise<number> {
    if (!fs.existsSync(this.directory)) return 0;
    let count = 0;
    for (const name of fs.readdirSync(this.directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      const file = path.join(this.directory, name);
      const entry = JSON.parse(fs.readFileSync(file, "utf8")) as Entry;
      if (!entry.result && decodeEnvelope(Buffer.from(entry.bytesBase64, "base64")).scope.runId === runId) {
        await this.replay(file, lease); count++;
      }
    }
    return count;
  }
}

export function remoteAcquisitionOutbox(store: BlobStore): AcquisitionOutbox {
  const endpoint = process.env.RADAR_ACQUISITION_INGRESS_URL;
  const tokenFile = process.env.RADAR_ACQUISITION_TOKEN_FILE;
  if (!endpoint || !tokenFile || new URL(endpoint).protocol !== "https:") throw new Error("HTTPS_ACQUISITION_INGRESS_AND_TOKEN_FILE_REQUIRED");
  const token = fs.readFileSync(tokenFile, "utf8").trim();
  if (token.length < 32) throw new Error("ACQUISITION_TOKEN_TOO_SHORT");
  return new AcquisitionOutbox(path.resolve(process.env.RADAR_ACQUISITION_OUTBOX_DIR || ".radar/acquisition-outbox"), store, async reference => {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(endpoint, { method: "POST", redirect: "error",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(reference), signal: AbortSignal.timeout(60_000) });
        if (!response.ok) {
          const error = Object.assign(new Error(`ACQUISITION_INGRESS_REJECTED: ${response.status}`),
            { retryable: response.status >= 500 || response.status === 429 });
          throw error;
        }
        return await response.json() as CanonicalIngestionResult;
      } catch (error) {
        const retryable = error instanceof TypeError || (error as { retryable?: boolean }).retryable ||
          (error as Error).name === "TimeoutError" || (error as Error).name === "AbortError";
        if (!retryable) throw error;
        if (attempt >= 4) throw Object.assign(new Error("ACQUISITION_HANDOFF_UNAVAILABLE: durable outbox retained"), { code: "PERSISTENCE_UNAVAILABLE" });
        await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
  });
}
