import type { Opportunity } from "../../../data/opportunity-fixtures";
import type { EditorialPattern, EditorialVariableMap } from "./EditorialPattern";

export interface ComposedNarrative {
  patternId: string;
  strategyId: string;
  angleId: string;
  editorialThesis: string;
  editorialRisk?: string;
  headline: string;
  opening?: string;
  editorialBridge?: string;
  decisionGuidance: {
    proceedIf: string;
    pauseIf: string;
    closing?: string;
  };
}

export class NarrativeComposer {
  public static compose(pattern: EditorialPattern, opportunity: Opportunity): ComposedNarrative {
    // Extract P&L Scale if available from dimensions
    const pnlDim = opportunity.dimensions?.find(d => d.key === "commercialAccountability");
    const pnlScale = pnlDim?.jdEvidence?.value ? String(pnlDim.jdEvidence.value) : undefined;

    // Extract Primary Capability
    const mandateDim = opportunity.dimensions?.find(d => d.key === "mandate" || d.key === "functionalScope");
    const primaryCapability = mandateDim?.jdEvidence?.value ? String(mandateDim.jdEvidence.value) : undefined;

    // Build synthesized Advantage
    let synthesizedAdvantage: EditorialVariableMap["synthesizedAdvantage"] = undefined;
    if (opportunity.primaryProof) {
      synthesizedAdvantage = {
        statement: `${opportunity.primaryProof.headline} — ${opportunity.primaryProof.detail}`,
        evidenceIds: [],
        confidence: 0.9
      };
    } else if (opportunity.primaryDriver) {
      synthesizedAdvantage = {
        statement: opportunity.primaryDriver,
        evidenceIds: [],
        confidence: 0.85
      };
    }

    // Build synthesized Risk
    let synthesizedRisk: EditorialVariableMap["synthesizedRisk"] = undefined;
    if (opportunity.primaryConcern?.jdQuote) {
      synthesizedRisk = {
        statement: opportunity.primaryConcern.jdQuote,
        evidenceIds: [],
        confidence: 0.85
      };
    } else if (opportunity.primaryRisk) {
      synthesizedRisk = {
        statement: opportunity.primaryRisk,
        evidenceIds: [],
        confidence: 0.8
      };
    }

    // Detect Easy Trap trigger (Strictly consume Policy Engine output, never re-evaluate thresholds)
    const isEasyTrapTriggered =
      opportunity.recommendationResult?.policyId === "R-CONSIDER-CAREER-VALUE-PROTECTION" ||
      opportunity.recommendationResult?.vetoReason === "R-CONSIDER-CAREER-VALUE-PROTECTION" ||
      Boolean((opportunity.engineRecommendation as any)?.triggeredRuleIds?.includes("R-CONSIDER-CAREER-VALUE-PROTECTION"));

    const vars: EditorialVariableMap = {
      role: opportunity.role || "Executive Role",
      company: opportunity.company || "Target Enterprise",
      location: opportunity.location || "Target Location",
      pnlScale,
      primaryCapability,
      synthesizedAdvantage,
      synthesizedRisk,
      isEasyTrapTriggered
    };

    try {
      const headline = pattern.slots.headline(vars);
      const opening = pattern.slots.opening ? pattern.slots.opening(vars) : undefined;
      const editorialBridge = pattern.slots.editorialBridge ? pattern.slots.editorialBridge(vars) : undefined;
      const proceedIf = pattern.slots.decisionGuidance.proceedIf(vars);
      let pauseIf = pattern.slots.decisionGuidance.pauseIf(vars);
      const closing = pattern.slots.decisionGuidance.closing ? pattern.slots.decisionGuidance.closing(vars) : undefined;

      if (isEasyTrapTriggered && !pauseIf.includes("High interview probability")) {
        pauseIf = `High interview probability based on profile alignment, but offers limited career step-up relative to your current trajectory. ${pauseIf}`;
      }

      return {
        patternId: pattern.id,
        strategyId: pattern.strategyId,
        angleId: pattern.angleId,
        editorialThesis: pattern.editorialThesis,
        editorialRisk: pattern.editorialRisk,
        headline,
        opening,
        editorialBridge,
        decisionGuidance: {
          proceedIf,
          pauseIf,
          closing
        }
      };
    } catch (err) {
      console.error("NarrativeComposer composition error:", err);
      return {
        patternId: pattern.id,
        strategyId: pattern.strategyId,
        angleId: pattern.angleId,
        editorialThesis: pattern.editorialThesis,
        editorialRisk: pattern.editorialRisk,
        headline: `This opportunity aligns broadly with your executive scope at ${vars.company}.`,
        opening: `The mandate presents a structured commercial role within your core operating domain.`,
        editorialBridge: `Primary alignment rests on functional capability match, though direct budget boundaries warrant verification.`,
        decisionGuidance: {
          proceedIf: `Scope and functional parameters at ${vars.company} align with your target mandate.`,
          pauseIf: `Clarify reporting boundaries and direct budget authority during initial discussions.`
        }
      };
    }
  }
}
