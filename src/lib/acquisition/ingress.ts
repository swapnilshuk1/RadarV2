import crypto from "crypto";
import { getDatabaseAdapter, type DatabaseAdapter } from "@/data/database";
import { CanonicalIngestionService, computeContentHash, type CanonicalIngestionResult, type IngestOpportunityPayload } from "./CanonicalIngestionService";

export const ACQUISITION_ENVELOPE_VERSION = "1";
export const ACQUISITION_INGRESS_PATH = "/api/acquisition/ingress";
export const MAX_ACQUISITION_ENVELOPE_BYTES = 2 * 1024 * 1024;

export interface AcquisitionEnvelope {
  schemaVersion: typeof ACQUISITION_ENVELOPE_VERSION;
  submissionId: string;
  runId: string;
  tenantId: string;
  personId: string;
  searchPlanId?: string | null;
  contentHash: string;
  payload: IngestOpportunityPayload;
}

export class AcquisitionIngressError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "AcquisitionIngressError"; }
}

export function parseAcquisitionEnvelope(value: unknown): AcquisitionEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AcquisitionIngressError(400, "MALFORMED_ENVELOPE");
  const input = value as Record<string, unknown>;
  const text = (key: string, max = 512) => {
    const item = input[key];
    if (typeof item !== "string" || !item.trim() || item.length > max) throw new AcquisitionIngressError(400, `INVALID_${key.toUpperCase()}`);
    return item.trim();
  };
  if (input.schemaVersion !== ACQUISITION_ENVELOPE_VERSION) throw new AcquisitionIngressError(400, "UNSUPPORTED_ENVELOPE_VERSION");
  if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) throw new AcquisitionIngressError(400, "INVALID_PAYLOAD");
  const payload = input.payload as IngestOpportunityPayload;
  for (const key of ["sourcePortal", "sourceJobId", "canonicalUrl", "jobTitle", "rawContent"] as const) {
    if (typeof payload[key] !== "string" || !payload[key].trim()) throw new AcquisitionIngressError(400, `INVALID_PAYLOAD_${key.toUpperCase()}`);
  }
  if (!payload.enrichmentDispatch?.detailedCard || !payload.enrichmentDispatch.pipelineVersion) {
    throw new AcquisitionIngressError(400, "MISSING_IMMUTABLE_ENRICHMENT_PAYLOAD");
  }
  // A producer may transmit document bytes, never a path into its laptop.  The
  // canonical service allocates the durable BlobStore key on Oracle before it
  // admits the opportunity, so a client-local path cannot become provenance.
  if (payload.sourcePayloadKey && (payload.sourcePayloadKey.startsWith("/") || payload.sourcePayloadKey.startsWith("~") || /^[a-zA-Z]:[\\/]/.test(payload.sourcePayloadKey))) {
    throw new AcquisitionIngressError(400, "LAPTOP_LOCAL_SOURCE_REFERENCE_REJECTED");
  }
  const envelope: AcquisitionEnvelope = {
    schemaVersion: ACQUISITION_ENVELOPE_VERSION,
    submissionId: text("submissionId", 160), runId: text("runId", 160), tenantId: text("tenantId", 160), personId: text("personId", 160),
    searchPlanId: input.searchPlanId == null ? null : text("searchPlanId", 160), contentHash: text("contentHash", 128), payload,
  };
  if (!/^[a-f0-9]{64}$/i.test(envelope.contentHash)) throw new AcquisitionIngressError(400, "INVALID_CONTENT_HASH");
  const actual = computeContentHash({ title: payload.jobTitle.trim(), companyName: payload.companyName?.trim() || null, location: payload.location || null, employmentType: payload.employmentType || null, rawContent: payload.rawContent.trim() });
  if (!crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(envelope.contentHash.toLowerCase()))) throw new AcquisitionIngressError(422, "CONTENT_HASH_MISMATCH");
  return envelope;
}

export class AcquisitionIngressService {
  constructor(private readonly db: DatabaseAdapter = getDatabaseAdapter(), private readonly ingestion = new CanonicalIngestionService(db)) {}

  async submit(envelope: AcquisitionEnvelope): Promise<CanonicalIngestionResult> {
    const prior = await this.db.one<{ content_hash: string; response_json: string }>("SELECT content_hash, response_json FROM acquisition_ingress_submissions WHERE submission_id = ?", [envelope.submissionId]);
    if (prior) {
      if (prior.content_hash !== envelope.contentHash) throw new AcquisitionIngressError(409, "IDEMPOTENCY_KEY_PAYLOAD_CONFLICT");
      return JSON.parse(prior.response_json) as CanonicalIngestionResult;
    }
    const scope = await this.db.one<{ person_id: string }>(
      `SELECT p.id AS person_id FROM people p JOIN tenants t ON t.id = p.tenant_id
       WHERE p.id = ? AND p.tenant_id = ? AND t.status = 'active'`, [envelope.personId, envelope.tenantId],
    );
    if (!scope) throw new AcquisitionIngressError(403, "INGRESS_SCOPE_REJECTED");
    if (envelope.searchPlanId) {
      const plan = await this.db.one<{ id: string }>("SELECT id FROM search_plans WHERE id = ? AND tenant_id = ? AND person_id = ?", [envelope.searchPlanId, envelope.tenantId, envelope.personId]);
      if (!plan) throw new AcquisitionIngressError(403, "INGRESS_SEARCH_PLAN_SCOPE_REJECTED");
    }
    const result = await this.ingestion.ingestOpportunity(envelope.payload, { scope: { mode: "SCOPED", tenantId: envelope.tenantId, personId: envelope.personId, searchPlanId: envelope.searchPlanId ?? null, runId: envelope.runId } });
    try {
      await this.db.execute(
        `INSERT INTO acquisition_ingress_submissions (submission_id, tenant_id, person_id, search_plan_id, run_id, content_hash, canonical_job_id, opportunity_version, response_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [envelope.submissionId, envelope.tenantId, envelope.personId, envelope.searchPlanId ?? null, envelope.runId, envelope.contentHash, result.canonicalJobId, result.opportunityVersion, JSON.stringify(result)],
      );
      return result;
    } catch (error) {
      const winner = await this.db.one<{ content_hash: string; response_json: string }>("SELECT content_hash, response_json FROM acquisition_ingress_submissions WHERE submission_id = ?", [envelope.submissionId]);
      if (winner?.content_hash === envelope.contentHash) return JSON.parse(winner.response_json) as CanonicalIngestionResult;
      throw error;
    }
  }
}

export async function handleAcquisitionIngress(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405, headers: { allow: "POST", "content-type": "application/json" } });
  const secret = process.env.RADAR_ACQUISITION_INGRESS_SECRET;
  const supplied = request.headers.get("x-radar-acquisition-key");
  if (!secret || !supplied || supplied.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_ACQUISITION_ENVELOPE_BYTES) return new Response(JSON.stringify({ error: "Payload Too Large" }), { status: 413, headers: { "content-type": "application/json" } });
  try {
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > MAX_ACQUISITION_ENVELOPE_BYTES) throw new AcquisitionIngressError(413, "PAYLOAD_TOO_LARGE");
    const result = await new AcquisitionIngressService().submit(parseAcquisitionEnvelope(JSON.parse(body)));
    return new Response(JSON.stringify({ accepted: true, result }), { status: 201, headers: { "content-type": "application/json" } });
  } catch (error) {
    const known = error instanceof AcquisitionIngressError ? error : new AcquisitionIngressError(422, "ACQUISITION_REJECTED");
    return new Response(JSON.stringify({ error: known.message }), { status: known.status, headers: { "content-type": "application/json" } });
  }
}
