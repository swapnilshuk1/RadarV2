import crypto from "crypto";
import type { CanonicalIngestionResult, IngestOpportunityPayload } from "../../../src/lib/acquisition/CanonicalIngestionService";
import { computeContentHash } from "../../../src/lib/acquisition/CanonicalIngestionService";
import { ACQUISITION_ENVELOPE_VERSION, ACQUISITION_INGRESS_PATH, type AcquisitionEnvelope } from "../../../src/lib/acquisition/ingress";

export interface OracleIngressScope { tenantId: string; personId: string; searchPlanId?: string | null; }

function configuredScope(scope?: OracleIngressScope): OracleIngressScope {
  const tenantId = scope?.tenantId || process.env.RADAR_ACQUISITION_TENANT_ID;
  const personId = scope?.personId || process.env.RADAR_ACQUISITION_PERSON_ID;
  const searchPlanId = scope?.searchPlanId ?? process.env.RADAR_ACQUISITION_SEARCH_PLAN_ID ?? null;
  if (!tenantId || !personId) throw new Error("ORACLE_INGRESS_SCOPE_REQUIRED: tenant and person must be supplied by the authenticated local scraper configuration.");
  return { tenantId, personId, searchPlanId };
}

/** Sends bytes, never local artifact paths, to the Oracle durable boundary. */
export async function submitToOracleIngress(payload: IngestOpportunityPayload, runId: string, scope?: OracleIngressScope): Promise<CanonicalIngestionResult> {
  const baseUrl = process.env.RADAR_ACQUISITION_INGRESS_URL;
  const secret = process.env.RADAR_ACQUISITION_INGRESS_SECRET;
  if (!baseUrl || !secret) throw new Error("ORACLE_INGRESS_CONFIGURATION_REQUIRED");
  const effectiveScope = configuredScope(scope);
  const portablePayload: IngestOpportunityPayload = JSON.parse(JSON.stringify(payload));
  if (portablePayload.enrichmentDispatch?.detailedCard && typeof portablePayload.enrichmentDispatch.detailedCard === "object") {
    delete portablePayload.enrichmentDispatch.detailedCard.snapshotPath;
  }
  if (portablePayload.enrichmentDispatch) portablePayload.enrichmentDispatch.snapshotPath = null;
  delete portablePayload.sourcePayloadKey;
  const contentHash = computeContentHash({ title: portablePayload.jobTitle, companyName: portablePayload.companyName, location: portablePayload.location, employmentType: portablePayload.employmentType, rawContent: portablePayload.rawContent });
  const submissionId = crypto.createHash("sha256").update(`${runId}:${effectiveScope.tenantId}:${effectiveScope.personId}:${portablePayload.sourcePortal}:${portablePayload.sourceJobId}:${contentHash}`).digest("hex");
  const envelope: AcquisitionEnvelope = { schemaVersion: ACQUISITION_ENVELOPE_VERSION, submissionId, runId, tenantId: effectiveScope.tenantId, personId: effectiveScope.personId, searchPlanId: effectiveScope.searchPlanId, contentHash, payload: portablePayload };
  const response = await fetch(new URL(ACQUISITION_INGRESS_PATH, baseUrl).toString(), { method: "POST", headers: { "content-type": "application/json", "x-radar-acquisition-key": secret }, body: JSON.stringify(envelope) });
  const parsed = await response.json().catch(() => null) as { error?: string; result?: CanonicalIngestionResult } | null;
  if (!response.ok || !parsed?.result) throw new Error(`ORACLE_INGRESS_REJECTED: ${parsed?.error || response.status}`);
  return parsed.result;
}
