import type { EditorialPattern } from "../EditorialPattern";

// 1. The Turnaround Leader
export const transformationTurnaroundLeaderPattern: EditorialPattern = {
  id: "transformation-turnaround-2a",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  executiveIdentity: "Turnaround Leader",
  editorialPurpose: "Surface hidden risk",
  editorialThesis: "Operational Reset & System Modernization",
  primaryQuestion: "How does this role shift accountability from functional maintenance to an enterprise reset?",
  editorialIntent: {
    primaryMessage: "operational_reset",
    supportingThemes: ["systemic_modernization", "board_sponsorship"],
    avoidThemes: ["superficial_change"]
  },
  constraints: {
    requires: {
      transformationStage: ["modernization", "turnaround"],
      minScore: 50
    }
  },
  slots: {
    headline: (v) => `The mandate at ${v.company} shifts accountability from functional maintenance to an operational reset.`,
    opening: (v) => `Rather than managing incremental improvements, this ${v.role} position requires restructuring legacy workflows and establishing new performance baselines.`,
    editorialBridge: (v) => `The role carries direct board visibility, though success depends on overcoming embedded organizational inertia and legacy process friction.`,
    decisionGuidance: {
      proceedIf: (v) => `Leading complex operational resets and enforcing new execution standards align with your background.`,
      pauseIf: () => `Confirm executive sponsorship and budget commitment for systemic change before proceeding.`,
      closing: (v) => `Recommended with clear boundaries. High operational visibility, provided restructuring authority is explicitly defined.`
    }
  }
};

// 2. The Systems Architect
export const transformationSystemsArchitectPattern: EditorialPattern = {
  id: "transformation-systems-2b",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  executiveIdentity: "Operator",
  editorialPurpose: "Highlight trade-off",
  editorialThesis: "Technical Debt Decoupling & Architecture Resilience",
  primaryQuestion: "Why does technical debt reduction take precedence over short-term feature speed?",
  editorialIntent: {
    primaryMessage: "technical_debt_decoupling",
    supportingThemes: ["architecture_resilience", "cloud_decoupling"],
    avoidThemes: ["patchwork_fixes"]
  },
  constraints: {
    requires: {
      transformationStage: ["modernization"]
    }
  },
  slots: {
    headline: (v) => `Technical debt reduction takes explicit precedence over short-term feature velocity in this ${v.role} mandate at ${v.company}.`,
    opening: (v) => `The business is decoupling monolithic legacy systems to rebuild core operational reliability and data flow integrity.`,
    editorialBridge: (v) => `This operational shift reduces system fragility over time, though it creates near-term friction with business units accustomed to rapid feature delivery.`,
    decisionGuidance: {
      proceedIf: (v) => `Decoupling legacy architecture and building resilient technical infrastructure match your core capabilities.`,
      pauseIf: () => `Validate executive patience for foundational infrastructure work versus commercial product requests.`,
      closing: (v) => `A solid technical mandate. Offers long-term architecture ownership for leaders comfortable managing stakeholder trade-offs.`
    }
  }
};

// 3. The Org Architect
export const transformationOrgArchitectPattern: EditorialPattern = {
  id: "transformation-org-2c",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  executiveIdentity: "Operator",
  editorialPurpose: "Explain recommendation",
  editorialThesis: "Target Operating Model & Friction Reduction",
  primaryQuestion: "How will this role re-architect reporting boundaries to eliminate operational friction?",
  editorialIntent: {
    primaryMessage: "operating_model_rearchitecture",
    supportingThemes: ["friction_elimination", "accountability_clarity"],
    avoidThemes: ["reorg_for_reorg_sake"]
  },
  constraints: {
    requires: {
      transformationStage: ["turnaround", "modernization"]
    }
  },
  slots: {
    headline: (v) => `This position re-architects reporting boundaries at ${v.company} to eliminate operational friction between product and commercial teams.`,
    opening: (v) => `The mandate focuses on redesigning the target operating model to clarify team accountabilities and decision rights.`,
    editorialBridge: (v) => `Unlike traditional restructuring roles, this effort prioritizes workflow velocity and cross-functional alignment over headcount reductions.`,
    decisionGuidance: {
      proceedIf: (v) => `Redesigning operating models and establishing clear organizational accountabilities suit your leadership style.`,
      pauseIf: () => `Verify CEO backing for proposed structural changes across business units.`,
      closing: (v) => `Proceed to screening. High operational impact for executives skilled in organizational design.`
    }
  }
};
