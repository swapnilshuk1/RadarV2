import type { EditorialPattern } from "../EditorialPattern";

// 1. Board Advisory & Committee Directorship
export const roleBoardDirectorPattern: EditorialPattern = {
  id: "role-board-director-4a",
  strategyId: "CAREER_CAPITAL",
  angleId: "CATEGORY_LEADERSHIP",
  editorialThesis: "Board Advisory & Governance Directorship",
  primaryQuestion: "Why is this board directorship a landmark career milestone?",
  editorialIntent: {
    primaryMessage: "board_directorship",
    supportingThemes: ["governance_stewardship", "fiduciary_oversight"],
    avoidThemes: ["operational_micromanagement"]
  },
  constraints: {
    requires: {
      minScore: 75
    }
  },
  slots: {
    headline: (v) => `A landmark Board Advisory directorship providing non-executive governance oversight at ${v.company}.`,
    opening: (v) => `Board Director appointment at ${v.company}, advising executive leadership on strategic capital allocation, risk, and corporate governance.`,
    editorialBridge: (v) => `Elevates your professional profile to non-executive board governance for ${v.company}, expanding your strategic advisory network.`,
    decisionGuidance: {
      proceedIf: (v) => `Stepping into non-executive board governance and strategic fiduciary oversight at ${v.company} match your career stage.`,
      pauseIf: () => `Confirm D&O insurance coverage limits and board committee meeting cadences.`,
      closing: (v) => `Highest-conviction opportunity. Landmark non-executive board directorship at ${v.company}.`
    }
  }
};

// 2. Chief Digital Officer (CDO) Enterprise Digitization
export const roleCdoPattern: EditorialPattern = {
  id: "role-cdo-4b",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  editorialThesis: "Chief Digital Officer (CDO) Enterprise Digitization",
  primaryQuestion: "How will you lead the digital transformation agenda?",
  editorialIntent: {
    primaryMessage: "cdo_digitization",
    supportingThemes: ["digital_roadmap", "tech_enabled_growth"],
    avoidThemes: ["siloed_it"]
  },
  constraints: {
    requires: {
      transformationStage: ["modernization"]
    }
  },
  slots: {
    headline: (v) => `Chief Digital Officer (CDO) mandate orchestrating enterprise digitization at ${v.company}.`,
    opening: (v) => `Chief Digital Officer position at ${v.company}, leading the strategic digital roadmap across customer, product, and operational touchpoints.`,
    editorialBridge: (v) => `Positions you as the primary architect of digital capability for ${v.company}, transforming traditional operations into high-margin digital workflows.`,
    decisionGuidance: {
      proceedIf: (v) => `Owning full enterprise digital transformation strategy and technology investments at ${v.company} fits your executive ambition.`,
      pauseIf: () => `Verify direct reporting access to CEO and technology budget allocation.`,
      closing: (v) => `Recommended first. Premier Chief Digital Officer mandate at ${v.company}.`
    }
  }
};

// 3. Chief Revenue Officer (CRO) Scalable Revenue Architecture
export const roleCroPattern: EditorialPattern = {
  id: "role-cro-4c",
  strategyId: "GROWTH_EXPANSION",
  angleId: "COMMERCIAL_OWNERSHIP",
  editorialThesis: "Chief Revenue Officer (CRO) Full-Funnel Revenue Engine",
  primaryQuestion: "How will you unify sales, marketing, and customer success into one revenue engine?",
  editorialIntent: {
    primaryMessage: "cro_revenue_engine",
    supportingThemes: ["full_funnel_revenue", "sales_marketing_alignment"],
    avoidThemes: ["siloed_sales"]
  },
  constraints: {
    requires: {
      hasPnlOwnership: true,
      minScore: 70
    }
  },
  slots: {
    headline: (v) => `Chief Revenue Officer (CRO) mandate unifying full-funnel commercial engines at ${v.company}.`,
    opening: (v) => `Chief Revenue Officer appointment at ${v.company}, owning total top-line revenue strategy across sales, marketing, and account management.`,
    editorialBridge: (v) => `Consolidates all customer acquisition and expansion channels under your unified commercial leadership for ${v.company}.`,
    decisionGuidance: {
      proceedIf: (v) => `Unifying enterprise sales, marketing, and customer success into a single revenue engine at ${v.company} matches your CRO track record.`,
      pauseIf: () => `Confirm commission structure, quota targets, and sales engineering alignment.`,
      closing: (v) => `Proceed this week. High-impact Chief Revenue Officer mandate with total commercial ownership at ${v.company}.`
    }
  }
};

