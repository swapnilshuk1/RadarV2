import type { EditorialPattern } from "../EditorialPattern";

// 1. Founder-Led Transition to Professional Management
export const archetypeFounderTransitionPattern: EditorialPattern = {
  id: "archetype-founder-transition-3b",
  strategyId: "FOUNDER_EXPOSURE",
  angleId: "FOUNDER_ACCESS",
  editorialThesis: "Founder-to-Professional Leadership Transition",
  primaryQuestion: "How will you guide the founder from operator to board chairman?",
  editorialIntent: {
    primaryMessage: "founder_transition",
    supportingThemes: ["professional_governance", "delegation_trust"],
    avoidThemes: ["micro_management"]
  },
  constraints: {
    requires: {
      organizationType: ["founder_led"]
    }
  },
  slots: {
    headline: (v) => `A high-trust leadership mandate guiding founder transition to professional governance at ${v.company}.`,
    opening: (v) => `Executive ${v.role} role at ${v.company}, partnering with the founder to professionalize operations and establish corporate governance.`,
    editorialBridge: (v) => `Builds institutional operating infrastructure at ${v.company} while preserving the founder's visionary spirit.`,
    decisionGuidance: {
      proceedIf: (v) => `Guiding founders through professional governance transitions at ${v.company} matches your emotional intelligence and executive seniority.`,
      pauseIf: () => `Confirm founder readiness to relinquish operational veto power over hiring and budget.`,
      closing: (v) => `Proceed to recruiter screening. High-impact founder transition mandate at ${v.company}.`
    }
  }
};

// 2. Private Equity Value Creation Plan (100-Day Acceleration)
export const archetypePeValueCreationPattern: EditorialPattern = {
  id: "archetype-pe-value-creation-3c",
  strategyId: "CAREER_CAPITAL",
  angleId: "COMMERCIAL_OWNERSHIP",
  editorialThesis: "Private Equity Value Creation & EBITDA Scaling",
  primaryQuestion: "How will you execute the PE sponsor's 100-day value creation plan?",
  editorialIntent: {
    primaryMessage: "pe_value_creation",
    supportingThemes: ["ebitda_expansion", "100_day_plan"],
    avoidThemes: ["holding_pattern"]
  },
  constraints: {
    requires: {
      organizationType: ["private_equity"]
    }
  },
  slots: {
    headline: (v) => `Private equity value creation mandate driving EBITDA expansion at ${v.company}.`,
    opening: (v) => `PE-backed ${v.role} position at ${v.company}, tasked with executing the sponsor's 100-day value creation roadmap.`,
    editorialBridge: (v) => `Directly aligns your execution rhythm with PE sponsor hurdle rates and financial return milestones for ${v.company}.`,
    decisionGuidance: {
      proceedIf: (v) => `Working alongside private equity sponsors to drive rapid EBITDA growth at ${v.company} fits your financial discipline.`,
      pauseIf: () => `Verify equity co-investment package and sponsor investment thesis alignment.`,
      closing: (v) => `Highest-conviction opportunity. Premier PE value creation mandate with meaningful equity upside at ${v.company}.`
    }
  }
};

// 3. PE Portfolio Exit Readiness
export const archetypePeExitReadinessPattern: EditorialPattern = {
  id: "archetype-pe-exit-readiness-3d",
  strategyId: "CAREER_CAPITAL",
  angleId: "COMMERCIAL_OWNERSHIP",
  editorialThesis: "PE Portfolio Exit Readiness & Multiples Expansion",
  primaryQuestion: "How will you position the asset for a successful exit?",
  editorialIntent: {
    primaryMessage: "exit_readiness",
    supportingThemes: ["valuation_multiples", "exit_preparation"],
    avoidThemes: ["unprepared_due_diligence"]
  },
  constraints: {
    requires: {
      organizationType: ["private_equity"]
    }
  },
  slots: {
    headline: (v) => `PE portfolio exit mandate maximizing enterprise valuation multiples at ${v.company}.`,
    opening: (v) => `Exit-focused ${v.role} executive role at ${v.company}, positioning operational metrics for secondary PE sale or IPO.`,
    editorialBridge: (v) => `Prepares business metrics and governance disclosures for ${v.company} to survive institutional buyer due diligence.`,
    decisionGuidance: {
      proceedIf: (v) => `Preparing PE portfolio companies for successful strategic exit transactions at ${v.company} matches your career goal.`,
      pauseIf: () => `Confirm expected exit horizon timeline and management incentive plan payout triggers.`,
      closing: (v) => `Recommended first. High-upside PE exit positioning mandate at ${v.company}.`
    }
  }
};

