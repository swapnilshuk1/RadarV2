/**
 * AttentionGate.ts
 *
 * Phase M4.3: Canonical Acquisition Attention Gate.
 *
 * Deterministic, non-LLM, cheap filter to decide if a global OpportunityVersion
 * warrants expensive V4 semantic evaluation for a specific SearchPlan.
 *
 * INVARIANTS:
 * 1. ZERO LLM calls. No semantic extraction.
 * 2. Deterministic: Same inputs ALWAYS yield same outputs.
 * 3. Does NOT invoke DecisionPolicyEngine or EvaluationContext.
 */

import type { OpportunityVersion, AttentionDecision } from "@/lib/domain/canonical_acquisition";
import type { SearchCriteriaPayload } from "@/lib/domain/evaluation_context";

export interface AttentionGateResult {
  decision: AttentionDecision;
  reasons: string[];
}

function normalizeForMatch(val: string | null | undefined): string {
  if (!val) return "";
  return val.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function matchesAny(target: string, criteria: string[]): boolean {
  if (!criteria || criteria.length === 0) return true;
  const normalizedTarget = normalizeForMatch(target);
  return criteria.some((c) => normalizedTarget.includes(normalizeForMatch(c)));
}

export function evaluateAttentionGate(
  version: OpportunityVersion,
  criteria: SearchCriteriaPayload
): AttentionGateResult {
  const reasons: string[] = [];
  let isCandidate = true;

  // 1. Role Match (Job Title)
  if (criteria.targetRoles && criteria.targetRoles.length > 0) {
    if (!matchesAny(version.jobTitle, criteria.targetRoles)) {
      isCandidate = false;
      reasons.push("Role mismatch: '" + version.jobTitle + "' does not match targets.");
    }
  }

  // 2. Location Match
  if (criteria.targetLocations && criteria.targetLocations.length > 0) {
    const isRemoteTarget = criteria.targetLocations.some((l) => normalizeForMatch(l).includes("remote"));
    const isRemoteJob = version.location ? normalizeForMatch(version.location).includes("remote") : false;

    if (!(isRemoteTarget && isRemoteJob) && !(version.location && matchesAny(version.location, criteria.targetLocations))) {
      isCandidate = false;
      reasons.push("Location mismatch: '" + (version.location || "Unknown") + "' does not match targets.");
    }
  }

  // 3. Seniority Match (Job Title heuristic)
  if (criteria.targetSeniority && criteria.targetSeniority.length > 0) {
    if (!matchesAny(version.jobTitle, criteria.targetSeniority)) {
      isCandidate = false;
      reasons.push("Seniority mismatch: Title '" + version.jobTitle + "' does not contain target seniority.");
    }
  }

  // 4. Employment Type Match
  if (criteria.targetEmploymentTypes && criteria.targetEmploymentTypes.length > 0) {
    if (!version.employmentType || !matchesAny(version.employmentType, criteria.targetEmploymentTypes)) {
      isCandidate = false;
      reasons.push("Employment type mismatch: '" + (version.employmentType || "Unknown") + "' does not match targets.");
    }
  }


  // 5. Excluded Companies
  if (criteria.excludedCompanies && criteria.excludedCompanies.length > 0 && version.companyName) {
    const normalizedCompany = normalizeForMatch(version.companyName);
    if (criteria.excludedCompanies.some((c) => normalizedCompany === normalizeForMatch(c))) {
      isCandidate = false;
      reasons.push("Excluded company: '" + version.companyName + "' is explicitly excluded.");
    }
  }

  return {
    decision: isCandidate ? "CANDIDATE" : "NOT_CANDIDATE",
    reasons,
  };
}