// 4. Chief Customer Officer (CCO) Retention & Expansion
export const roleCcoPattern: EditorialPattern = {
  id: "role-cco-4d",
  strategyId: "GROWTH_EXPANSION",
  angleId: "COMMERCIAL_OWNERSHIP",
  editorialThesis: "Chief Customer Officer (CCO) Retention & Net Revenue Retention (NRR)",
  primaryQuestion: "How will you maximize Net Revenue Retention (NRR)?",
  editorialIntent: {
    primaryMessage: "cco_nrr_scale",
    supportingThemes: ["customer_success", "nrr_expansion"],
    avoidThemes: ["churn_reaction"]
  },
  constraints: {
    requires: {
      minScore: 65
    }
  },
  slots: {
    headline: (v) => `Chief Customer Officer (CCO) mandate driving Net Revenue Retention (NRR) scale at ${v.company}.`,
    opening: (v) => `Chief Customer Officer role at ${v.company}, tasked with scaling post-sale customer success, onboarding, and account expansion.`,
    editorialBridge: (v) => `Transforms post-sale customer management at ${v.company} into a predictable driver of negative churn and recurring upsell revenue.`,
    decisionGuidance: {
      proceedIf: (v) => `Driving Net Revenue Retention (NRR) above benchmarks and building world-class customer success organizations at ${v.company} excite you.`,
      pauseIf: () => `Verify expansion quota targets and customer support escalation workflows.`,
      closing: (v) => `Invest your time here. Essential CCO mandate with direct recurring revenue impact at ${v.company}.`
    }
  }
};

// 5. Chief Marketing Officer (CMO) Brand & Performance
export const roleCmoPattern: EditorialPattern = {
  id: "role-cmo-4e",
  strategyId: "GROWTH_EXPANSION",
  angleId: "CATEGORY_LEADERSHIP",
  editorialThesis: "Chief Marketing Officer (CMO) Category Growth & Brand Equity",
  primaryQuestion: "How will you elevate brand equity while scaling demand generation?",
  editorialIntent: {
    primaryMessage: "cmo_category_growth",
    supportingThemes: ["brand_equity", "demand_generation"],
    avoidThemes: ["pure_vendor"]
  },
  constraints: {
    requires: {
      minScore: 65
    }
  },
  slots: {
    headline: (v) => `Chief Marketing Officer (CMO) mandate scaling category market share and brand equity at ${v.company}.`,
    opening: (v) => `Chief Marketing Officer appointment at ${v.company}, driving overall marketing strategy, brand positioning, and demand generation.`,
    editorialBridge: (v) => `Combines strategic brand building with rigorous performance marketing metrics to dominate category mindshare for ${v.company}.`,
    decisionGuidance: {
      proceedIf: (v) => `Leading end-to-end marketing strategy and scaling brand positioning at ${v.company} match your executive history.`,
      pauseIf: () => `Confirm annual working media budget and agency roster alignment.`,
      closing: (v) => `One to prioritize. High-profile Chief Marketing Officer mandate at ${v.company}.`
    }
  }
};

// 6. Chief Growth Officer (CGO) Cross-Functional Scale
export const roleCgoPattern: EditorialPattern = {
  id: "role-cgo-4f",
  strategyId: "GROWTH_EXPANSION",
  angleId: "COMMERCIAL_OWNERSHIP",
  editorialThesis: "Chief Growth Officer (CGO) Cross-Functional Commercial Scale",
  primaryQuestion: "How will you break functional silos to unlock exponential growth?",
  editorialIntent: {
    primaryMessage: "cgo_cross_functional",
    supportingThemes: ["growth_loops", "cross_functional_scale"],
    avoidThemes: ["siloed_marketing"]
  },
  constraints: {
    requires: {
      hasPnlOwnership: true,
      minScore: 70
    }
  },
  slots: {
    headline: (v) => `Chief Growth Officer (CGO) mandate driving cross-functional commercial acceleration at ${v.company}.`,
    opening: (v) => `Chief Growth Officer position at ${v.company}, connecting marketing, product, and sales data to accelerate customer acquisition.`,
    editorialBridge: (v) => `Breaks down traditional departmental silos at ${v.company} to deploy rapid commercial growth loops.`,
    decisionGuidance: {
      proceedIf: (v) => `Leading cross-functional growth squads spanning product, marketing, and sales at ${v.company} match your execution style.`,
      pauseIf: () => `Confirm executive committee mandate authority across product and marketing teams.`,
      closing: (v) => `High-conviction opportunity. Premier CGO growth leadership mandate at ${v.company}.`
    }
  }
};

// 7. Chief Technology Officer (CTO) Tech & AI Architecture
export const roleCtoPattern: EditorialPattern = {
  id: "role-cto-4g",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  editorialThesis: "Chief Technology Officer (CTO) AI & Engineering Architecture",
  primaryQuestion: "How will you build enterprise AI capabilities and scale engineering?",
  editorialIntent: {
    primaryMessage: "cto_ai_engineering",
    supportingThemes: ["ai_architecture", "engineering_excellence"],
    avoidThemes: ["legacy_it_maintenance"]
  },
  constraints: {
    requires: {
      transformationStage: ["modernization"]
    }
  },
  slots: {
    headline: (v) => `Chief Technology Officer (CTO) mandate scaling engineering architecture and AI platforms at ${v.company}.`,
    opening: (v) => `Chief Technology Officer appointment at ${v.company}, leading long-term software architecture, cloud platforms, and AI engineering.`,
    editorialBridge: (v) => `Establishes world-class engineering standards for ${v.company}, positioning the enterprise at the forefront of AI technological innovation.`,
    decisionGuidance: {
      proceedIf: (v) => `Leading global engineering organizations and deploying enterprise AI architecture at ${v.company} match your technical depth.`,
      pauseIf: () => `Verify R&D budget allocation and intellectual property filing targets.`,
      closing: (v) => `Proceed to recruiter screening. Landmark CTO engineering leadership mandate at ${v.company}.`
    }
  }
};

