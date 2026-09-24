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

/** Constant-time check kept separate so deployment checks can exercise auth without DB writes. */
export function isValidAcquisitionIngressSecret(configured: string | undefined, supplied: string | null): boolean {
  return Boolean(
    configured && supplied && supplied.length === configured.length
    && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(configured)),
  );
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
    await this.ensureRemoteRun(envelope);
    const result = await this.ingestion.ingestOpportunity(envelope.payload, { scope: { mode: "SCOPED", tenantId: envelope.tenantId, personId: envelope.personId, searchPlanId: envelope.searchPlanId ?? null, runId: envelope.runId } });
    await this.recordCanonicalLineage(envelope, result);
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

  /**
   * The laptop owns browser state but not canonical persistence.  It therefore
   * supplies a run id; Oracle creates and owns the scoped durable run before
   * canonical admission.  This also makes the run_id used by queue bindings a
   * real foreign-key target rather than a client-side fiction.
   */
  private async ensureRemoteRun(envelope: AcquisitionEnvelope): Promise<void> {
    await this.db.execute(
      `INSERT INTO scrape_runs (
         id, tenant_id, person_id, search_plan_id, status, portal_targets,
         config_json, metrics_json, total_discovered, total_enqueued,
         created_at, started_at, updated_at
       ) VALUES (?, ?, ?, ?, 'running', ?, ?, '{}', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO NOTHING`,
      [
        envelope.runId,
        envelope.tenantId,
        envelope.personId,
        envelope.searchPlanId ?? null,
        JSON.stringify([envelope.payload.sourcePortal]),
        JSON.stringify({ acquisitionBoundary: "localhost_to_oracle", envelopeVersion: envelope.schemaVersion }),
      ],
    );
    const run = await this.db.one<{ id: string; status: string }>(
      `SELECT id, status FROM scrape_runs
       WHERE id = ? AND tenant_id = ? AND person_id = ?
         AND ((search_plan_id = ?) OR (search_plan_id IS NULL AND ? IS NULL))`,
      [envelope.runId, envelope.tenantId, envelope.personId, envelope.searchPlanId ?? null, envelope.searchPlanId ?? null],
    );
    if (!run) throw new AcquisitionIngressError(409, "INGRESS_RUN_SCOPE_CONFLICT");
    if (run.status !== "running") throw new AcquisitionIngressError(409, "INGRESS_RUN_NOT_RUNNING");
  }

  /** Persist one Oracle-side source-to-canonical binding for this submission. */
  private async recordCanonicalLineage(envelope: AcquisitionEnvelope, result: CanonicalIngestionResult): Promise<void> {
    const ledgerId = `ingress_ledger_${crypto.createHash("sha256").update(`${envelope.payload.sourcePortal}:${result.canonicalJobId}`).digest("hex").slice(0, 24)}`;
    const lineageId = `ingress_lineage_${crypto.createHash("sha256").update(envelope.submissionId).digest("hex").slice(0, 24)}`;
    const now = new Date().toISOString();
    await this.db.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO acquisition_ledger (
           id, canonical_job_id, source_portal, source_job_id, canonical_url,
           title, company_name, location, state, first_seen_at, last_seen_at,
           last_acquired_at, freshness_state, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'VALIDATED', ?, ?, ?, 'FRESH', ?, ?)
         ON CONFLICT(source_portal, canonical_job_id) DO UPDATE SET
           last_seen_at = excluded.last_seen_at, last_acquired_at = excluded.last_acquired_at,
           title = excluded.title, company_name = excluded.company_name,
           location = COALESCE(excluded.location, acquisition_ledger.location), updated_at = excluded.updated_at`,
        [ledgerId, result.canonicalJobId, envelope.payload.sourcePortal, envelope.payload.sourceJobId,
          envelope.payload.canonicalUrl, envelope.payload.jobTitle, envelope.payload.companyName || "Unknown",
          envelope.payload.location || null, now, now, now, now, now],
      );
      const ledger = await tx.one<{ id: string }>(
        "SELECT id FROM acquisition_ledger WHERE source_portal = ? AND canonical_job_id = ?",
        [envelope.payload.sourcePortal, result.canonicalJobId],
      );
      if (!ledger) throw new AcquisitionIngressError(500, "INGRESS_LEDGER_RESOLUTION_FAILED");
      await tx.execute(
        `INSERT INTO acquisition_ingestion_lineage (
           id, scrape_run_id, tenant_id, person_id, acquisition_ledger_id,
           card_id, ingestion_attempt, source_portal, source_job_id, source_url,
           resolved_url, capture_state, document_state, content_hash,
           canonical_job_id, opportunity_version
         ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 'RECEIVED', 'CANONICAL_ADMITTED', ?, ?, ?)
         ON CONFLICT(scrape_run_id, card_id, ingestion_attempt) DO NOTHING`,
        [lineageId, envelope.runId, envelope.tenantId, envelope.personId, ledger.id,
          `ingress:${envelope.submissionId}`, envelope.payload.sourcePortal,
          envelope.payload.sourceJobId, envelope.payload.canonicalUrl,
          envelope.payload.finalUrl || null, result.contentHash, result.canonicalJobId, result.opportunityVersion],
      );
      await tx.execute(
        `UPDATE scrape_runs
         SET total_discovered = total_discovered + 1,
             total_enqueued = total_enqueued + ?, updated_at = ?
         WHERE id = ?`,
        [result.isNewEnrichmentJob ? 1 : 0, now, envelope.runId],
      );
    });
  }
}

export async function handleAcquisitionIngress(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405, headers: { allow: "POST", "content-type": "application/json" } });
  const secret = process.env.RADAR_ACQUISITION_INGRESS_SECRET;
  const supplied = request.headers.get("x-radar-acquisition-key");
  if (!isValidAcquisitionIngressSecret(secret, supplied)) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
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
