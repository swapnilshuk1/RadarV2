import type { EditorialPattern } from "../EditorialPattern";

// 1. Commercial Ownership & P&L Scale
export const growthCommercialOwnershipPattern: EditorialPattern = {
  id: "growth-commercial-ownership-1a",
  strategyId: "GROWTH_EXPANSION",
  angleId: "COMMERCIAL_OWNERSHIP",
  editorialThesis: "Commercial Ownership Expansion",
  primaryQuestion: "Why is this role worth prioritizing right now?",
  editorialIntent: {
    primaryMessage: "commercial_scale",
    supportingThemes: ["pnl_growth", "category_ownership"],
    avoidThemes: ["turnaround", "restructuring"]
  },
  constraints: {
    requires: {
      hasPnlOwnership: true,
      minScore: 50
    }
  },
  slots: {
    headline: (v) => `A founder-facing commercial growth mandate with meaningful P&L scale at ${v.company}.`,
    opening: (v) => `Targeted executive opportunity in ${v.role} capacity at ${v.company}, aligning with your growth execution and commercial P&L precedents.`,
    editorialBridge: (v) => `The opportunity expands commercial ownership at ${v.company} without materially increasing execution risk.`,
    decisionGuidance: {
      proceedIf: (v) => `Commercial ownership and growth trajectory at ${v.company} align with your target mandate.`,
      pauseIf: () => `Confirm regional P&L boundaries and direct budget authority during initial call.`,
      closing: (v) => `Proceed this week. This opportunity meaningfully advances your commercial P&L trajectory at ${v.company} while remaining closely aligned with your operating experience.`
    }
  }
};

// 2. Category Leadership & Footprint
export const growthCategoryLeadershipPattern: EditorialPattern = {
  id: "growth-category-leadership-1b",
  strategyId: "GROWTH_EXPANSION",
  angleId: "CATEGORY_LEADERSHIP",
  editorialThesis: "Category Market Footprint Scale",
  primaryQuestion: "Why does this role match your growth playbook?",
  editorialIntent: {
    primaryMessage: "market_footprint",
    supportingThemes: ["revenue_velocity", "category_scale"],
    avoidThemes: ["bureaucracy"]
  },
  constraints: {
    requires: {
      minScore: 65
    }
  },
  slots: {
    headline: (v) => `The strongest commercial category mandate currently in your operating range at ${v.company}.`,
    opening: (v) => `High-leverage ${v.role} position at ${v.company}, focused on scaling revenue engines and expanding market footprint.`,
    editorialBridge: (v) => `A rare alignment between your growth playbook and an expanding market category at ${v.company}.`,
    decisionGuidance: {
      proceedIf: (v) => `Scaling category market share and revenue velocity at ${v.company} fits your career trajectory.`,
      pauseIf: () => `Verify exact team headcount and reporting hierarchy before committing.`,
      closing: (v) => `One to prioritize. Scope and commercial upside at ${v.company} warrant immediate advancement to recruiter screening.`
    }
  }
};

// 3. Go-to-Market Revenue Acceleration
export const growthRevenueEnginePattern: EditorialPattern = {
  id: "growth-revenue-engine-1c",
  strategyId: "GROWTH_EXPANSION",
  angleId: "COMMERCIAL_OWNERSHIP",
  editorialThesis: "GTM Revenue Engine Acceleration",
  primaryQuestion: "How fast can you scale the revenue architecture?",
  editorialIntent: {
    primaryMessage: "revenue_acceleration",
    supportingThemes: ["gtm_execution", "commercial_velocity"],
    avoidThemes: ["legacy_maintenance"]
  },
  constraints: {
    requires: {
      hasPnlOwnership: true,
      minScore: 60
    }
  },
  slots: {
    headline: (v) => `High-velocity go-to-market leadership mandate driving revenue scale at ${v.company}.`,
    opening: (v) => `Strategic ${v.role} mandate at ${v.company}, structured around accelerating customer acquisition and commercial velocity.`,
    editorialBridge: (v) => `Directly leverages your go-to-market scaling playbook to expand top-line commercial performance at ${v.company}.`,
    decisionGuidance: {
      proceedIf: (v) => `Accelerating top-line revenue velocity and scaling GTM teams at ${v.company} match your strengths.`,
      pauseIf: () => `Clarify historical conversion benchmarks and customer acquisition cost targets.`,
      closing: (v) => `Deserves immediate attention. Strong top-line upside with proven commercial playbook fit at ${v.company}.`
    }
  }
};