// 8. Chief Product Officer (CPO) Product Vision & Monetization
export const roleCpoPattern: EditorialPattern = {
  id: "role-cpo-4h",
  strategyId: "GROWTH_EXPANSION",
  angleId: "CATEGORY_LEADERSHIP",
  editorialThesis: "Chief Product Officer (CPO) Product Strategy & Monetization",
  primaryQuestion: "How will product vision drive sustainable commercial monetization?",
  editorialIntent: {
    primaryMessage: "cpo_product_monetization",
    supportingThemes: ["product_vision", "monetization_roadmap"],
    avoidThemes: ["feature_factory"]
  },
  constraints: {
    requires: {
      minScore: 65
    }
  },
  slots: {
    headline: (v) => `Chief Product Officer (CPO) mandate defining global product roadmap and monetization at ${v.company}.`,
    opening: (v) => `Chief Product Officer role at ${v.company}, owning product vision, UX design, and commercial feature monetization.`,
    editorialBridge: (v) => `Connects user experience design with commercial monetization models at ${v.company} to maximize customer willingness to pay.`,
    decisionGuidance: {
      proceedIf: (v) => `Defining product strategy, leading UX design teams, and scaling product monetization at ${v.company} fit your career trajectory.`,
      pauseIf: () => `Confirm product design team size and engineering roadmap alignment.`,
      closing: (v) => `Deserves immediate attention. High-impact Chief Product Officer mandate at ${v.company}.`
    }
  }
};

// 9. Chief Operating Officer (COO) P&L Execution
export const roleCooPattern: EditorialPattern = {
  id: "role-coo-4i",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  editorialThesis: "Chief Operating Officer (COO) P&L Execution & Operational Discipline",
  primaryQuestion: "How will you translate strategic vision into operational execution?",
  editorialIntent: {
    primaryMessage: "coo_pnl_execution",
    supportingThemes: ["operational_discipline", "pnl_execution"],
    avoidThemes: ["theoretical_strategy"]
  },
  constraints: {
    requires: {
      hasPnlOwnership: true,
      minScore: 70
    }
  },
  slots: {
    headline: (v) => `Chief Operating Officer (COO) mandate driving operational execution and P&L scale at ${v.company}.`,
    opening: (v) => `Chief Operating Officer position at ${v.company}, owning day-to-day business operations, P&L execution, and organizational rhythm.`,
    editorialBridge: (v) => `Serves as the operational engine for ${v.company}, turning strategic board directives into disciplined daily execution.`,
    decisionGuidance: {
      proceedIf: (v) => `Owning full day-to-day operational execution and driving P&L margin discipline at ${v.company} match your COO experience.`,
      pauseIf: () => `Verify division of responsibilities between CEO and COO office.`,
      closing: (v) => `Strong recommendation. Essential Chief Operating Officer mandate at ${v.company}.`
    }
  }
};

// 10. VP/SVP Scope Expansion to C-Suite Trajectory
export const roleVpExpansionPattern: EditorialPattern = {
  id: "role-vp-expansion-4j",
  strategyId: "CAREER_CAPITAL",
  angleId: "CAREER_ACCELERATION",
  editorialThesis: "VP/SVP Scope Expansion & C-Suite Succession Trajectory",
  primaryQuestion: "Why is this VP role the direct stepping stone to C-suite succession?",
  editorialIntent: {
    primaryMessage: "vp_csuite_trajectory",
    supportingThemes: ["succession_pipeline", "scope_expansion"],
    avoidThemes: ["terminal_vp"]
  },
  constraints: {
    requires: {
      hasPnlOwnership: true,
      minScore: 65
    }
  },
  slots: {
    headline: (v) => `SVP/VP scope expansion mandate with explicit C-suite succession trajectory at ${v.company}.`,
    opening: (v) => `Senior Vice President ${v.role} position at ${v.company}, structured with expanded P&L scope and direct C-suite succession tracking.`,
    editorialBridge: (v) => `Positions you in the immediate C-suite succession pipeline for ${v.company}, expanding your executive scope and board exposure.`,
    decisionGuidance: {
      proceedIf: (v) => `Expanding executive P&L scope while positioning for C-suite succession at ${v.company} align with your career goals.`,
      pauseIf: () => `Confirm written succession evaluation cadence and executive coaching commitment.`,
      closing: (v) => `Proceed to recruiter screening. High-potential executive acceleration mandate at ${v.company}.`
    }
  }
};
