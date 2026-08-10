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
    headline: (v) => `A non-executive board directorship at ${v.company} centered on fiduciary oversight and capital allocation.`,
    opening: (v) => `This appointment provides strategic governance to executive leadership without day-to-day operational responsibilities.`,
    editorialBridge: (v) => `The position expands your non-executive governance network, offering board exposure in an expanding enterprise category.`,
    decisionGuidance: {
      proceedIf: (v) => `Board oversight and strategic capital allocation advisory align with your career horizon.`,
      pauseIf: (v) => `Confirm D&O indemnification terms and committee cadence expectations during initial screening.`,
      closing: (v) => `Proceed. Landmark governance appointment with high strategic visibility.`
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
    headline: (v) => `This ${v.role} mandate consolidates sales, marketing, and customer success at ${v.company} under a unified commercial architecture.`,
    opening: (v) => `The enterprise is unifying top-line revenue strategy to eliminate friction between acquisition and retention teams.`,
    editorialBridge: (v) => `Unifying these commercial levers under one leader establishes the structural authority missing from your recent scope.`,
    decisionGuidance: {
      proceedIf: (v) => `Integrating sales, marketing, and customer success into a single revenue engine matches your CRO track.`,
      pauseIf: (v) => `Sales compensation and customer success incentives remain managed in separate operational silos.`,
      closing: (v) => `Proceed. Total commercial revenue ownership with direct P&L leverage.`
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
    headline: (v) => `${v.company} cannot integrate decision intelligence models until its core data architecture is rebuilt; this ${v.role} seat leads that modernization.`,
    opening: (v) => `Technical debt resides in the core infrastructure. The mandate requires decoupling legacy systems before new capabilities can ship.`,
    editorialBridge: (v) => `Lays the technical foundation for automated decision intelligence across primary operational workflows.`,
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
      pauseIf: (v) => `Clarify written succession review timelines and executive development support during initial screening.`,
      closing: (v) => `Proceed. Direct executive committee visibility with clear succession trajectory.`
    }
  }
};
