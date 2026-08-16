import type { CandidateProjection } from "../domain/candidate_projection";
import type { OperatingLevel } from "../domain/semantic";

const LEVEL_HIERARCHY: Record<string, number> = {
  EXECUTIVE: 5,
  STRATEGIC: 4,
  MANAGERIAL: 3,
  TACTICAL: 2,
  INDIVIDUAL_CONTRIBUTOR: 1,
  UNKNOWN: 1
};

export interface CandidateEvaluationContext {
  projection: CandidateProjection;
  candHash?: string;

  // Normalized identity & themes
  primaryIdentityStr: string;
  normalizedThemesLower: string[];

  // Normalized capability proof pool
  candidateProofPool: string[];
  candidateProofPoolLower: string[];

  // Operating level & hierarchy
  candOperatingLevel: OperatingLevel | "UNKNOWN";
  candLevelHierarchyVal: number;

  // Scope & Authority
  decisionAuthorityValue?: string;
  commercialScopeValue?: string;
  workNatureValue?: string;

  // Precomputed flags
  isExecutiveLevel: boolean;
  isCommercialCandidate: boolean;
  hasEnterpriseScope: boolean;
}

export function buildCandidateEvaluationContext(
  projection: CandidateProjection
): CandidateEvaluationContext {
  const themes = (projection.executiveThemes || [])
    .map((t: any) => (typeof t === "string" ? t : t?.value || ""))
    .filter((v): v is string => Boolean(v));

  const primaryIdentityStr = themes.length
    ? themes[0]
    : "Commercial & Marketing Leadership";

  const normalizedThemesLower = themes.map((t) => t.toLowerCase());
  const candidateIdentityLower = (themes.join(" ") || "Commercial & Marketing Leadership").toLowerCase();

  const proofPool = (projection.coreCapabilities || [])
    .map((c: any) => (typeof c === "string" ? c : c?.value || ""))
    .filter((v): v is string => Boolean(v));
  const proofPoolLower = proofPool.map((p) => p.toLowerCase().trim());

  const candOperatingLevel = (
    typeof projection.operatingLevel === "object"
      ? projection.operatingLevel?.value || "UNKNOWN"
      : projection.operatingLevel || "UNKNOWN"
  ) as OperatingLevel | "UNKNOWN";

  const candLevelHierarchyVal = LEVEL_HIERARCHY[candOperatingLevel] || 1;

  const decisionAuthorityValue = projection.decisionAuthority?.value;
  const commercialScopeValue = projection.commercialScope?.value;
  const workNatureValue = projection.workNature?.value;

  const isExecutiveLevel = candOperatingLevel === "EXECUTIVE" || commercialScopeValue === "ENTERPRISE";
  const isCommercialCandidate =
    candidateIdentityLower.includes("commercial") ||
    candidateIdentityLower.includes("marketing") ||
    candidateIdentityLower.includes("growth");
  const hasEnterpriseScope = decisionAuthorityValue === "ENTERPRISE" || commercialScopeValue === "ENTERPRISE";

  return {
    projection,
    primaryIdentityStr,
    normalizedThemesLower,
    candidateProofPool: proofPool,
    candidateProofPoolLower: proofPoolLower,
    candOperatingLevel,
    candLevelHierarchyVal,
    decisionAuthorityValue,
    commercialScopeValue,
    workNatureValue,
    isExecutiveLevel,
    isCommercialCandidate,
    hasEnterpriseScope
  };
}
