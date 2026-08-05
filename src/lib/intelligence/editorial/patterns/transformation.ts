import type { EditorialPattern } from "../EditorialPattern";

// 1. The Digital Modernizer
export const transformationDigitalModernizerPattern: EditorialPattern = {
  id: "transform-digital-2a",
  patternFamily: "transformation",
  skeleton: "consequence-first",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  executiveIdentity: "Operator",
  editorialPurpose: "Surface hidden risk",
  editorialRisk: "execution",
  editorialThesis: "Operational Reset & Digital Modernization",
  editorialIntent: {
    primaryMessage: "operational_reset",
    supportingThemes: ["digital_modernization", "acquisition_automation"],
    avoidThemes: ["superficial_change"]
  },
  constraints: {
    requires: {
      transformationStage: ["modernization", "turnaround"],
      minScore: 50
    }
  },
  slots: {
    headline: (v) => `${v.company} is losing commercial speed to digital-native competitors; this ${v.role} mandate automates customer acquisition workflows.`,
    opening: (v) => `Legacy manual processes are choking transaction throughput. The board has prioritized an operational reset across primary commercial channels.`,
    editorialBridge: (v) => `This role shifts your focus from managing operational volume to building automated commercial infrastructure.`,
    decisionGuidance: {
      proceedIf: (v) => `Leading enterprise digital modernization and process automation matches your track record.`,
      pauseIf: (v) => `Evaluate legacy technical debt and IT budget allocations before proceeding.`,
      closing: (v) => `Pursue. High-impact commercial modernization with clear board sponsorship.`
    }
  }
};

// 2. The Turnaround Operator
export const transformationTurnaroundLeaderPattern: EditorialPattern = {
  id: "transform-turnaround-2b",
  patternFamily: "transformation",
  skeleton: "fact-first",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  executiveIdentity: "Turnaround Leader",
  editorialPurpose: "Surface hidden risk",
  editorialRisk: "execution",
  editorialThesis: "Commercial Restructuring & Margin Optimization",
  editorialIntent: {
    primaryMessage: "operational_reset",
    supportingThemes: ["margin_optimization", "cost_restructuring"],
    avoidThemes: ["superficial_change"]
  },
  constraints: {
    requires: {
      transformationStage: ["turnaround"],
      minScore: 50
    }
  },
  slots: {
    headline: (v) => `Executing a commercial turnaround at ${v.company} requires immediate margin optimization and operational restructuring.`,
    opening: (v) => `The business needs a decisive operator to streamline cost structures and restore top-line profitability.`,
    editorialBridge: (v) => `This mandate carries high risk, but successful execution establishes an undeniable turnaround track record.`,
    decisionGuidance: {
      proceedIf: (v) => `Driving commercial turnarounds under tight financial constraints fits your risk profile.`,
      pauseIf: (v) => `Debt covenants leave fewer than twelve months to achieve positive cash flow.`,
      closing: (v) => `Consider. High operational visibility, provided restructuring authority is explicitly defined.`
    }
  }
};

// 3. The Org Architect
export const transformationOrgArchitectPattern: EditorialPattern = {
  id: "transformation-org-2c",
  patternFamily: "transformation",
  skeleton: "consequence-first",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  executiveIdentity: "Operator",
  editorialPurpose: "Explain recommendation",
  editorialRisk: "political",
  editorialThesis: "Target Operating Model & Friction Reduction",
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
      pauseIf: (v) => `Verify CEO backing for proposed structural changes across business units.`,
      closing: (v) => `Proceed to screening. High operational impact for executives skilled in organizational design.`
    }
  }
};
