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
    headline: (v) => `Working directly with the founders of ${v.company}, this ${v.role} role balances strategic vision with operational scaling.`,
    opening: (v) => `The founders are handing over day-to-day execution to build a professional management layer.`,
    editorialBridge: (v) => `Success requires introducing corporate discipline without slowing the decision speed that built the business.`,
    decisionGuidance: {
      proceedIf: (v) => `Partnering with founder-owners while building scalable operating processes fits your style.`,
      pauseIf: (v) => `Establish clear decision rights between founder vision and executive execution.`,
      closing: (v) => `Pursue. High-autonomy mandate for executives who navigate founder partnerships effectively.`
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
    headline: (v) => `This mandate guides ${v.company} through its transition from founder-led operation to professional management structure.`,
    opening: (v) => `The business requires an executive to establish formal operating cadence, reporting rigor, and team accountability.`,
    editorialBridge: (v) => `Success in this role depends on introducing corporate discipline while preserving the agile, entrepreneurial culture that drove early growth.`,
    decisionGuidance: {
      proceedIf: (v) => `Professionalizing operating frameworks and building high-trust founder partnerships suit your experience.`,
      pauseIf: (v) => `Assess founder readiness to relinquish operational veto power over key functions.`,
      closing: (v) => `Consider. A high-impact transition role for seasoned operating executives.`
    }
  }
};