// 4. Performance Marketing & Acquisition CoE
export const growthPerformanceCoePattern: EditorialPattern = {
  id: "growth-performance-coe-1d",
  strategyId: "GROWTH_EXPANSION",
  angleId: "CATEGORY_LEADERSHIP",
  editorialThesis: "Performance Marketing & Paid Acquisition CoE",
  primaryQuestion: "Why is your acquisition expertise a key differentiator?",
  editorialIntent: {
    primaryMessage: "acquisition_scale",
    supportingThemes: ["performance_coe", "conversion_efficiency"],
    avoidThemes: ["brand_only"]
  },
  constraints: {
    requires: {
      minScore: 55
    }
  },
  slots: {
    headline: (v) => `Performance marketing Center of Excellence mandate scaling paid acquisition at ${v.company}.`,
    opening: (v) => `Performance-focused ${v.role} leadership role at ${v.company}, tasked with optimizing customer acquisition efficiency and media spend.`,
    editorialBridge: (v) => `Your performance marketing and digital acquisition precedents create an immediate execution moat at ${v.company}.`,
    decisionGuidance: {
      proceedIf: (v) => `Scaling paid acquisition channels and conversion CoE practices at ${v.company} align with your track record.`,
      pauseIf: () => `Confirm annual media spend allocation and attribution tech stack readiness.`,
      closing: (v) => `High-conviction opportunity. Your performance acquisition expertise delivers immediate leverage at ${v.company}.`
    }
  }
};

// 5. Multi-Channel Digital Growth Expansion
export const growthDigitalExpansionPattern: EditorialPattern = {
  id: "growth-digital-expansion-1e",
  strategyId: "GROWTH_EXPANSION",
  angleId: "COMMERCIAL_OWNERSHIP",
  editorialThesis: "Multi-Channel Digital Channel Scale",
  primaryQuestion: "How does this expand your digital channel footprint?",
  editorialIntent: {
    primaryMessage: "multi_channel_scale",
    supportingThemes: ["digital_footprint", "channel_synergy"],
    avoidThemes: ["offline_legacy"]
  },
  constraints: {
    requires: {
      minScore: 60
    }
  },
  slots: {
    headline: (v) => `Multi-channel digital growth mandate expanding online revenue footprint at ${v.company}.`,
    opening: (v) => `Digital growth ${v.role} mandate at ${v.company}, driving multi-channel commercial execution across web, app, and marketplace channels.`,
    editorialBridge: (v) => `Positions you to unify digital acquisition and retention channels into a cohesive growth engine at ${v.company}.`,
    decisionGuidance: {
      proceedIf: (v) => `Unifying digital growth channels and building multi-touch conversion engines at ${v.company} match your goals.`,
      pauseIf: () => `Validate attribution model accuracy and cross-channel margin expectations.`,
      closing: (v) => `Worth advancing. Excellent alignment for digital commercial leaders at ${v.company}.`
    }
  }
};

// 6. Global & Cross-Border Market Entry
export const growthGlobalMarketEntryPattern: EditorialPattern = {
  id: "growth-global-market-entry-1f",
  strategyId: "GROWTH_EXPANSION",
  angleId: "CATEGORY_LEADERSHIP",
  editorialThesis: "Cross-Border Market Entry & International Scale",
  primaryQuestion: "Why is international market entry a major career accelerator?",
  editorialIntent: {
    primaryMessage: "international_expansion",
    supportingThemes: ["global_footprint", "market_penetration"],
    avoidThemes: ["single_market_domestic"]
  },
  constraints: {
    requires: {
      minScore: 70
    }
  },
  slots: {
    headline: (v) => `International market entry mandate expanding global commercial footprint at ${v.company}.`,
    opening: (v) => `Cross-border ${v.role} executive position at ${v.company}, leading market penetration and regional commercial scaling.`,
    editorialBridge: (v) => `Substantially broadens your international leadership profile by establishing new growth beachheads for ${v.company}.`,
    decisionGuidance: {
      proceedIf: (v) => `Leading international expansion and launching regional commercial teams at ${v.company} excite you.`,
      pauseIf: () => `Confirm local regulatory compliance and regional operating autonomy.`,
      closing: (v) => `Highest-conviction opportunity. Unlocks international career capital and market leadership at ${v.company}.`
    }
  }
};

