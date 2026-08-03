import type { EditorialPattern } from "../EditorialPattern";

export const fallbackPattern: EditorialPattern = {
  id: "fallback-baseline-0a",
  strategyId: "CAREER_CAPITAL",
  angleId: "CAREER_ACCELERATION",
  executiveIdentity: "Operator",
  editorialPurpose: "Frame career move",
  editorialRisk: "governance",
  editorialThesis: "Strategic Executive Scope Alignment",
  editorialIntent: {
    primaryMessage: "career_alignment",
    supportingThemes: ["operating_domain"],
    avoidThemes: []
  },
  constraints: {},
  slots: {
    headline: (v) => `This opportunity aligns broadly with your current executive scope, although several aspects of the operating model should be clarified during initial discussions.`,
    opening: (v) => `The position for ${v.role} at ${v.company} presents a structured commercial role within your core operating domain.`,
    editorialBridge: (v) => `Primary alignment rests on functional capability match, though direct budget boundaries and reporting authority warrant early verification.`,
    decisionGuidance: {
      proceedIf: (v) => `Functional scope and operational scale at ${v.company} align with your target operating mandate.`,
      pauseIf: () => `Clarify direct reporting lines and regional budget allocation before committing further time.`
    }
  }
};