// 4. Corporate Carve-Out & Standalone Build
export const archetypePeCarveoutPattern: EditorialPattern = {
  id: "archetype-pe-carveout-3e",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  editorialThesis: "Corporate Carve-Out & Standalone P&L Build",
  primaryQuestion: "How will you build standalone operations after divestiture?",
  editorialIntent: {
    primaryMessage: "carveout_standalone",
    supportingThemes: ["tsa_exit", "standalone_pnl"],
    avoidThemes: ["parent_dependency"]
  },
  constraints: {
    requires: {
      organizationType: ["private_equity", "institutional"]
    }
  },
  slots: {
    headline: (v) => `Corporate carve-out mandate building standalone enterprise infrastructure at ${v.company}.`,
    opening: (v) => `Carve-out ${v.role} position at ${v.company}, leading the separation from parent company TSAs to establish standalone operations.`,
    editorialBridge: (v) => `Transitions ${v.company} from parent corporate dependency to an autonomous, lean operating business.`,
    decisionGuidance: {
      proceedIf: (v) => `Building standalone IT, HR, and finance functions during corporate carve-outs at ${v.company} match your capabilities.`,
      pauseIf: () => `Validate Transition Service Agreement (TSA) cost schedules and exit deadlines.`,
      closing: (v) => `Deserves immediate attention. Rare corporate carve-out leadership mandate at ${v.company}.`
    }
  }
};

// 5. Global HQ to Regional Market Operating Bridge
export const archetypeGlobalHqLiaisonPattern: EditorialPattern = {
  id: "archetype-global-hq-liaison-3f",
  strategyId: "CAREER_CAPITAL",
  angleId: "CATEGORY_LEADERSHIP",
  editorialThesis: "Global HQ Strategic Alignment & Local Market Execution",
  primaryQuestion: "How will you bridge global strategy with local market reality?",
  editorialIntent: {
    primaryMessage: "global_local_bridge",
    supportingThemes: ["hq_influence", "local_adaptation"],
    avoidThemes: ["subordinate_execution"]
  },
  constraints: {
    requires: {
      organizationType: ["institutional", "public_company"]
    }
  },
  slots: {
    headline: (v) => `Global executive bridge mandate aligning international HQ strategy with local market execution at ${v.company}.`,
    opening: (v) => `Senior ${v.role} position at ${v.company}, serving as the strategic bridge between global executive leadership and regional teams.`,
    editorialBridge: (v) => `Translates global corporate directives for ${v.company} into locally adapted, high-converting commercial programs.`,
    decisionGuidance: {
      proceedIf: (v) => `Navigating global HQ dynamics while maintaining local market responsiveness at ${v.company} fits your executive maturity.`,
      pauseIf: () => `Confirm direct reporting lines to global functional chiefs vs country managers.`,
      closing: (v) => `Worth prioritizing. High-visibility global alignment mandate at ${v.company}.`
    }
  }
};