// 7. High-Velocity Commercial Execution
export const growthCommercialVelocityPattern: EditorialPattern = {
  id: "growth-commercial-velocity-1g",
  strategyId: "GROWTH_EXPANSION",
  angleId: "COMMERCIAL_OWNERSHIP",
  editorialThesis: "High-Velocity Commercial Execution",
  primaryQuestion: "How fast can you unlock commercial momentum?",
  editorialIntent: {
    primaryMessage: "execution_velocity",
    supportingThemes: ["agile_commercial", "rapid_scale"],
    avoidThemes: ["slow_bureaucracy"]
  },
  constraints: {
    requires: {
      hasPnlOwnership: true,
      minScore: 65
    }
  },
  slots: {
    headline: (v) => `High-velocity commercial mandate accelerating decision and revenue speed at ${v.company}.`,
    opening: (v) => `Commercial execution ${v.role} role at ${v.company}, focused on streamlining sales cycles and accelerating growth velocity.`,
    editorialBridge: (v) => `Replaces slow corporate approval cycles with rapid, data-backed commercial experimentation at ${v.company}.`,
    decisionGuidance: {
      proceedIf: (v) => `Driving rapid commercial iteration and unbureaucratic execution at ${v.company} matches your pace.`,
      pauseIf: () => `Verify executive willingness to empower decentralized commercial decisions.`,
      closing: (v) => `Strong recommendation. High-speed commercial mandate with direct P&L leverage at ${v.company}.`
    }
  }
};

// 8. Retention, CRM & Customer LTV Scale
export const growthCustomerLifetimeValuePattern: EditorialPattern = {
  id: "growth-customer-ltv-1h",
  strategyId: "GROWTH_EXPANSION",
  angleId: "COMMERCIAL_OWNERSHIP",
  editorialThesis: "Customer LTV Maximization & Retention Architecture",
  primaryQuestion: "How will you scale customer retention and lifetime value?",
  editorialIntent: {
    primaryMessage: "ltv_maximization",
    supportingThemes: ["crm_architecture", "retention_scale"],
    avoidThemes: ["one_off_acquisition"]
  },
  constraints: {
    requires: {
      minScore: 55
    }
  },
  slots: {
    headline: (v) => `Customer LTV maximization mandate scaling retention architecture at ${v.company}.`,
    opening: (v) => `Retention-led ${v.role} executive position at ${v.company}, tasked with scaling lifecycle marketing, CRM, and customer LTV.`,
    editorialBridge: (v) => `Leverages your CRM and lifecycle marketing expertise to transform one-off transactions into recurring revenue at ${v.company}.`,
    decisionGuidance: {
      proceedIf: (v) => `Scaling customer retention systems and lifetime value economics at ${v.company} align with your strengths.`,
      pauseIf: () => `Confirm CDP data integration status and customer service team alignment.`,
      closing: (v) => `Invest your time here. Essential LTV expansion mandate with clear economic leverage at ${v.company}.`
    }
  }
};

// 9. Scalable Unit Economics & CAC Efficiency
export const growthScalableUnitEconomicsPattern: EditorialPattern = {
  id: "growth-unit-economics-1i",
  strategyId: "GROWTH_EXPANSION",
  angleId: "COMMERCIAL_OWNERSHIP",
  editorialThesis: "Profitable Growth & Scalable Unit Economics",
  primaryQuestion: "Why is sustainable unit economics the core mandate?",
  editorialIntent: {
    primaryMessage: "profitable_growth",
    supportingThemes: ["unit_economics", "cac_efficiency"],
    avoidThemes: ["unprofitable_burn"]
  },
  constraints: {
    requires: {
      hasPnlOwnership: true,
      minScore: 60
    }
  },
  slots: {
    headline: (v) => `Profitable growth mandate optimizing CAC-to-LTV unit economics at ${v.company}.`,
    opening: (v) => `Unit economics-focused ${v.role} mandate at ${v.company}, driving profitable scale and commercial discipline.`,
    editorialBridge: (v) => `Shifts commercial strategy at ${v.company} from unconstrained burn to disciplined, compounding P&L growth.`,
    decisionGuidance: {
      proceedIf: (v) => `Building disciplined, high-margin commercial growth engines at ${v.company} aligns with your operating philosophy.`,
      pauseIf: () => `Verify contribution margin targets and current CAC payback periods.`,
      closing: (v) => `Proceed to recruiter screening. High-quality commercial mandate with sustainable P&L discipline at ${v.company}.`
    }
  }
};

