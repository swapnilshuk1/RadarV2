import type { Opportunity } from "../../../data/opportunity-fixtures";

export type EngineVerdict = "PURSUE" | "CONSIDER" | "PASS";
export type TrajectoryUpside = "HIGH" | "LIMITED" | "REGRESSION" | "NEUTRAL" | string;
export type CareerValueProtection = "DOWNSCALED" | "EXCLUDED" | "CLEAR" | string;

export type OrganizationType = "founder_led" | "institutional" | "private_equity" | "public_company";
export type TransformationStage = "none" | "modernization" | "turnaround";
export type ScoreTier = "HIGH" | "MEDIUM" | "LOW";
/**
 * Editorial provenance is deliberately conservative: a title or company name
 * may suggest a hypothesis, but it must not qualify as observed evidence.
 */
export type ProvenanceSource = "OBSERVED" | "INFERRED" | "UNKNOWN";

export interface EditorialContext {
  readonly engineVerdict: EngineVerdict | null;

  readonly careerValue: {
    readonly trajectoryUpside: TrajectoryUpside | null;
    readonly careerRegressionScore: number | null;
    readonly careerValueProtection: CareerValueProtection | null;
    readonly relativeDifferentiator: string | null;
    readonly triggeredRuleIds: readonly string[];
  };

  readonly identity: {
    readonly coverage: number | null;
    readonly distance: number | null;
    readonly verdict: string | null;
  } | null;

  readonly capability: {
    readonly overallFit: number | null;
    readonly matchedCapabilities: readonly string[];
    readonly missingCapabilities: readonly string[];
  } | null;

  readonly lifestyle: {
    readonly locationFrictionPenalty: number | null;
  } | null;

  readonly decisionDrivers?: readonly (string | import("../policy/DecisionPolicyEngine").DecisionDriver)[];
  readonly decisionRisks?: readonly (string | import("../policy/DecisionPolicyEngine").DecisionDriver)[];

  readonly evidence: {
    readonly explicitCount: number;
    readonly evidenceQuality: "High Evidence Quality" | "Medium Evidence Quality" | "Inferred Evidence";
  } | null;

  // Legacy context fields preserved for compatibility
  readonly organizationType: OrganizationType;
  readonly transformationStage: TransformationStage;
  readonly hasPnlOwnership: boolean;
  readonly pnlProvenance: ProvenanceSource;
  readonly mandateProvenance: ProvenanceSource;
  readonly scoreTier: ScoreTier;
  /** Null means the opportunity has not produced an authoritative score. */
  readonly rawScore: number | null;
}

