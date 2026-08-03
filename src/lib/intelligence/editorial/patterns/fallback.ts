import type { EditorialPattern } from "../EditorialPattern";

export const fallbackPattern: EditorialPattern = {
  id: "fallback-baseline-0a",
  strategyId: "CAREER_CAPITAL",
  angleId: "CAREER_ACCELERATION",
  editorialThesis: "Strategic Executive Career Alignment",
  primaryQuestion: "How does this role align with your operating mandate?",
  editorialIntent: {
    primaryMessage: "executive_alignment",
    supportingThemes: ["scope_match", "capability_fit"],
    avoidThemes: []
  },
  constraints: {},
  slots: {
    headline: (v) => `Targeted executive opportunity in ${v.role} capacity at ${v.company}.`,
    opening: (v) => `Executive mandate for ${v.role} at ${v.company}, aligning with your leadership experience and career trajectory.`,
    editorialBridge: (v) => `Presents a structured executive opportunity at ${v.company} matching your target profile.`,
    decisionGuidance: {
      proceedIf: (v) => `Scope and operating parameters at ${v.company} align with your target mandate.`,
      pauseIf: () => `Confirm organizational reporting structure and role scope during initial call.`,
      closing: (v) => `Proceed with standard review. Validate reporting authority for ${v.role} at ${v.company} before advancing.`
    }
  }
};
