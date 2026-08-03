import type { EditorialPattern } from "../EditorialPattern";

export const founderAccessPattern: EditorialPattern = {
  id: "founder-access-3a",
  strategyId: "FOUNDER_EXPOSURE",
  angleId: "FOUNDER_ACCESS",
  editorialThesis: "Direct Founder Partnership & Autonomy",
  primaryQuestion: "Why does this role offer unbureaucratic execution speed?",
  editorialIntent: {
    primaryMessage: "founder_partnership",
    supportingThemes: ["unbureaucratic_speed", "decision_autonomy"],
    avoidThemes: ["institutional_bureaucracy"]
  },
  constraints: {
    requires: {
      organizationType: ["founder_led"]
    },
    avoids: {
      organizationType: ["public_company"]
    }
  },
  slots: {
    headline: (v) => `A direct founder-facing leadership role with immediate decision autonomy at ${v.company}.`,
    opening: (v) => `High-autonomy ${v.role} mandate at ${v.company}, offering direct partnership with the founder office.`,
    editorialBridge: (v) => `Unlocks direct strategic influence at ${v.company} while eliminating enterprise bureaucracy overhead.`,
    decisionGuidance: {
      proceedIf: (v) => `Direct founder exposure and rapid decision velocity at ${v.company} fit your operating style.`,
      pauseIf: () => `Confirm founder willingness to delegate written P&L and hiring authority.`,
      closing: (v) => `Proceed to recruiter screening. Excellent alignment for executives seeking unbureaucratic operating scope at ${v.company}.`
    }
  }
};
