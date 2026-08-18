/**
 * PlatformIntelligenceEngine.ts
 *
 * P7-C Track B: Local Platform Session Bridge & Normalized Intelligence
 *
 * Manages local session cookie verification, platform signal extraction (LinkedIn Top Applicant),
 * normalization into PlatformIntelligence DTO, and convergence/conflict resolution
 * without altering RADAR's Model C qualityScore or Policy D decision.
 */

import type { PlatformIntelligence, SignalAvailabilityState } from "../../../domain/entities";

export type LocalSessionStatus = "CONNECTED" | "NOT_CONNECTED" | "EXPIRED" | "UNSUPPORTED";

export type ConvergenceState = "CONVERGENCE" | "CONFLICT" | "MISSING" | "PLATFORM_SPECIFIC_SIGNAL";

export interface PlatformInterpretationResult {
  intelligence: PlatformIntelligence;
  relationshipState: ConvergenceState;
  advisoryStatement: string;
  updatedIntelligenceDepth: "HIGH" | "MEDIUM" | "LIMITED" | "UNKNOWN";
}

/**
 * Checks local session availability for a target platform without storing credentials.
 */
export function checkLocalPlatformSession(platform: "LinkedIn" | "Naukri", mockCookies?: any[]): LocalSessionStatus {
  if (platform !== "LinkedIn" && platform !== "Naukri") return "UNSUPPORTED";

  if (!mockCookies || mockCookies.length === 0) return "NOT_CONNECTED";

  const hasLiAt = mockCookies.some((c) => c.name === "li_at" && c.value && c.value.length > 10);
  const hasNaukriAuth = mockCookies.some((c) => (c.name === "naukri_auth" || c.name === "Resdex") && c.value);

  if (platform === "LinkedIn" && hasLiAt) return "CONNECTED";
  if (platform === "Naukri" && hasNaukriAuth) return "CONNECTED";

  return "EXPIRED";
}

/**
 * Extracts and normalizes LinkedIn Top Applicant signal into PlatformIntelligence DTO.
 */
export function extractLinkedInPlatformIntelligence(params: {
  sessionStatus: LocalSessionStatus;
  topApplicantBadge?: boolean;
  applicantRankPercentile?: number; // e.g. 90 = Top 10%
  applicantCount?: number;
  retrievedAtIso?: string;
  provenanceMode?: "FIXTURE" | "LOCAL_EXPERIMENT" | "LIVE_AUTHORIZED";
}): PlatformIntelligence {
  const { sessionStatus, topApplicantBadge, applicantRankPercentile, applicantCount, retrievedAtIso, provenanceMode } = params;

  if (sessionStatus !== "CONNECTED") {
    return {
      source: "LinkedIn",
      accountConnected: false,
      membershipTier: "UNKNOWN",
      provenanceMode: provenanceMode || "FIXTURE",
      applicantCount: { value: null, state: "UNKNOWN" },
      applicantRankPercentile: { value: null, state: "UNKNOWN" },
      topApplicantBadge: { value: null, state: "UNKNOWN" },
      seniorApplicantRatio: { value: null, state: "NOT_APPLICABLE" },
      platformMatchScore: { value: null, state: "UNKNOWN" },
      platformRecommendationBadge: { value: null, state: "UNKNOWN" },
      platformSkillMatchCount: { value: null, state: "NOT_APPLICABLE" },
      platformExperienceMatch: { value: null, state: "NOT_APPLICABLE" },
      recruiterActiveRecently: { value: null, state: "NOT_APPLICABLE" },
      hiringManagerName: { value: null, state: "NOT_APPLICABLE" },
      companyHeadcountGrowthYoY: { value: null, state: "NOT_APPLICABLE" },
      sourceFreshnessAgeDays: { value: null, state: "UNKNOWN" },
    };
  }

  const isAvailable = topApplicantBadge !== undefined || applicantRankPercentile !== undefined;
  const availState: SignalAvailabilityState = isAvailable ? "AVAILABLE" : "UNAVAILABLE";

  return {
    source: "LinkedIn",
    accountConnected: true,
    membershipTier: "PREMIUM",
    retrievedAt: retrievedAtIso || new Date().toISOString(),
    provenanceMode: provenanceMode || "LOCAL_EXPERIMENT",
    applicantCount: applicantCount !== undefined ? { value: applicantCount, state: "AVAILABLE" } : { value: null, state: "UNAVAILABLE" },
    applicantRankPercentile: applicantRankPercentile !== undefined ? { value: applicantRankPercentile, state: "AVAILABLE" } : { value: null, state: "UNAVAILABLE" },
    topApplicantBadge: topApplicantBadge !== undefined ? { value: topApplicantBadge, state: "AVAILABLE" } : { value: null, state: "UNAVAILABLE" },
    seniorApplicantRatio: { value: null, state: "NOT_APPLICABLE" },
    platformMatchScore: { value: null, state: "UNAVAILABLE" },
    platformRecommendationBadge: topApplicantBadge ? { value: "Top Applicant", state: "AVAILABLE" } : { value: null, state: "UNAVAILABLE" },
    platformSkillMatchCount: { value: null, state: "NOT_APPLICABLE" },
    platformExperienceMatch: { value: null, state: "NOT_APPLICABLE" },
    recruiterActiveRecently: { value: null, state: "NOT_APPLICABLE" },
    hiringManagerName: { value: null, state: "NOT_APPLICABLE" },
    companyHeadcountGrowthYoY: { value: null, state: "NOT_APPLICABLE" },
    sourceFreshnessAgeDays: { value: 0, state: "AVAILABLE" },
  };
}

