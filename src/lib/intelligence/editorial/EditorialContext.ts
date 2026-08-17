import type { Opportunity } from "../../../data/opportunity-fixtures";

export type EngineVerdict = "PURSUE" | "CONSIDER" | "PASS";
export type TrajectoryUpside = "HIGH" | "LIMITED" | "REGRESSION" | "NEUTRAL" | string;
export type CareerValueProtection = "DOWNSCALED" | "EXCLUDED" | "CLEAR" | string;

export type OrganizationType = "founder_led" | "institutional" | "private_equity" | "public_company";
export type TransformationStage = "none" | "modernization" | "turnaround";
export type ScoreTier = "HIGH" | "MEDIUM" | "LOW";
export type ProvenanceSource = "ENGINE_VERIFIED" | "TITLE_HEURISTIC";

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
  readonly rawScore: number;
}

export class EditorialContextBuilder {
  /**
   * Pure projection layer from Opportunity / EngineRecommendation to EditorialContext.
   * Strictly copies authoritative values without recomputing scores, applying threshold checks,
   * or falling back to user decision or presentation state.
   */
  public static build(opportunity: Opportunity): EditorialContext {
    const recommendation = opportunity.engineRecommendation;

    // Direct, un-manipulated extraction of engine verdict
    const engineVerdict: EngineVerdict | null =
      recommendation?.engineVerdict && ["PURSUE", "CONSIDER", "PASS"].includes(recommendation.engineVerdict)
        ? (recommendation.engineVerdict as EngineVerdict)
        : null;

    const recRec = recommendation as Record<string, unknown> | undefined;

    // Direct, un-manipulated extraction of career value signals
    const careerValue = {
      trajectoryUpside: recommendation?.trajectoryUpside ?? null,
      careerRegressionScore: (recRec?.careerRegressionScore as number | null | undefined) ?? null,
      careerValueProtection: (recRec?.careerValueProtection as string | null | undefined) ?? null,
      relativeDifferentiator: recommendation?.relativeDifferentiator ?? null,
      triggeredRuleIds: recommendation?.triggeredRuleIds ?? [],
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
    const rawScore = recommendation?.qualityScore ?? 50;

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
    let mandateProvenance: ProvenanceSource = "TITLE_HEURISTIC";

    const mandateDim = opportunity.dimensions?.find((d) => d.key === "mandate");
    if (
      mandateDim &&
      (mandateDim.jdEvidence?.status === "Explicit" || mandateDim.jdEvidence?.status === "Inferred") &&
      mandateDim.jdEvidence?.value
    ) {
      const val = String(mandateDim.jdEvidence.value).toLowerCase();
      if (val.includes("turnaround") || val.includes("restructure")) {
        transformationStage = "turnaround";
      } else if (val.includes("transformation") || val.includes("digitiz") || val.includes("moderniz")) {
        transformationStage = "modernization";
      }
      mandateProvenance = "ENGINE_VERIFIED";
    }

    if (mandateProvenance === "TITLE_HEURISTIC") {
      const isTurnaround = roleLower.includes("turnaround") || roleLower.includes("restructure");
      const isModernization =
        roleLower.includes("transformation") || roleLower.includes("digitiz") || roleLower.includes("moderniz");

      if (isTurnaround) transformationStage = "turnaround";
      else if (isModernization) transformationStage = "modernization";
    }

    let hasPnlOwnership = false;
    let pnlProvenance: ProvenanceSource = "TITLE_HEURISTIC";

    const commercialAccDim = opportunity.dimensions?.find((d) => d.key === "commercialAccountability");
    if (commercialAccDim) {
      const val = commercialAccDim.jdEvidence?.value;
      if (typeof val === "boolean") {
        hasPnlOwnership = val;
        pnlProvenance = "ENGINE_VERIFIED";
      } else if (val !== undefined && val !== null) {
        const strVal = String(val).toLowerCase();
        if (strVal === "false" || strVal === "none" || strVal === "no") {
          hasPnlOwnership = false;
          pnlProvenance = "ENGINE_VERIFIED";
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
          pnlProvenance = "ENGINE_VERIFIED";
        }
      }
    }

    if (pnlProvenance === "TITLE_HEURISTIC") {
      hasPnlOwnership =
        roleLower.includes("cmo") ||
        roleLower.includes("cgo") ||
        roleLower.includes("cro") ||
        roleLower.includes("ceo") ||
        roleLower.includes("coo") ||
        roleLower.includes("general manager") ||
        roleLower.includes("business head") ||
        roleLower.includes("p&l") ||
        roleLower.includes("vp");
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
