import type { EditorialPattern } from "../EditorialPattern";

// 1. The Board Advisor
export const roleBoardAdvisorPattern: EditorialPattern = {
  id: "role-board-director-4a",
  strategyId: "CAREER_CAPITAL",
  angleId: "CATEGORY_LEADERSHIP",
  executiveIdentity: "Board Executive",
  editorialPurpose: "Frame career move",
  editorialRisk: "governance",
  editorialThesis: "Non-Executive Governance & Capital Allocation",
  editorialIntent: {
    primaryMessage: "board_governance",
    supportingThemes: ["fiduciary_oversight", "capital_allocation"],
    avoidThemes: ["operational_micromanagement"]
  },
  constraints: {
    requires: {
      minScore: 75
    }
  },
  slots: {
    headline: (v) => `A non-executive board directorship at ${v.company} focused on fiduciary oversight, capital allocation, and risk management.`,
    opening: (v) => `This appointment provides non-executive governance advisory to executive leadership without operational management responsibility.`,
    editorialBridge: (v) => `The position expands your non-executive governance network, providing strategic board exposure in a growing enterprise segment.`,
    decisionGuidance: {
      proceedIf: (v) => `Stepping into non-executive governance and strategic capital allocation advisory align with your career stage.`,
      pauseIf: () => `Confirm D&O insurance coverage terms and committee cadence expectations.`,
      closing: (v) => `Highest strategic fit. A landmark governance appointment for senior leaders.`
    }
  }
};

// 2. The Revenue Owner (CRO)
export const roleRevenueOwnerPattern: EditorialPattern = {
  id: "role-cro-4b",
  strategyId: "GROWTH_EXPANSION",
  angleId: "COMMERCIAL_OWNERSHIP",
  executiveIdentity: "Scaler",
  editorialPurpose: "Explain recommendation",
  editorialRisk: "commercial",
  editorialThesis: "Full-Funnel Commercial Unification",
  editorialIntent: {
    primaryMessage: "full_funnel_cro",
    supportingThemes: ["revenue_architecture", "commercial_unification"],
    avoidThemes: ["siloed_sales"]
  },
  constraints: {
    requires: {
      hasPnlOwnership: true,
      minScore: 70
    }
  },
  slots: {
    headline: (v) => `This ${v.role} mandate consolidates sales, marketing, and customer success at ${v.company} under a single commercial structure.`,
    opening: (v) => `The organization is unifying top-line revenue strategy to eliminate handoff friction between customer acquisition and retention teams.`,
    editorialBridge: (v) => `Placing full-funnel revenue ownership under one executive owner establishes clear commercial accountability across all go-to-market channels.`,
    decisionGuidance: {
      proceedIf: (v) => `Unifying sales, marketing, and customer success into a cohesive revenue engine matches your CRO background.`,
      pauseIf: () => `Examine sales compensation structures and cross-team incentive alignment.`,
      closing: (v) => `Strong recommendation. Total commercial revenue ownership with direct P&L leverage.`
    }
  }
};

// 3. The Technology Strategist (CTO)
export const roleTechnologyStrategistPattern: EditorialPattern = {
  id: "role-cto-4c",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  executiveIdentity: "Operator",
  editorialPurpose: "Increase conviction",
  editorialRisk: "technical",
  editorialThesis: "Enterprise AI & Architecture Modernization",
  editorialIntent: {
    primaryMessage: "cto_ai_architecture",
    supportingThemes: ["data_mesh", "ai_readiness"],
    avoidThemes: ["maintenance_it"]
  },
  constraints: {
    requires: {
      transformationStage: ["modernization"]
    }
  },
  slots: {
    headline: (v) => `This ${v.role} position prepares core data infrastructure at ${v.company} for enterprise AI model integration.`,
    opening: (v) => `The mandate focuses on modernizing software architecture, cloud data pipelines, and engineering governance.`,
    editorialBridge: (v) => `Lays the technical foundation for automated decision intelligence across core operational and customer-facing workflows.`,
    decisionGuidance: {
      proceedIf: (v) => `Building enterprise data pipelines and preparing legacy software architectures for AI scale suit your technical depth.`,
      pauseIf: () => `Confirm R&D resource allocations and cloud infrastructure commitments.`,
      closing: (v) => `Recommended for review. Foundational technology architecture mandate.`
    }
  }
};

// 4. The C-Suite Successor
export const roleCsuiteSuccessorPattern: EditorialPattern = {
  id: "role-vp-expansion-4d",
  strategyId: "CAREER_CAPITAL",
  angleId: "CAREER_ACCELERATION",
  executiveIdentity: "Scaler",
  editorialPurpose: "Frame career move",
  editorialRisk: "career",
  editorialThesis: "Executive Scope Expansion & C-Suite Trajectory",
  editorialIntent: {
    primaryMessage: "csuite_succession",
    supportingThemes: ["scope_expansion", "board_exposure"],
    avoidThemes: ["terminal_role"]
  },
  constraints: {
    requires: {
      hasPnlOwnership: true,
      minScore: 65
    }
  },
  slots: {
    headline: (v) => `This ${v.role} mandate at ${v.company} combines expanded operational scope with an explicit C-suite succession trajectory.`,
    opening: (v) => `The position provides direct exposure to the executive committee and board of directors while managing key P&L units.`,
    editorialBridge: (v) => `Serves as a deliberate career stepping stone, broadening your executive scope beyond single-function leadership.`,
    decisionGuidance: {
      proceedIf: (v) => `Expanding P&L scope while positioning for C-suite succession align with your long-term goals.`,
      pauseIf: () => `Clarify written succession review timelines and executive development support.`,
      closing: (v) => `Proceed to screening. Excellent career acceleration role with clear C-suite trajectory.`
    }
  }
};
