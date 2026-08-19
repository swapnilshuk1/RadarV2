/**
 * M4.4 Dual-Write Integration
 */
import { DatabaseAdapter } from "@/data/database";
import { getDatabaseAdapter } from "@/data/database";
import { computeCanonicalJobId, computeContentHash, computeOpportunityVersionId } from "@/lib/domain/canonical_identity";
import { evaluateAttentionGate } from "@/lib/intelligence/AttentionGate";
import { recordSearchPlanCandidate } from "@/lib/intelligence/recordSearchPlanCandidate";
import { SearchPlan, SearchCriteriaPayload } from "@/lib/domain/evaluation_context";

export interface DualWritePayload {
  sourcePortal: string;
  sourceJobId: string;
  canonicalUrl: string;
  jobTitle: string;
  companyName: string;
  location: string;
  employmentType: string | null;
  rawContent: string;
}

export async function executeM4ShadowPath(payload: DualWritePayload, customAdapter?: DatabaseAdapter): Promise<void> {
  const adapter = customAdapter || getDatabaseAdapter();

  // 1. Canonical Identity
  const canonicalJobId = computeCanonicalJobId({ source: payload.sourcePortal, sourceJobId: payload.sourceJobId });

  // 2. Material Versioning
  const contentHash = computeContentHash({
    title: payload.jobTitle,
    companyName: payload.companyName,
    location: payload.location,
    employmentType: payload.employmentType || "Unknown",
    rawContent: payload.rawContent
  });
  const versionId = computeOpportunityVersionId(canonicalJobId, contentHash);

  const opp = {
    id: canonicalJobId,
    source: payload.sourcePortal,
    sourceJobId: payload.sourceJobId,
    canonicalUrl: payload.canonicalUrl,
    companyName: payload.companyName,
    lastSeenAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };

  const ver = {
    id: versionId,
    canonicalJobId,
    contentHash,
    jobTitle: payload.jobTitle,
    companyName: payload.companyName,
    location: payload.location,
    employmentType: payload.employmentType || "Unknown",
    rawContent: payload.rawContent,
    createdAt: new Date().toISOString()
  };

  // 3. Fetch All Active Search Plans
  const activePlanRows = await adapter.many<any>("SELECT * FROM search_plans WHERE status = 'active'");

  for (const row of activePlanRows) {
    const tenantId = row.tenant_id || row.tenantId;
    const personId = row.person_id || row.personId;
    const planId = row.id;
    let criteria: SearchCriteriaPayload = {
      targetSeniority: [],
      targetRoles: [],
      targetLocations: []
    };

    if (row.criteria_json) {
      try {
        criteria = typeof row.criteria_json === "string" ? JSON.parse(row.criteria_json) : row.criteria_json;
      } catch {}
    } else if (row.criteria) {
      criteria = row.criteria;
    }

    // 4. Attention Gate & Candidate Projection
    const result = evaluateAttentionGate(ver, criteria);
    await recordSearchPlanCandidate(adapter, tenantId, personId, planId, opp, ver, result.decision);
  }
}