/**
 * Evaluates relationship between platform intelligence and RADAR's decision (Convergence vs Conflict).
 */
export function evaluatePlatformRelationship(
  intelligence: PlatformIntelligence,
  radarDecision: "PURSUE" | "CONSIDER" | "PASS",
  radarQualityScore: number | null,
  baselineDepth: "HIGH" | "MEDIUM" | "LIMITED" | "UNKNOWN" = "MEDIUM"
): PlatformInterpretationResult {
  // 1. MISSING state if platform account not connected or signal unavailable
  if (!intelligence.accountConnected || intelligence.topApplicantBadge.state !== "AVAILABLE") {
    return {
      intelligence,
      relationshipState: "MISSING",
      advisoryStatement: "Platform intelligence unavailable. Evaluated strictly from intrinsic RADAR job specification evidence.",
      updatedIntelligenceDepth: baselineDepth,
    };
  }

  const isTopApplicant = intelligence.topApplicantBadge.value === true;

  // 2. CONVERGENCE: Platform Top Applicant + RADAR PURSUE
  if (isTopApplicant && radarDecision === "PURSUE") {
    return {
      intelligence,
      relationshipState: "CONVERGENCE",
      advisoryStatement: `Strong Convergence: LinkedIn identifies candidate as Top Applicant (Top 10%), aligning with RADAR Quality Score ${radarQualityScore ?? 0}/100 and PURSUE verdict.`,
      updatedIntelligenceDepth: "HIGH",
    };
  }

  // 3. CONFLICT: Platform Top Applicant + RADAR PASS
  if (isTopApplicant && radarDecision === "PASS") {
    return {
      intelligence,
      relationshipState: "CONFLICT",
      advisoryStatement: `Platform Conflict: LinkedIn ranks candidate in Top 10% applicant pool, but RADAR evaluates PASS due to strategic mismatch or location friction.`,
      updatedIntelligenceDepth: "HIGH",
    };
  }

  // 4. CONVERGENCE: Non-top applicant + RADAR CONSIDER / PASS
  if (!isTopApplicant && (radarDecision === "CONSIDER" || radarDecision === "PASS")) {
    return {
      intelligence,
      relationshipState: "CONVERGENCE",
      advisoryStatement: `Convergence: Standard platform applicant match aligns with RADAR ${radarDecision} verdict.`,
      updatedIntelligenceDepth: "HIGH",
    };
  }

  // 5. PLATFORM-SPECIFIC SIGNAL fallback
  return {
    intelligence,
    relationshipState: "PLATFORM_SPECIFIC_SIGNAL",
    advisoryStatement: `Platform Signal: LinkedIn reports ${intelligence.applicantCount.value || 'active'} total applicants for this requisition.`,
    updatedIntelligenceDepth: "HIGH",
  };
}