// 10. B2B / Enterprise Commercial Expansion
export const growthEnterpriseGtmPattern: EditorialPattern = {
  id: "growth-enterprise-gtm-1j",
  strategyId: "GROWTH_EXPANSION",
  angleId: "COMMERCIAL_OWNERSHIP",
  editorialThesis: "Enterprise B2B Commercial Expansion",
  primaryQuestion: "How will you scale enterprise account acquisition?",
  editorialIntent: {
    primaryMessage: "enterprise_b2b_scale",
    supportingThemes: ["account_based_growth", "high_ticket_sales"],
    avoidThemes: ["low_ticket_b2c"]
  },
  constraints: {
    requires: {
      hasPnlOwnership: true,
      minScore: 65
    }
  },
  slots: {
    headline: (v) => `Enterprise B2B commercial mandate scaling strategic account revenue at ${v.company}.`,
    opening: (v) => `Enterprise GTM ${v.role} position at ${v.company}, leading high-ticket B2B account acquisition and pipeline expansion.`,
    editorialBridge: (v) => `Directly applies your enterprise B2B sales and marketing playbook to secure tier-1 commercial accounts for ${v.company}.`,
    decisionGuidance: {
      proceedIf: (v) => `Scaling enterprise sales pipelines and account-based commercial strategies at ${v.company} match your goals.`,
      pauseIf: () => `Confirm average deal cycle length and sales-marketing alignment.`,
      closing: (v) => `Worth prioritizing. Strong enterprise commercial opportunity with high average deal value at ${v.company}.`
    }
  }
};

// 11. D2C & Omnichannel Retail Convergence
export const growthOmnichannelRetailPattern: EditorialPattern = {
  id: "growth-omnichannel-retail-1k",
  strategyId: "GROWTH_EXPANSION",
  angleId: "CATEGORY_LEADERSHIP",
  editorialThesis: "D2C & Omnichannel Retail Channel Convergence",
  primaryQuestion: "How will you bridge digital D2C and physical retail?",
  editorialIntent: {
    primaryMessage: "omnichannel_convergence",
    supportingThemes: ["d2c_scale", "retail_footprint"],
    avoidThemes: ["pure_play_single_channel"]
  },
  constraints: {
    requires: {
      minScore: 60
    }
  },
  slots: {
    headline: (v) => `Omnichannel retail mandate bridging digital D2C and physical store growth at ${v.company}.`,
    opening: (v) => `Omnichannel ${v.role} executive role at ${v.company}, unifying online commerce and retail partner expansion.`,
    editorialBridge: (v) => `Unlocks powerful cross-channel synergies between digital acquisition and physical retail presence for ${v.company}.`,
    decisionGuidance: {
      proceedIf: (v) => `Integrating D2C digital channels with retail footprint growth at ${v.company} matches your experience.`,
      pauseIf: () => `Validate trade margin structures across retail distribution partners.`,
      closing: (v) => `Conditional recommendation. Promising omnichannel growth upside with strategic channel leverage at ${v.company}.`
    }
  }
};

