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
    const vars: EditorialVariableMap = {
      role: opportunity.role || "Executive Role",
      company: opportunity.company || "Target Enterprise",
      location: opportunity.location || "Target Location"
    };

    try {
      const headline = pattern.slots.headline(vars);
      const opening = pattern.slots.opening ? pattern.slots.opening(vars) : undefined;
      const editorialBridge = pattern.slots.editorialBridge ? pattern.slots.editorialBridge(vars) : undefined;
      const proceedIf = pattern.slots.decisionGuidance.proceedIf(vars);
      const pauseIf = pattern.slots.decisionGuidance.pauseIf(vars);
      const closing = pattern.slots.decisionGuidance.closing ? pattern.slots.decisionGuidance.closing(vars) : undefined;

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
