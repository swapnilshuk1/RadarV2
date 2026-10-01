import { createHash } from "node:crypto";
import type { IngestOpportunityPayload, IngestScope } from "./ingestion-service";

export const HANDOFF_MAX_BYTES = 20 * 1024 * 1024;
export interface AcquisitionEnvelope {
  schemaVersion: 1;
  scope: Extract<IngestScope, { mode: "SCOPED" }>;
  payload: IngestOpportunityPayload;
  sourcePayloadBase64?: string;
}
export interface AcquisitionReference {
  submissionId: string;
  payloadKey: string;
  sha256: string;
  sizeBytes: number;
  lease: { owner: string; token: string };
}
export function byteHash(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
export function handoffPrefix(tenantId: string, personId: string): string {
  return `handoff/${byteHash(Buffer.from(tenantId))}/${byteHash(Buffer.from(personId))}/`;
}

export function encodeEnvelope(payload: IngestOpportunityPayload, scope: AcquisitionEnvelope["scope"]): Buffer {
  const { sourcePayload, ...material } = payload;
  const envelope: AcquisitionEnvelope = { schemaVersion: 1, scope, payload: material,
    ...(sourcePayload != null ? { sourcePayloadBase64: Buffer.from(sourcePayload).toString("base64") } : {}) };
  // Browser HTML is a local diagnostic artifact. Never serialize credential/session metadata.
  const bytes = Buffer.from(JSON.stringify(envelope, (key, value) => {
    if (/^(cookies?|authorization|password|accessToken|refreshToken|sessionToken|storageState)$/i.test(key)) {
      throw new Error("ACQUISITION_SESSION_MATERIAL_REJECTED");
    }
    return key === "rawHtml" ? undefined : value;
  }));
  if (bytes.length > HANDOFF_MAX_BYTES) throw new Error("ACQUISITION_PAYLOAD_TOO_LARGE");
  return bytes;
}

export function decodeEnvelope(bytes: Buffer): AcquisitionEnvelope {
  if (bytes.length > HANDOFF_MAX_BYTES) throw new Error("ACQUISITION_PAYLOAD_TOO_LARGE");
  const value = JSON.parse(bytes.toString()) as AcquisitionEnvelope;
  if (value.schemaVersion !== 1 || value.scope?.mode !== "SCOPED" ||
      ![value.scope.tenantId, value.scope.personId, value.scope.runId].every(v => typeof v === "string" && v.length > 0) ||
      !value.payload || ![value.payload.sourcePortal, value.payload.sourceJobId, value.payload.canonicalUrl,
        value.payload.jobTitle, value.payload.rawContent].every(v => typeof v === "string")) {
    throw new Error("ACQUISITION_ENVELOPE_INVALID");
  }
  return value;
}