// 12. Full-Funnel Brand & Performance Synergy
export const growthBrandEquityScalePattern: EditorialPattern = {
  id: "growth-brand-equity-1l",
  strategyId: "GROWTH_EXPANSION",
  angleId: "CATEGORY_LEADERSHIP",
  editorialThesis: "Full-Funnel Brand Equity & Performance Synergy",
  primaryQuestion: "How will you balance brand equity building with short-term conversion?",
  editorialIntent: {
    primaryMessage: "full_funnel_synergy",
    supportingThemes: ["brand_equity", "performance_synergy"],
    avoidThemes: ["pure_discounting"]
  },
  constraints: {
    requires: {
      minScore: 60
    }
  },
  slots: {
    headline: (v) => `Full-funnel commercial mandate combining brand equity and performance growth at ${v.company}.`,
    opening: (v) => `Full-funnel ${v.role} executive role at ${v.company}, aligning brand positioning with aggressive performance conversion.`,
    editorialBridge: (v) => `Protects brand margin pricing power at ${v.company} while maintaining rigorous performance marketing efficiency.`,
    decisionGuidance: {
      proceedIf: (v) => `Balancing long-term brand equity creation with measurable quarterly conversion at ${v.company} fits your philosophy.`,
      pauseIf: () => `Confirm executive alignment on brand building budget allocation.`,
      closing: (v) => `Worth exploring. Excellent full-funnel leadership mandate with long-term category upside at ${v.company}.`
    }
  }
};

// 13. Strategic Alliances & Ecosystem Growth
export const growthStrategicPartnershipsPattern: EditorialPattern = {
  id: "growth-strategic-partnerships-1m",
  strategyId: "GROWTH_EXPANSION",
  angleId: "CATEGORY_LEADERSHIP",
  editorialThesis: "Ecosystem Growth & Strategic Alliance Scaling",
  primaryQuestion: "How will ecosystem partnerships accelerate customer reach?",
  editorialIntent: {
    primaryMessage: "ecosystem_leverage",
    supportingThemes: ["strategic_alliances", "co_marketing"],
    avoidThemes: ["isolated_growth"]
  },
  constraints: {
    requires: {
      minScore: 65
    }
  },
  slots: {
    headline: (v) => `Ecosystem partnership mandate unlocking strategic co-growth channels at ${v.company}.`,
    opening: (v) => `Partnership-led ${v.role} role at ${v.company}, accelerating user growth through enterprise alliances and distribution deals.`,
    editorialBridge: (v) => `Unlocks non-linear customer reach for ${v.company} by embedding commercial offerings into strategic partner ecosystems.`,
    decisionGuidance: {
      proceedIf: (v) => `Structuring strategic commercial alliances and co-marketing distribution models at ${v.company} matches your strengths.`,
      pauseIf: () => `Verify partner integration readiness and revenue share terms.`,
      closing: (v) => `Strong recommendation. Strategic ecosystem growth mandate with high leverage at ${v.company}.`
    }
  }
};

// 14. Product-Led Growth (PLG) & Conversion Loops
export const growthProductLedExpansionPattern: EditorialPattern = {
  id: "growth-product-led-1n",
  strategyId: "GROWTH_EXPANSION",
  angleId: "CATEGORY_LEADERSHIP",
  editorialThesis: "Product-Led Growth & Virality Loop Scaling",
  primaryQuestion: "How will product experience drive organic commercial conversion?",
  editorialIntent: {
    primaryMessage: "plg_conversion_loops",
    supportingThemes: ["product_virality", "freemium_monetization"],
    avoidThemes: ["pure_outbound"]
  },
  constraints: {
    requires: {
      minScore: 65
    }
  },
  slots: {
    headline: (v) => `Product-led growth mandate optimizing self-serve conversion loops at ${v.company}.`,
    opening: (v) => `PLG-focused ${v.role} leadership role at ${v.company}, aligning product experience with commercial conversion and expansion.`,
    editorialBridge: (v) => `Connects product usage analytics directly with commercial monetization strategies at ${v.company}.`,
    decisionGuidance: {
      proceedIf: (v) => `Scaling product-led growth loops and self-serve monetization at ${v.company} aligns with your expertise.`,
      pauseIf: () => `Clarify product engineering squad allocation for growth experiments.`,
      closing: (v) => `Deserves immediate attention. High-margin product-led growth mandate at ${v.company}.`
    }
  }
};

