import type { EditorialPattern } from "../EditorialPattern";

// 1. The Board Advisor
export const roleBoardAdvisorPattern: EditorialPattern = {
  id: "role-board-director-4a",
  patternFamily: "role",
  skeleton: "fact-first",
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
    opening: (v) => `This appointment provides strategic governance to executive leadership without operational management responsibility.`,
    editorialBridge: (v) => `The position expands your non-executive governance network, providing strategic board exposure in a growing enterprise segment.`,
    decisionGuidance: {
      proceedIf: (v) => `Board oversight and strategic capital allocation advisory align with your career stage.`,
      pauseIf: (v) => `Confirm D&O insurance coverage terms and committee cadence expectations.`,
      closing: (v) => `Pursue. A landmark governance appointment with high strategic visibility.`
    }
  }
};

// 2. The Revenue Owner (CRO)
export const roleRevenueOwnerPattern: EditorialPattern = {
  id: "role-cro-4b",
  patternFamily: "role",
  skeleton: "consequence-first",
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
    editorialBridge: (v) => `Unifying these functions under one leader creates the commercial authority missing from your recent scope.`,
    decisionGuidance: {
      proceedIf: (v) => `Integrating sales, marketing and customer success into one revenue engine matches your CRO background.`,
      pauseIf: (v) => `Sales compensation and customer success incentives remain managed in separate silos.`,
      closing: (v) => `Pursue. Total commercial revenue ownership with direct P&L leverage.`
    }
  }
};

// 3. The Technology Strategist (CTO)
export const roleTechnologyStrategistPattern: EditorialPattern = {
  id: "role-cto-4c",
  patternFamily: "role",
  skeleton: "consequence-first",
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
    headline: (v) => `${v.company} cannot integrate AI models until its data pipelines are rebuilt; this ${v.role} role leads that modernization.`,
    opening: (v) => `The technical debt is in the core architecture. The mandate requires decoupling legacy systems before new capabilities can ship.`,
    editorialBridge: (v) => `Lays the technical foundation for automated decision intelligence across core operational workflows.`,
    decisionGuidance: {
      proceedIf: (v) => `Rebuilding enterprise data pipelines and decoupling legacy software architectures suit your technical depth.`,
      pauseIf: (v) => `Confirm R&D resource allocations and cloud infrastructure commitments before proceeding.`,
      closing: (v) => `Consider. Foundational technology architecture mandate with high technical leverage.`
    }
  }
};

// 4. The C-Suite Successor
export const roleCsuiteSuccessorPattern: EditorialPattern = {
  id: "role-vp-expansion-4d",
  patternFamily: "role",
  skeleton: "consequence-first",
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
      pauseIf: (v) => `Clarify written succession review timelines and executive development support.`,
      closing: (v) => `Pursue. Direct executive committee visibility with clear succession trajectory.`
    }
  }
};
