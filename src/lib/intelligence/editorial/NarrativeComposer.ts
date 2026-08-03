import type { Opportunity } from "../../../data/opportunity-fixtures";
import type { EditorialPattern, EditorialVariableMap } from "./EditorialPattern";

export interface ComposedNarrative {
  patternId: string;
  strategyId: string;
  angleId: string;
  editorialThesis: string;
  primaryQuestion: string;
  headline: string;
  opening: string;
  editorialBridge: string;
  decisionGuidance: {
    proceedIf: string;
    pauseIf: string;
    closing: string;
  };
}

export class NarrativeComposer {
  public static compose(pattern: EditorialPattern, opportunity: Opportunity): ComposedNarrative {
    // Build clean variable map
    const vars: EditorialVariableMap = {
      role: opportunity.role || "Executive Role",
      company: opportunity.company || "Target Enterprise",
      location: opportunity.location || "Target Location"
    };

    try {
      const headline = pattern.slots.headline(vars);
      const opening = pattern.slots.opening(vars);
      const editorialBridge = pattern.slots.editorialBridge(vars);
      const proceedIf = pattern.slots.decisionGuidance.proceedIf(vars);
      const pauseIf = pattern.slots.decisionGuidance.pauseIf(vars);
      const closing = pattern.slots.decisionGuidance.closing(vars);

      return {
        patternId: pattern.id,
        strategyId: pattern.strategyId,
        angleId: pattern.angleId,
        editorialThesis: pattern.editorialThesis,
        primaryQuestion: pattern.primaryQuestion,
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
      // Fallback interpolation guarantee
      return {
        patternId: pattern.id,
        strategyId: pattern.strategyId,
        angleId: pattern.angleId,
        editorialThesis: pattern.editorialThesis,
        primaryQuestion: pattern.primaryQuestion,
        headline: `Targeted opportunity for ${vars.role} at ${vars.company}.`,
        opening: `Executive mandate for ${vars.role} at ${vars.company}.`,
        editorialBridge: `Aligns with your executive background and operating scale.`,
        decisionGuidance: {
          proceedIf: `Scope and alignment for ${vars.role} fit your target trajectory.`,
          pauseIf: `Confirm reporting authority and role boundaries during screening call.`,
          closing: `Proceed with initial recruiter screening for ${vars.role} at ${vars.company}.`
        }
      };
    }
  }
}
