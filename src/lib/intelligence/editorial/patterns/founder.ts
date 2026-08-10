import type { EditorialPattern } from "../EditorialPattern";

// 1. The Founder Partner
export const founderPartnerPattern: EditorialPattern = {
  id: "founder-partner-3a",
  patternFamily: "founder",
  skeleton: "observation-first",
  strategyId: "FOUNDER_EXPOSURE",
  angleId: "FOUNDER_ACCESS",
  executiveIdentity: "Builder",
  editorialPurpose: "Surface hidden risk",
  editorialRisk: "political",
  editorialThesis: "Direct Founder Proximity & Decision Velocity",
  editorialIntent: {
    primaryMessage: "founder_proximity",
    supportingThemes: ["unbureaucratic_speed", "alignment_navigation"],
    avoidThemes: ["corporate_bureaucracy"]
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
    headline: (v) => `Reporting directly to the founders of ${v.company}, this ${v.role} mandate pairs strategic vision with operational scaling.`,
    opening: (v) => `The founders are delegating day-to-day execution to establish a professional executive layer.`,
    editorialBridge: (v) => `Success hinges on instituting operational cadence without impeding the decision velocity that built the company.`,
    decisionGuidance: {
      proceedIf: (v) => `Partnering with founder-owners to build scalable operating frameworks matches your operating style.`,
      pauseIf: (v) => `Establish explicit decision rights between founder vision and executive execution during initial screening.`,
      closing: (v) => `Proceed. High-autonomy mandate for executives who navigate founder partnerships effectively.`
    }
  }
};

// 2. The Governance Anchor
export const founderGovernanceAnchorPattern: EditorialPattern = {
  id: "founder-governance-3b",
  patternFamily: "founder",
  skeleton: "consequence-first",
  strategyId: "FOUNDER_EXPOSURE",
  angleId: "FOUNDER_ACCESS",
  executiveIdentity: "Operator",
  editorialPurpose: "Explain recommendation",
  editorialRisk: "governance",
  editorialThesis: "Professional Governance Transition",
  editorialIntent: {
    primaryMessage: "governance_transition",
    supportingThemes: ["professional_management", "founder_trust"],
    avoidThemes: ["bureaucratic_friction"]
  },
  constraints: {
    requires: {
      organizationType: ["founder_led"]
    }
  },
  slots: {
    headline: (v) => `This mandate guides ${v.company} through its transition from founder-led execution to a structured management framework.`,
    opening: (v) => `The enterprise requires an operator to institute formal reporting cadence, financial rigor, and executive accountability.`,
    editorialBridge: (v) => `Success depends on embedding governance rigor while preserving the entrepreneurial speed that drove initial scale.`,
    decisionGuidance: {
      proceedIf: (v) => `Professionalizing operating frameworks and building high-trust founder alignment suit your background.`,
      pauseIf: (v) => `Verify founder readiness to relinquish operational veto power over primary commercial functions.`,
      closing: (v) => `Consider. High-impact transition seat for experienced operating executives.`
    }
  }
};