// 6. Complex Multi-Geo Matrix Leadership
export const archetypeGlobalMatrixLeadPattern: EditorialPattern = {
  id: "archetype-global-matrix-lead-3g",
  strategyId: "CAREER_CAPITAL",
  angleId: "CAREER_ACCELERATION",
  editorialThesis: "Multi-Geographic Matrix Leadership & Influence",
  primaryQuestion: "How will you drive consensus across a complex matrix?",
  editorialIntent: {
    primaryMessage: "matrix_leadership",
    supportingThemes: ["cross_geo_alignment", "matrix_influence"],
    avoidThemes: ["siloed_conflicts"]
  },
  constraints: {
    requires: {
      organizationType: ["public_company", "institutional"]
    }
  },
  slots: {
    headline: (v) => `Multi-geographic matrix leadership mandate driving global consensus at ${v.company}.`,
    opening: (v) => `Global matrix ${v.role} role at ${v.company}, leading cross-functional teams spanning multiple continents and time zones.`,
    editorialBridge: (v) => `Demonstrates sophisticated matrix influence for ${v.company}, driving strategic alignment without relying on direct hierarchical authority.`,
    decisionGuidance: {
      proceedIf: (v) => `Leading complex multi-geo matrix organizations and orchestrating global stakeholder consensus at ${v.company} excite you.`,
      pauseIf: () => `Verify dual-reporting matrix accountability structures and decision escalation paths.`,
      closing: (v) => `Proceed to recruiter screening. High-leverage global matrix mandate at ${v.company}.`
    }
  }
};

// 7. Regional Hub Scale (India / APAC Execution)
export const archetypeRegionalHubPattern: EditorialPattern = {
  id: "archetype-regional-hub-3h",
  strategyId: "GROWTH_EXPANSION",
  angleId: "COMMERCIAL_OWNERSHIP",
  editorialThesis: "Regional Hub Scale & Emerging Market Leadership",
  primaryQuestion: "Why is emerging market leadership the primary career catalyst?",
  editorialIntent: {
    primaryMessage: "regional_hub_scale",
    supportingThemes: ["emerging_market_growth", "apac_leadership"],
    avoidThemes: ["domestic_saturation"]
  },
  constraints: {
    requires: {
      hasPnlOwnership: true
    }
  },
  slots: {
    headline: (v) => `Regional hub leadership mandate driving emerging market expansion at ${v.company}.`,
    opening: (v) => `Regional ${v.role} executive position at ${v.company}, leading commercial operations across high-growth APAC/India markets.`,
    editorialBridge: (v) => `Capitalizes on rapid regional market growth for ${v.company}, establishing your reputation as a premier regional P&L leader.`,
    decisionGuidance: {
      proceedIf: (v) => `Scaling regional commercial hubs and driving hyper-growth in emerging markets at ${v.company} match your ambition.`,
      pauseIf: () => `Confirm regional P&L re-investment authority and capital allocation autonomy.`,
      closing: (v) => `Invest your time here. Premier regional P&L expansion mandate at ${v.company}.`
    }
  }
};

// 8. Family Office Governance & Wealth Capital Scale
export const archetypeFamilyOfficePattern: EditorialPattern = {
  id: "archetype-family-office-3i",
  strategyId: "CAREER_CAPITAL",
  angleId: "FOUNDER_ACCESS",
  editorialThesis: "Family Office Capital & Multi-Generational Governance",
  primaryQuestion: "How will you institutionalize family-owned assets?",
  editorialIntent: {
    primaryMessage: "family_office_governance",
    supportingThemes: ["wealth_preservation", "generational_scale"],
    avoidThemes: ["family_feuds"]
  },
  constraints: {
    requires: {
      organizationType: ["founder_led", "private_equity"]
    }
  },
  slots: {
    headline: (v) => `Family office executive mandate professionalizing multi-generational assets at ${v.company}.`,
    opening: (v) => `Executive ${v.role} role at ${v.company}, representing family office ownership in scaling operating assets and governance systems.`,
    editorialBridge: (v) => `Bridges family wealth preservation goals for ${v.company} with modern institutional operating discipline.`,
    decisionGuidance: {
      proceedIf: (v) => `Managing relationships with family principals while building institutional business discipline at ${v.company} align with your profile.`,
      pauseIf: () => `Confirm family council governance charter and executive board representation.`,
      closing: (v) => `Worth exploring. Unique long-term capital stewardship mandate at ${v.company}.`
    }
  }
};
