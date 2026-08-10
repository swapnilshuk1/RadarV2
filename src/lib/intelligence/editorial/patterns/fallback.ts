import type { EditorialPattern } from "../EditorialPattern";

export const fallbackPattern: EditorialPattern = {
  id: "fallback-baseline-0a",
  patternFamily: "fallback",
  skeleton: "fact-first",
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
    headline: (v) => `This ${v.role} mandate at ${v.company} aligns with your commercial track, though operating scope requires verification during initial screening.`,
    opening: (v) => `The seat presents a structured commercial role within your primary operating domain.`,
    editorialBridge: (v) => `Primary alignment rests on functional capability overlap; direct budget authority and reporting lines warrant early screening.`,
    decisionGuidance: {
      proceedIf: (v) => `Functional scope and operational scale at ${v.company} align with your target mandate.`,
      pauseIf: (v) => `Clarify direct reporting lines and budget allocation before committing prep time.`,
      closing: (v) => `Consider. Evaluate operating scope and budget authority during initial screening.`
    }
  }
};