// 15. Regional P&L Expansion (India / APAC Scale)
export const growthRegionalPnlOwnershipPattern: EditorialPattern = {
  id: "growth-regional-pnl-1o",
  strategyId: "GROWTH_EXPANSION",
  angleId: "COMMERCIAL_OWNERSHIP",
  editorialThesis: "Regional P&L Scale & Market Leadership",
  primaryQuestion: "Why is regional P&L ownership the central career lever?",
  editorialIntent: {
    primaryMessage: "regional_pnl_scale",
    supportingThemes: ["regional_autonomy", "market_share"],
    avoidThemes: ["hq_subordinate"]
  },
  constraints: {
    requires: {
      hasPnlOwnership: true,
      minScore: 60
    }
  },
  slots: {
    headline: (v) => `Regional P&L ownership mandate driving market leadership at ${v.company}.`,
    opening: (v) => `Regional ${v.role} executive position at ${v.company}, owning full regional P&L execution and commercial growth targets.`,
    editorialBridge: (v) => `Solidifies your regional executive reputation by delivering top-line growth across target markets for ${v.company}.`,
    decisionGuidance: {
      proceedIf: (v) => `Owning full regional P&L execution and driving market expansion at ${v.company} fit your trajectory.`,
      pauseIf: () => `Verify regional P&L boundaries relative to global HQ directives.`,
      closing: (v) => `Proceed to recruiter screening. Direct regional P&L ownership mandate at ${v.company}.`
    }
  }
};

// 16. Rapid Commercial Pivot & Market Acceleration
export const growthAgileCommercialTurnaroundPattern: EditorialPattern = {
  id: "growth-agile-turnaround-1p",
  strategyId: "GROWTH_EXPANSION",
  angleId: "COMMERCIAL_OWNERSHIP",
  editorialThesis: "Agile Commercial Pivot & Revenue Acceleration",
  primaryQuestion: "How will you execute a commercial pivot to reignite revenue?",
  editorialIntent: {
    primaryMessage: "commercial_pivot",
    supportingThemes: ["revenue_reignition", "agile_repositioning"],
    avoidThemes: ["status_quo"]
  },
  constraints: {
    requires: {
      hasPnlOwnership: true,
      minScore: 55
    }
  },
  slots: {
    headline: (v) => `Agile commercial pivot mandate reigniting top-line revenue momentum at ${v.company}.`,
    opening: (v) => `Commercial pivot ${v.role} role at ${v.company}, tasked with repositioning product offerings and reigniting growth velocity.`,
    editorialBridge: (v) => `Applies decisive commercial leadership to realign sales and marketing strategies with changing market demand at ${v.company}.`,
    decisionGuidance: {
      proceedIf: (v) => `Repositioning commercial offerings and reigniting growth velocity at ${v.company} match your execution style.`,
      pauseIf: () => `Confirm executive alignment on strategic repositioning latitude.`,
      closing: (v) => `Promising opportunity. High-impact commercial pivot mandate with strategic upside at ${v.company}.`
    }
  }
};

// 17. Sustainable Growth Moat & Competitive Defense
export const growthCommercialCapabilityMoatPattern: EditorialPattern = {
  id: "growth-capability-moat-1q",
  strategyId: "GROWTH_EXPANSION",
  angleId: "CATEGORY_LEADERSHIP",
  editorialThesis: "Sustainable Growth Moat & Competitive Defense",
  primaryQuestion: "How will you build an unassailable commercial moat?",
  editorialIntent: {
    primaryMessage: "competitive_moat",
    supportingThemes: ["defensible_growth", "customer_lock_in"],
    avoidThemes: ["commodity_competition"]
  },
  constraints: {
    requires: {
      minScore: 65
    }
  },
  slots: {
    headline: (v) => `Commercial capability mandate building defensible growth moats at ${v.company}.`,
    opening: (v) => `Strategic growth ${v.role} role at ${v.company}, focused on building competitive acquisition and retention advantages.`,
    editorialBridge: (v) => `Establishes systemic commercial advantages for ${v.company} that competing market entrants will struggle to replicate.`,
    decisionGuidance: {
      proceedIf: (v) => `Building defensible commercial capability moats and customer lock-in at ${v.company} align with your philosophy.`,
      pauseIf: () => `Assess competitor counter-strategies and market barrier entry costs.`,
      closing: (v) => `Strong recommendation. High-leverage strategic growth mandate at ${v.company}.`
    }
  }
};

