import type { EditorialPattern } from "../EditorialPattern";

// 1. The Founder Partner
export const founderPartnerPattern: EditorialPattern = {
  id: "founder-partner-3a",
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
    headline: (v) => `Direct proximity to the founder office at ${v.company} provides unbureaucratic decision speed, though strategic alignment requires ongoing navigation.`,
    opening: (v) => `This ${v.role} mandate offers immediate operational latitude, bypassing conventional corporate steering committees.`,
    editorialBridge: (v) => `The primary execution leverage stems from rapid capital and hiring decisions, balanced against the need to build deep trust with the founder.`,
    decisionGuidance: {
      proceedIf: (v) => `Thriving in founder-led environments with high decision velocity and informal governance matches your working style.`,
      pauseIf: () => `Confirm founder willingness to delegate written P&L authority during initial discussions.`,
      closing: (v) => `Worth pursuing. High-autonomy mandate for executives who navigate founder partnerships effectively.`
    }
  }
};

// 2. The Governance Anchor
export const founderGovernanceAnchorPattern: EditorialPattern = {
  id: "founder-governance-3b",
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
      pauseIf: () => `Assess founder readiness to relinquish operational veto power over key functions.`,
      closing: (v) => `Recommended for screening. A high-impact transition role for seasoned operating executives.`
    }
  }
};