export class EditorialContextBuilder {
  /**
   * Pure projection layer from Opportunity / EngineRecommendation to EditorialContext.
   * Strictly copies authoritative values without recomputing scores, applying threshold checks,
   * or falling back to user decision or presentation state.
   */
  public static build(opportunity: Opportunity): EditorialContext {
    const recommendation = opportunity.engineRecommendation;
    const policyResult = (opportunity as any).policyResult;

    // Direct, un-manipulated extraction of engine verdict
    const rawVerdict = recommendation?.engineVerdict || policyResult?.verdict || policyResult?.recommendation;
    const engineVerdict: EngineVerdict | null =
      rawVerdict && ["PURSUE", "CONSIDER", "PASS"].includes(rawVerdict)
        ? (rawVerdict as EngineVerdict)
        : null;

    const recRec = recommendation as Record<string, unknown> | undefined;

    // Direct, un-manipulated extraction of career value signals
    const careerValue = {
      trajectoryUpside: recommendation?.trajectoryUpside ?? policyResult?.trajectoryUpside ?? null,
      careerRegressionScore: (recRec?.careerRegressionScore as number | null | undefined) ?? (policyResult?.careerRegressionScore as number | null | undefined) ?? null,
      careerValueProtection: (recRec?.careerValueProtection as string | null | undefined) ?? null,
      relativeDifferentiator: recommendation?.relativeDifferentiator ?? policyResult?.relativeDifferentiator ?? null,
      triggeredRuleIds: recommendation?.triggeredRuleIds ?? policyResult?.triggeredRuleIds ?? [],
    };

    // Identity Alignment (if available in engine recommendation or trace)
    const identityAlignment = recRec?.identityAlignment as { coverage?: number; distance?: number; verdict?: string } | undefined;
    const identity = identityAlignment
      ? {
          coverage: identityAlignment.coverage ?? null,
          distance: identityAlignment.distance ?? null,
          verdict: identityAlignment.verdict ?? null,
        }
      : null;

    // Capability Fit
    const capabilityFit = recRec?.capabilityFit as { overallFit?: number; matchedCapabilities?: string[]; missingCapabilities?: string[] } | undefined;
    const capability = capabilityFit
      ? {
          overallFit: capabilityFit.overallFit ?? null,
          matchedCapabilities: capabilityFit.matchedCapabilities ?? [],
          missingCapabilities: capabilityFit.missingCapabilities ?? [],
        }
      : null;

    // Lifestyle / Friction
    const lifestyleFit = recRec?.lifestyleFit as { locationFrictionPenalty?: number } | undefined;
    const lifestyle = lifestyleFit
      ? {
          locationFrictionPenalty: lifestyleFit.locationFrictionPenalty ?? null,
        }
      : null;

    // Evidence
    const explicitCount = (opportunity.dimensions || []).filter(
      (d: Record<string, unknown>) => (d.jdEvidence as Record<string, unknown> | undefined)?.status === "Explicit"
    ).length;
    const evidenceQuality: "High Evidence Quality" | "Medium Evidence Quality" | "Inferred Evidence" =
      explicitCount >= 3 ? "High Evidence Quality" : explicitCount >= 1 ? "Medium Evidence Quality" : "Inferred Evidence";

    const evidence = {
      explicitCount,
      evidenceQuality,
    };

    // Structural metadata heuristics (for legacy UI badges, strictly decoupled from engineVerdict)
    const candidateScore = recommendation?.qualityScore ?? policyResult?.qualityScore ?? policyResult?.rawScore ?? (opportunity as Record<string, unknown>).matchScore;
    const rawScore = typeof candidateScore === "number" && Number.isFinite(candidateScore)
      ? candidateScore
      : null;

    const companyLower = (opportunity.company || "").toLowerCase();
    const roleLower = (opportunity.role || "").toLowerCase();

    const isFounderLed =
      companyLower.includes("founder") ||
      companyLower.includes("promoter") ||
      companyLower.includes("owner-led") ||
      roleLower.includes("founder");

    const isPE =
      companyLower.includes("private equity") ||
      companyLower.includes("pe-backed") ||
      companyLower.includes("capital") ||
      companyLower.includes("partners");
    const isPublic =
      companyLower.includes("public company") ||
      companyLower.includes("listed") ||
      companyLower.includes("inc") ||
      companyLower.includes("corp") ||
      companyLower.includes("ltd");

    let organizationType: OrganizationType = "institutional";
    if (isFounderLed) organizationType = "founder_led";
    else if (isPE) organizationType = "private_equity";
    else if (isPublic) organizationType = "public_company";

    let transformationStage: TransformationStage = "none";
    let mandateProvenance: ProvenanceSource = "UNKNOWN";

    const mandateDim = opportunity.dimensions?.find((d) => d.key === "mandate");
    if (
      mandateDim &&
      mandateDim.jdEvidence?.status === "Explicit" &&
      mandateDim.jdEvidence?.value
    ) {
      const val = String(mandateDim.jdEvidence.value).toLowerCase();
      if (val.includes("turnaround") || val.includes("restructure")) {
        transformationStage = "turnaround";
      } else if (val.includes("transformation") || val.includes("digitiz") || val.includes("moderniz")) {
        transformationStage = "modernization";
      }
      mandateProvenance = "OBSERVED";
    }

    let hasPnlOwnership = false;
    let pnlProvenance: ProvenanceSource = "UNKNOWN";

    const commercialAccDim = opportunity.dimensions?.find((d) => d.key === "commercialAccountability");
    if (commercialAccDim?.jdEvidence?.status === "Explicit") {
      const val = commercialAccDim.jdEvidence?.value;
      if (typeof val === "boolean") {
        hasPnlOwnership = val;
        pnlProvenance = "OBSERVED";
      } else if (val !== undefined && val !== null) {
        const strVal = String(val).toLowerCase();
        if (strVal === "false" || strVal === "none" || strVal === "no") {
          hasPnlOwnership = false;
          pnlProvenance = "OBSERVED";
        } else if (
          strVal === "true" ||
          strVal.includes("p&l") ||
          strVal.includes("profit") ||
          strVal.includes("revenue") ||
          strVal.includes("commercial") ||
          strVal.includes("budget") ||
          strVal.includes("fee-book") ||
          strVal.includes("topline") ||
          strVal.includes("category")
        ) {
          hasPnlOwnership = true;
          pnlProvenance = "OBSERVED";
        }
      }
    }

    const scoreTier: ScoreTier =
      engineVerdict === "PURSUE" ? "HIGH" : engineVerdict === "CONSIDER" ? "MEDIUM" : "LOW";

    return {
      engineVerdict,
      careerValue,
      identity,
      capability,
      lifestyle,
      evidence,
      decisionDrivers: recommendation?.decisionDrivers ?? [],
      decisionRisks: recommendation?.decisionRisks ?? [],

      organizationType,
      transformationStage,
      hasPnlOwnership,
      pnlProvenance,
      mandateProvenance,
      scoreTier,
      rawScore,
    };
  }
}
