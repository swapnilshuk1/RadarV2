import type { EditorialPattern } from "../EditorialPattern";

// 1. The PE Value Operator
export const archetypePeOperatorPattern: EditorialPattern = {
  id: "archetype-pe-operator-3c",
  patternFamily: "archetype",
  skeleton: "fact-first",
  strategyId: "CAREER_CAPITAL",
  angleId: "COMMERCIAL_OWNERSHIP",
  executiveIdentity: "Operator",
  editorialPurpose: "Highlight trade-off",
  editorialRisk: "commercial",
  editorialThesis: "Private Equity 100-Day Value Creation Plan",
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
    headline: (v) => `Returns in this PE-backed ${v.role} mandate at ${v.company} depend on executing a structured 100-day EBITDA expansion plan.`,
    opening: (v) => `The sponsor requires disciplined contribution margin improvement, working capital optimization, and quarterly reporting cadence.`,
    editorialBridge: (v) => `Operating rhythm aligns directly with sponsor investment thesis milestones, offering equity upside in exchange for compressed execution timelines.`,
    decisionGuidance: {
      proceedIf: (v) => `Executing sponsor value creation roadmaps under compressed timelines matches your financial discipline.`,
      pauseIf: (v) => `Confirm equity package vesting terms and sponsor investment horizon during initial screening.`,
      closing: (v) => `Proceed. High capital leverage if equity upside compensates for compressed execution timelines.`
    }
  }
};

// 2. The Global Executive
export const archetypeGlobalExecutivePattern: EditorialPattern = {
  id: "archetype-global-exec-3d",
  patternFamily: "archetype",
  skeleton: "comparison-first",
  strategyId: "CAREER_CAPITAL",
  angleId: "CATEGORY_LEADERSHIP",
  executiveIdentity: "Global Executive",
  editorialPurpose: "Explain recommendation",
  editorialRisk: "political",
  editorialThesis: "Cross-Border Matrix Influence & Local Execution",
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
    headline: (v) => `Compared with regional VP roles, this position at ${v.company} expands international matrix influence more than direct headcount authority.`,
    opening: (v) => `Global headquarters sets strategy; regional units execute. The seat acts as the primary bridge between corporate intent and regional delivery.`,
    editorialBridge: (v) => `Success requires translating global directives into locally adapted commercial programs without relying solely on hierarchical authority.`,
    decisionGuidance: {
      proceedIf: (v) => `Navigating international matrix dynamics and building cross-geographic consensus fit your executive maturity.`,
      pauseIf: (v) => `Regional managing directors hold unilateral veto power over functional strategy.`,
      closing: (v) => `Consider. Expands global corporate capital and multi-market leadership visibility.`
    }
  }
};
