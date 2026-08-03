import type { EditorialPattern } from "../EditorialPattern";

// 1. The PE Value Operator
export const archetypePeOperatorPattern: EditorialPattern = {
  id: "archetype-pe-operator-3c",
  strategyId: "CAREER_CAPITAL",
  angleId: "COMMERCIAL_OWNERSHIP",
  executiveIdentity: "Operator",
  editorialPurpose: "Highlight trade-off",
  editorialThesis: "Private Equity 100-Day Value Creation Plan",
  primaryQuestion: "Why do financial returns depend on executing the sponsor's 100-day EBITDA expansion plan?",
  editorialIntent: {
    primaryMessage: "pe_value_creation",
    supportingThemes: ["ebitda_expansion", "sponsor_alignment"],
    avoidThemes: ["holding_pattern"]
  },
  constraints: {
    requires: {
      organizationType: ["private_equity"]
    }
  },
  slots: {
    headline: (v) => `Financial returns in this PE-backed ${v.role} role at ${v.company} depend on executing a structured 100-day EBITDA expansion plan.`,
    opening: (v) => `The sponsor requires disciplined margin improvement, working capital optimization, and rigorous reporting cadence.`,
    editorialBridge: (v) => `Operating rhythm is closely tied to PE investment thesis milestones, offering meaningful equity upside in exchange for compressed execution timelines.`,
    decisionGuidance: {
      proceedIf: (v) => `Executing sponsor value creation roadmaps and driving EBITDA growth under tight deadlines align with your financial discipline.`,
      pauseIf: () => `Confirm equity package vesting terms and sponsor investment horizon before advancing.`,
      closing: (v) => `High-conviction PE opportunity. Strong financial upside for operators comfortable with rigorous sponsor reporting.`
    }
  }
};

// 2. The Global Executive
export const archetypeGlobalExecutivePattern: EditorialPattern = {
  id: "archetype-global-exec-3d",
  strategyId: "CAREER_CAPITAL",
  angleId: "CATEGORY_LEADERSHIP",
  executiveIdentity: "Global Executive",
  editorialPurpose: "Explain recommendation",
  editorialThesis: "Cross-Border Matrix Influence & Local Execution",
  primaryQuestion: "How does this role expand international matrix influence more than direct headcount authority?",
  editorialIntent: {
    primaryMessage: "global_matrix_influence",
    supportingThemes: ["hq_alignment", "cross_geo_execution"],
    avoidThemes: ["subordinate_execution"]
  },
  constraints: {
    requires: {
      organizationType: ["institutional", "public_company"]
    }
  },
  slots: {
    headline: (v) => `Compared with domestic VP roles, this position at ${v.company} expands international matrix influence more than direct headcount authority.`,
    opening: (v) => `The role serves as a strategic bridge between global corporate leadership and regional execution teams.`,
    editorialBridge: (v) => `Success requires translating global corporate directives into locally adapted commercial programs without relying solely on hierarchical authority.`,
    decisionGuidance: {
      proceedIf: (v) => `Navigating international matrix dynamics and building cross-geographic consensus fit your executive maturity.`,
      pauseIf: () => `Clarify reporting lines to global functional leads versus regional managing directors.`,
      closing: (v) => `Worth advancing. Expands global corporate capital and multi-market leadership visibility.`
    }
  }
};