// 18. Advanced Analytics & CDP-Driven Conversion Scale
export const growthDataDrivenFunnelPattern: EditorialPattern = {
  id: "growth-data-funnel-1r",
  strategyId: "GROWTH_EXPANSION",
  angleId: "CATEGORY_LEADERSHIP",
  editorialThesis: "CDP Analytics & Data-Driven Funnel Optimization",
  primaryQuestion: "How will customer data architecture drive conversion uplift?",
  editorialIntent: {
    primaryMessage: "data_driven_conversion",
    supportingThemes: ["cdp_architecture", "funnel_optimization"],
    avoidThemes: ["gut_based_decisions"]
  },
  constraints: {
    requires: {
      minScore: 60
    }
  },
  slots: {
    headline: (v) => `Data-driven growth mandate optimizing conversion funnels via CDP analytics at ${v.company}.`,
    opening: (v) => `Analytics-led ${v.role} executive position at ${v.company}, leveraging customer data platforms to maximize conversion efficiency.`,
    editorialBridge: (v) => `Transforms disparate customer touchpoints into a unified, high-converting data architecture for ${v.company}.`,
    decisionGuidance: {
      proceedIf: (v) => `Leveraging advanced customer analytics and CDP platforms at ${v.company} to drive growth fits your background.`,
      pauseIf: () => `Verify data engineering resource commitments and CDP vendor integration status.`,
      closing: (v) => `Worth prioritizing. High-precision data-driven growth mandate at ${v.company}.`
    }
  }
};

// 19. High-Margin Product Mix & Portfolio Expansion
export const growthHighMarginProductMixPattern: EditorialPattern = {
  id: "growth-high-margin-1s",
  strategyId: "GROWTH_EXPANSION",
  angleId: "COMMERCIAL_OWNERSHIP",
  editorialThesis: "High-Margin Portfolio & Mix Expansion",
  primaryQuestion: "How will you optimize product mix to expand gross margins?",
  editorialIntent: {
    primaryMessage: "high_margin_mix",
    supportingThemes: ["portfolio_expansion", "gross_margin_scale"],
    avoidThemes: ["low_margin_volume"]
  },
  constraints: {
    requires: {
      hasPnlOwnership: true,
      minScore: 60
    }
  },
  slots: {
    headline: (v) => `High-margin commercial mandate expanding premium portfolio mix at ${v.company}.`,
    opening: (v) => `Portfolio growth ${v.role} mandate at ${v.company}, driving commercial focus toward high-margin product offerings.`,
    editorialBridge: (v) => `Drives gross margin expansion at ${v.company} by shifting sales and marketing focus toward premium, recurring product tiers.`,
    decisionGuidance: {
      proceedIf: (v) => `Optimizing commercial product mix to expand gross margin profiles at ${v.company} matches your P&L strengths.`,
      pauseIf: () => `Validate customer price sensitivity and premium product R&D roadmap.`,
      closing: (v) => `Proceed to recruiter screening. Quality margin expansion mandate at ${v.company}.`
    }
  }
};

// 20. Commercial Leadership Altitude Elevation (CGO/CMO)
export const growthCommercialLeadershipAltitudePattern: EditorialPattern = {
  id: "growth-leadership-altitude-1t",
  strategyId: "GROWTH_EXPANSION",
  angleId: "CAREER_ACCELERATION",
  editorialThesis: "Executive Altitude Elevation & C-Suite Mandate",
  primaryQuestion: "Why does this role mark a major executive level ascension?",
  editorialIntent: {
    primaryMessage: "executive_elevation",
    supportingThemes: ["c_suite_footprint", "board_reporting"],
    avoidThemes: ["middle_management"]
  },
  constraints: {
    requires: {
      hasPnlOwnership: true,
      minScore: 75
    }
  },
  slots: {
    headline: (v) => `A landmark C-suite commercial leadership mandate elevating your executive footprint at ${v.company}.`,
    opening: (v) => `C-suite level ${v.role} position at ${v.company}, providing ultimate commercial authority and direct board reporting.`,
    editorialBridge: (v) => `Represents a definitive executive altitude ascension, positioning you as the primary commercial authority for ${v.company}.`,
    decisionGuidance: {
      proceedIf: (v) => `Stepping into full C-suite commercial ownership with direct board exposure at ${v.company} aligns with your career ambition.`,
      pauseIf: () => `Confirm governance structure and executive committee voting rights.`,
      closing: (v) => `Highest-conviction opportunity. Landmark executive ascension mandate with immediate board capital at ${v.company}.`
    }
  }
};
