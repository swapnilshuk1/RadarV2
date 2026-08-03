import type { EditorialPattern } from "../EditorialPattern";

// 1. Enterprise Turnaround & Reset
export const transformationTurnaroundPattern: EditorialPattern = {
  id: "transformation-turnaround-2a",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  editorialThesis: "Enterprise Modernization & Operational Reset",
  primaryQuestion: "Why are you uniquely qualified for this reset?",
  editorialIntent: {
    primaryMessage: "operational_reset",
    supportingThemes: ["board_sponsorship", "change_leadership"],
    avoidThemes: ["maintenance"]
  },
  constraints: {
    requires: {
      transformationStage: ["modernization", "turnaround"],
      minScore: 50
    }
  },
  slots: {
    headline: (v) => `A pivotal operational reset mandate driving digital and P&L scale at ${v.company}.`,
    opening: (v) => `Strategic ${v.role} mandate at ${v.company}, structured around executing an enterprise transformation roadmap.`,
    editorialBridge: (v) => `Replaces incremental management at ${v.company} with full mandate authority to execute a system reset.`,
    decisionGuidance: {
      proceedIf: (v) => `Leading complex organizational transformations at ${v.company} aligns with your execution strengths.`,
      pauseIf: () => `Ensure board-level sponsorship for transformation budget before proceeding.`,
      closing: (v) => `Recommended first. High-altitude execution role at ${v.company} with direct board visibility.`
    }
  }
};

// 2. Legacy Tech Decoupling & Cloud Migration
export const transformationLegacyDecouplingPattern: EditorialPattern = {
  id: "transformation-legacy-decoupling-2b",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  editorialThesis: "Legacy Architecture Decoupling & Cloud Modernization",
  primaryQuestion: "How will you break technical debt and modernize systems?",
  editorialIntent: {
    primaryMessage: "legacy_decoupling",
    supportingThemes: ["cloud_migration", "technical_debt_reduction"],
    avoidThemes: ["patchwork_fixes"]
  },
  constraints: {
    requires: {
      transformationStage: ["modernization", "turnaround"]
    }
  },
  slots: {
    headline: (v) => `Legacy architecture decoupling mandate modernizing core tech infrastructure at ${v.company}.`,
    opening: (v) => `Technology transformation ${v.role} position at ${v.company}, tasked with decoupling legacy monolithic debt and migrating to cloud infrastructure.`,
    editorialBridge: (v) => `Drives foundational tech stack modernization at ${v.company}, unlocking organizational agility and developer velocity.`,
    decisionGuidance: {
      proceedIf: (v) => `Decoupling legacy technical debt and leading enterprise cloud migrations at ${v.company} match your background.`,
      pauseIf: () => `Confirm executive commitment to technical debt reduction timeline versus feature backlog demands.`,
      closing: (v) => `High-conviction opportunity. Essential infrastructure modernization mandate at ${v.company}.`
    }
  }
};

// 3. Enterprise Digital Ecosystem Unification
export const transformationDigitalEcosystemPattern: EditorialPattern = {
  id: "transformation-digital-ecosystem-2c",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  editorialThesis: "Enterprise Digital System & Channel Unification",
  primaryQuestion: "How will you unify fragmented digital channels?",
  editorialIntent: {
    primaryMessage: "ecosystem_unification",
    supportingThemes: ["single_source_truth", "channel_integration"],
    avoidThemes: ["fragmented_silos"]
  },
  constraints: {
    requires: {
      transformationStage: ["modernization"]
    }
  },
  slots: {
    headline: (v) => `Digital ecosystem mandate unifying fragmented enterprise channels at ${v.company}.`,
    opening: (v) => `Digital integration ${v.role} role at ${v.company}, focused on consolidating isolated business unit systems into a unified platform.`,
    editorialBridge: (v) => `Establishes a single, seamless digital ecosystem for ${v.company} across sales, marketing, and operations.`,
    decisionGuidance: {
      proceedIf: (v) => `Consolidating enterprise digital platforms and creating single customer views at ${v.company} match your strengths.`,
      pauseIf: () => `Verify cross-departmental alignment on platform governance and data ownership.`,
      closing: (v) => `Invest your time here. High-impact enterprise platform consolidation mandate at ${v.company}.`
    }
  }
};

// 4. Operating Model & Org Restructuring
export const transformationOperatingModelPattern: EditorialPattern = {
  id: "transformation-operating-model-2d",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  editorialThesis: "Target Operating Model & Org Structure Alignment",
  primaryQuestion: "How will you realign org structure with business strategy?",
  editorialIntent: {
    primaryMessage: "operating_model_reset",
    supportingThemes: ["org_design", "efficiency_scale"],
    avoidThemes: ["superficial_reorg"]
  },
  constraints: {
    requires: {
      transformationStage: ["turnaround", "modernization"]
    }
  },
  slots: {
    headline: (v) => `Operating model redesign mandate realigning organizational execution at ${v.company}.`,
    opening: (v) => `Organizational transformation ${v.role} position at ${v.company}, redesigning teams and workflows to accelerate strategic velocity.`,
    editorialBridge: (v) => `Re-architects organizational boundaries at ${v.company} to eliminate operational friction and clarify accountabilities.`,
    decisionGuidance: {
      proceedIf: (v) => `Redesigning executive team structures and aligning operating models at ${v.company} match your experience.`,
      pauseIf: () => `Ensure CEO authority to restructure reporting lines across business units.`,
      closing: (v) => `Proceed to recruiter screening. Strategic operating model mandate with high operational impact at ${v.company}.`
    }
  }
};

// 5. High-Performance Execution Culture Shift
export const transformationCulturalChangePattern: EditorialPattern = {
  id: "transformation-cultural-change-2e",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  editorialThesis: "Cultural Transformation & High-Performance Execution",
  primaryQuestion: "How will you instill an accountability-first mindset?",
  editorialIntent: {
    primaryMessage: "cultural_shift",
    supportingThemes: ["accountability_first", "velocity_mindset"],
    avoidThemes: ["complacency"]
  },
  constraints: {
    requires: {
      transformationStage: ["turnaround", "modernization"]
    }
  },
  slots: {
    headline: (v) => `Cultural transformation mandate driving high-performance execution at ${v.company}.`,
    opening: (v) => `Execution-focused ${v.role} role at ${v.company}, tasked with instilling an accountability-driven, high-velocity leadership culture.`,
    editorialBridge: (v) => `Transforms organizational culture at ${v.company} from passive compliance to proactive, outcome-based leadership.`,
    decisionGuidance: {
      proceedIf: (v) => `Driving cultural change and instilling metrics-driven performance at ${v.company} fit your leadership style.`,
      pauseIf: () => `Validate executive team willingness to address legacy underperformance.`,
      closing: (v) => `Deserves immediate attention. Foundational leadership culture mandate at ${v.company}.`
    }
  }
};

// 6. Margin Expansion & Cost Optimization
export const transformationCostOptimizationPattern: EditorialPattern = {
  id: "transformation-cost-optimization-2f",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  editorialThesis: "Margin Expansion & Cost Structure Optimization",
  primaryQuestion: "How will you optimize operating margin and eliminate waste?",
  editorialIntent: {
    primaryMessage: "margin_expansion",
    supportingThemes: ["cost_optimization", "ebitda_growth"],
    avoidThemes: ["growth_strangulation"]
  },
  constraints: {
    requires: {
      hasPnlOwnership: true,
      transformationStage: ["turnaround"]
    }
  },
  slots: {
    headline: (v) => `Margin expansion mandate optimizing cost structure and operating efficiency at ${v.company}.`,
    opening: (v) => `Cost optimization ${v.role} executive position at ${v.company}, tasked with improving EBITDA margins and operational efficiency.`,
    editorialBridge: (v) => `Unlocks margin expansion for ${v.company} by eliminating operational redundancy without sacrificing strategic growth capabilities.`,
    decisionGuidance: {
      proceedIf: (v) => `Driving operational efficiency and EBITDA margin expansion at ${v.company} match your financial discipline.`,
      pauseIf: () => `Confirm target cost reduction milestones and restructuring budget.`,
      closing: (v) => `One to prioritize. Clear margin and EBITDA expansion mandate at ${v.company}.`
    }
  }
};

// 7. M&A Integration & Portfolio Synergy Execution
export const transformationMandAIntegrationPattern: EditorialPattern = {
  id: "transformation-m-and-a-integration-2g",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  editorialThesis: "Post-Acquisition Integration & Synergies",
  primaryQuestion: "How will you capture deal synergies across merged assets?",
  editorialIntent: {
    primaryMessage: "ma_integration",
    supportingThemes: ["synergy_capture", "asset_consolidation"],
    avoidThemes: ["unintegrated_acquisitions"]
  },
  constraints: {
    requires: {
      transformationStage: ["modernization", "turnaround"]
    }
  },
  slots: {
    headline: (v) => `M&A integration mandate capturing operational synergies at ${v.company}.`,
    opening: (v) => `Integration ${v.role} executive role at ${v.company}, leading post-merger consolidation and synergy realization across operating units.`,
    editorialBridge: (v) => `Accelerates deal thesis value capture for ${v.company} by seamlessly integrating acquired platforms and leadership teams.`,
    decisionGuidance: {
      proceedIf: (v) => `Leading complex post-merger integrations and capturing deal synergies at ${v.company} align with your background.`,
      pauseIf: () => `Clarify acquired entity retention plans and cultural integration risks.`,
      closing: (v) => `High-conviction opportunity. Essential M&A value creation mandate at ${v.company}.`
    }
  }
};

// 8. Agile Engineering & Product Governance Scale
export const transformationAgileScalingPattern: EditorialPattern = {
  id: "transformation-agile-scaling-2h",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  editorialThesis: "Agile Scaling & Delivery Governance",
  primaryQuestion: "How will you scale delivery velocity across squads?",
  editorialIntent: {
    primaryMessage: "agile_governance",
    supportingThemes: ["delivery_velocity", "product_squads"],
    avoidThemes: ["waterfall_bureaucracy"]
  },
  constraints: {
    requires: {
      transformationStage: ["modernization"]
    }
  },
  slots: {
    headline: (v) => `Agile transformation mandate scaling product engineering velocity at ${v.company}.`,
    opening: (v) => `Engineering transformation ${v.role} role at ${v.company}, restructuring delivery teams into high-velocity agile squads.`,
    editorialBridge: (v) => `Re-engineers product delivery cycles at ${v.company}, shifting from rigid waterfall roadmaps to continuous deployment loops.`,
    decisionGuidance: {
      proceedIf: (v) => `Scaling agile product governance and accelerating sprint velocity at ${v.company} match your experience.`,
      pauseIf: () => `Verify engineering squad autonomy and tooling modernization investment.`,
      closing: (v) => `Worth exploring. High-impact engineering delivery transformation mandate at ${v.company}.`
    }
  }
};

// 9. Enterprise Data Mesh & AI Infrastructure Reset
export const transformationDataArchitecturePattern: EditorialPattern = {
  id: "transformation-data-architecture-2i",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  editorialThesis: "Enterprise Data Mesh & AI Platform Modernization",
  primaryQuestion: "How will you modernize data infrastructure for AI readiness?",
  editorialIntent: {
    primaryMessage: "ai_data_infrastructure",
    supportingThemes: ["data_mesh", "ai_readiness"],
    avoidThemes: ["siloed_spreadsheets"]
  },
  constraints: {
    requires: {
      transformationStage: ["modernization"]
    }
  },
  slots: {
    headline: (v) => `Enterprise data architecture mandate preparing systems for AI scale at ${v.company}.`,
    opening: (v) => `Data transformation ${v.role} position at ${v.company}, building a centralized data mesh to power enterprise AI models.`,
    editorialBridge: (v) => `Lays the foundational data infrastructure for ${v.company}, unlocking automated decision intelligence across operational workflows.`,
    decisionGuidance: {
      proceedIf: (v) => `Building enterprise data pipelines and preparing legacy systems for AI implementation at ${v.company} fit your expertise.`,
      pauseIf: () => `Confirm data governance compliance and cloud warehouse budget commitments.`,
      closing: (v) => `Recommended first. Future-proof data architecture mandate at ${v.company}.`
    }
  }
};

// 10. Supply Chain & Operations Resilience
export const transformationSupplyChainPattern: EditorialPattern = {
  id: "transformation-supply-chain-2j",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  editorialThesis: "Supply Chain Digitization & Operational Resilience",
  primaryQuestion: "How will you build supply chain visibility and resilience?",
  editorialIntent: {
    primaryMessage: "supply_chain_resilience",
    supportingThemes: ["operations_digitization", "risk_mitigation"],
    avoidThemes: ["untracked_logistics"]
  },
  constraints: {
    requires: {
      transformationStage: ["turnaround", "modernization"]
    }
  },
  slots: {
    headline: (v) => `Supply chain transformation mandate building operational resilience at ${v.company}.`,
    opening: (v) => `Operations transformation ${v.role} role at ${v.company}, digitizing supply chain logistics and inventory optimization.`,
    editorialBridge: (v) => `Mitigates operational vulnerability at ${v.company} by building real-time supply chain visibility and vendor redundancy.`,
    decisionGuidance: {
      proceedIf: (v) => `Digitizing supply chain operations and optimizing logistics networks at ${v.company} match your background.`,
      pauseIf: () => `Validate vendor contract flexibility and ERP integration timelines.`,
      closing: (v) => `Worth prioritizing. High-leverage operational resilience mandate at ${v.company}.`
    }
  }
};

// 11. Legacy Retail to Digital Channel Shift
export const transformationOmnichannelResetPattern: EditorialPattern = {
  id: "transformation-omnichannel-reset-2k",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  editorialThesis: "Legacy Retail to Digital Channel Shift",
  primaryQuestion: "How will you shift revenue from store footprints to digital?",
  editorialIntent: {
    primaryMessage: "retail_to_digital_shift",
    supportingThemes: ["e_commerce_acceleration", "store_modernization"],
    avoidThemes: ["declining_retail_only"]
  },
  constraints: {
    requires: {
      transformationStage: ["turnaround", "modernization"]
    }
  },
  slots: {
    headline: (v) => `Commercial transformation mandate shifting legacy retail footprint to digital at ${v.company}.`,
    opening: (v) => `Omnichannel shift ${v.role} position at ${v.company}, accelerating e-commerce channel share while modernizing physical store experiences.`,
    editorialBridge: (v) => `Re-balances revenue channels at ${v.company}, converting foot-traffic dependency into scalable digital sales.`,
    decisionGuidance: {
      proceedIf: (v) => `Shifting legacy retail models to high-margin e-commerce channels at ${v.company} matches your commercial history.`,
      pauseIf: () => `Confirm store manager buy-in for digital fulfillment models.`,
      closing: (v) => `Proceed to recruiter screening. High-impact commercial shift mandate at ${v.company}.`
    }
  }
};

// 12. Post-Merger P&L Realignment
export const transformationPostMergerPnlPattern: EditorialPattern = {
  id: "transformation-post-merger-pnl-2l",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  editorialThesis: "Post-Merger P&L Realignment & Profitability",
  primaryQuestion: "How will you harmonize disparate P&L structures?",
  editorialIntent: {
    primaryMessage: "pnl_realignment",
    supportingThemes: ["financial_harmonization", "margin_recovery"],
    avoidThemes: ["unconsolidated_financials"]
  },
  constraints: {
    requires: {
      hasPnlOwnership: true,
      transformationStage: ["turnaround"]
    }
  },
  slots: {
    headline: (v) => `Post-merger P&L realignment mandate accelerating profitability at ${v.company}.`,
    opening: (v) => `Financial transformation ${v.role} role at ${v.company}, unifying disparate business unit P&Ls into a cohesive margin structure.`,
    editorialBridge: (v) => `Harmonizes pricing and cost allocation frameworks for ${v.company}, restoring gross margin health post-merger.`,
    decisionGuidance: {
      proceedIf: (v) => `Harmonizing complex P&L structures and recovering operating margins at ${v.company} match your financial expertise.`,
      pauseIf: () => `Verify legacy accounting system reconciliation status.`,
      closing: (v) => `Strong recommendation. Essential P&L stabilization mandate at ${v.company}.`
    }
  }
};

// 13. Risk, Compliance & Governance Reset
export const transformationGovernanceResetPattern: EditorialPattern = {
  id: "transformation-governance-reset-2m",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  editorialThesis: "Risk, Governance & Regulatory Reset",
  primaryQuestion: "How will you build regulatory trust and governance standards?",
  editorialIntent: {
    primaryMessage: "governance_reset",
    supportingThemes: ["compliance_framework", "risk_mitigation"],
    avoidThemes: ["regulatory_exposure"]
  },
  constraints: {
    requires: {
      transformationStage: ["turnaround"]
    }
  },
  slots: {
    headline: (v) => `Governance reset mandate establishing regulatory compliance standards at ${v.company}.`,
    opening: (v) => `Governance transformation ${v.role} role at ${v.company}, implementing enterprise risk management and audit frameworks.`,
    editorialBridge: (v) => `Protects institutional reputation for ${v.company} by building audit-ready compliance and risk mitigation controls.`,
    decisionGuidance: {
      proceedIf: (v) => `Building enterprise risk frameworks and satisfying regulatory standards at ${v.company} match your background.`,
      pauseIf: () => `Confirm regulatory audit deadlines and legal counsel support.`,
      closing: (v) => `Conditional recommendation. Foundational governance reset mandate at ${v.company}.`
    }
  }
};

// 14. Customer Experience (CX) & Service Delivery Reset
export const transformationCustomerExpPattern: EditorialPattern = {
  id: "transformation-customer-exp-2n",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  editorialThesis: "Customer Experience (CX) & Service Quality Overhaul",
  primaryQuestion: "How will you reverse customer churn and elevate CX?",
  editorialIntent: {
    primaryMessage: "cx_service_reset",
    supportingThemes: ["nps_recovery", "service_quality"],
    avoidThemes: ["high_churn"]
  },
  constraints: {
    requires: {
      transformationStage: ["modernization", "turnaround"]
    }
  },
  slots: {
    headline: (v) => `Customer experience overhaul mandate reversing churn at ${v.company}.`,
    opening: (v) => `CX transformation ${v.role} position at ${v.company}, modernizing service delivery touchpoints and elevating customer NPS.`,
    editorialBridge: (v) => `Re-engineers customer journey workflows at ${v.company} to eliminate service friction and restore brand trust.`,
    decisionGuidance: {
      proceedIf: (v) => `Overhauling customer service operations and driving NPS recovery at ${v.company} align with your experience.`,
      pauseIf: () => `Validate customer support tooling investment and front-line training budgets.`,
      closing: (v) => `Invest your time here. High-leverage customer trust recovery mandate at ${v.company}.`
    }
  }
};

// 15. Commercial Force Retooling & Sales Reset
export const transformationCommercialRetoolingPattern: EditorialPattern = {
  id: "transformation-commercial-retooling-2o",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  editorialThesis: "Commercial Sales Force Retooling & Enablement",
  primaryQuestion: "How will you retool sales rep productivity?",
  editorialIntent: {
    primaryMessage: "sales_force_retooling",
    supportingThemes: ["sales_enablement", "quota_attainment"],
    avoidThemes: ["unproductive_salesforce"]
  },
  constraints: {
    requires: {
      hasPnlOwnership: true,
      transformationStage: ["turnaround"]
    }
  },
  slots: {
    headline: (v) => `Commercial sales force retooling mandate accelerating rep quota attainment at ${v.company}.`,
    opening: (v) => `Sales transformation ${v.role} executive position at ${v.company}, modernizing sales enablement and pipeline management.`,
    editorialBridge: (v) => `Lifts commercial sales productivity for ${v.company} by introducing structured enablement, playbooks, and CRM discipline.`,
    decisionGuidance: {
      proceedIf: (v) => `Retooling sales forces and establishing pipeline rigor at ${v.company} align with your commercial background.`,
      pauseIf: () => `Confirm sales compensation plan flexibility and rep turnover rates.`,
      closing: (v) => `Deserves immediate attention. High-leverage sales productivity transformation at ${v.company}.`
    }
  }
};

// 16. Cloud-Native Microservices Migration
export const transformationCloudNativePattern: EditorialPattern = {
  id: "transformation-cloud-native-2p",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  editorialThesis: "Cloud-Native Architecture Migration & DevOps Reset",
  primaryQuestion: "How will you transition architecture to cloud-native microservices?",
  editorialIntent: {
    primaryMessage: "cloud_native_shift",
    supportingThemes: ["microservices", "devops_velocity"],
    avoidThemes: ["on_premise_dependency"]
  },
  constraints: {
    requires: {
      transformationStage: ["modernization"]
    }
  },
  slots: {
    headline: (v) => `Cloud-native architecture transformation mandate accelerating deployment velocity at ${v.company}.`,
    opening: (v) => `Cloud transformation ${v.role} role at ${v.company}, migrating legacy monolithic applications to containerized microservices.`,
    editorialBridge: (v) => `Unlocks continuous deployment capabilities for ${v.company}, enabling engineering teams to ship features in hours rather than months.`,
    decisionGuidance: {
      proceedIf: (v) => `Migrating enterprise software to cloud-native microservices at ${v.company} matches your technical depth.`,
      pauseIf: () => `Verify cloud provider commitment and DevOps team staffing levels.`,
      closing: (v) => `Highest-conviction opportunity. Essential engineering modernization mandate at ${v.company}.`
    }
  }
};

// 17. Cybersecurity & Resilience Overhaul
export const transformationSecurityResiliencePattern: EditorialPattern = {
  id: "transformation-security-resilience-2q",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  editorialThesis: "Zero-Trust Cybersecurity & Enterprise Resilience",
  primaryQuestion: "How will you build zero-trust security and threat resilience?",
  editorialIntent: {
    primaryMessage: "zero_trust_security",
    supportingThemes: ["threat_resilience", "data_privacy"],
    avoidThemes: ["security_breach_vulnerability"]
  },
  constraints: {
    requires: {
      transformationStage: ["modernization", "turnaround"]
    }
  },
  slots: {
    headline: (v) => `Zero-trust cybersecurity mandate fortifying enterprise threat resilience at ${v.company}.`,
    opening: (v) => `Security transformation ${v.role} role at ${v.company}, establishing zero-trust access controls and data privacy standards.`,
    editorialBridge: (v) => `Safeguards enterprise assets for ${v.company} by embedding threat detection and automated incident response into core workflows.`,
    decisionGuidance: {
      proceedIf: (v) => `Building zero-trust security frameworks and leading enterprise threat resilience at ${v.company} match your background.`,
      pauseIf: () => `Confirm CISO budget authority and executive committee reporting access.`,
      closing: (v) => `Recommended first. Critical enterprise security overhaul mandate at ${v.company}.`
    }
  }
};

// 18. Global Capability Center (GCC) Buildout
export const transformationSharedServicesPattern: EditorialPattern = {
  id: "transformation-shared-services-2r",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  editorialThesis: "Global Capability Center (GCC) & Shared Services Buildout",
  primaryQuestion: "How will you build a high-efficiency Global Capability Center?",
  editorialIntent: {
    primaryMessage: "gcc_buildout",
    supportingThemes: ["shared_services", "talent_arbitrage"],
    avoidThemes: ["outsourcing_vendors"]
  },
  constraints: {
    requires: {
      transformationStage: ["modernization"]
    }
  },
  slots: {
    headline: (v) => `Global Capability Center (GCC) mandate scaling offshore engineering and operations at ${v.company}.`,
    opening: (v) => `GCC leadership ${v.role} position at ${v.company}, building a world-class offshore innovation and shared services hub.`,
    editorialBridge: (v) => `Scales technical capability for ${v.company} by capturing global talent arbitrage and building dedicated, high-alignment offshore squads.`,
    decisionGuidance: {
      proceedIf: (v) => `Establishing Global Capability Centers (GCCs) and scaling offshore delivery teams at ${v.company} match your track record.`,
      pauseIf: () => `Validate local entity incorporation status and hiring lead times.`,
      closing: (v) => `One to prioritize. High-leverage GCC expansion mandate at ${v.company}.`
    }
  }
};

// 19. Business Process Automation Architecture
export const transformationBusinessProcessPattern: EditorialPattern = {
  id: "transformation-business-process-2s",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  editorialThesis: "Enterprise Process Automation & Operational Efficiency",
  primaryQuestion: "How will you automate repetitive enterprise workflows?",
  editorialIntent: {
    primaryMessage: "process_automation",
    supportingThemes: ["workflow_efficiency", "rpa_automation"],
    avoidThemes: ["manual_spreadsheets"]
  },
  constraints: {
    requires: {
      transformationStage: ["modernization"]
    }
  },
  slots: {
    headline: (v) => `Process automation mandate driving operational workflow efficiency at ${v.company}.`,
    opening: (v) => `Automation ${v.role} position at ${v.company}, implementing intelligent process automation and workflow orchestration platforms.`,
    editorialBridge: (v) => `Eliminates manual operational bottlenecks at ${v.company}, reducing unit processing costs while improving accuracy.`,
    decisionGuidance: {
      proceedIf: (v) => `Automating complex enterprise business processes and deploying workflow tools at ${v.company} align with your experience.`,
      pauseIf: () => `Confirm software licensing budgets and change management capacity.`,
      closing: (v) => `Proceed to recruiter screening. High-efficiency process automation mandate at ${v.company}.`
    }
  }
};

// 20. Board-Mandated Strategic Turnaround
export const transformationBoardMandatePattern: EditorialPattern = {
  id: "transformation-board-mandate-2t",
  strategyId: "SCALE_TRANSFORMATION",
  angleId: "TURNAROUND_EXECUTION",
  editorialThesis: "Board-Mandated Strategic Enterprise Turnaround",
  primaryQuestion: "Why is this board-backed turnaround the ultimate test of leadership?",
  editorialIntent: {
    primaryMessage: "board_turnaround_mandate",
    supportingThemes: ["crisis_leadership", "enterprise_rebuilding"],
    avoidThemes: ["status_quo_management"]
  },
  constraints: {
    requires: {
      transformationStage: ["turnaround"],
      minScore: 75
    }
  },
  slots: {
    headline: (v) => `A landmark board-mandated turnaround role driving enterprise restructuring at ${v.company}.`,
    opening: (v) => `Board-appointed ${v.role} executive position at ${v.company}, given full mandate authority to lead an enterprise operational turnaround.`,
    editorialBridge: (v) => `Entrusts you with ultimate turnaround execution authority for ${v.company}, backed directly by board sponsorship.`,
    decisionGuidance: {
      proceedIf: (v) => `Executing high-stakes, board-mandated enterprise turnarounds at ${v.company} matches your executive profile.`,
      pauseIf: () => `Confirm board alignment on timeline expectations and governance emergency powers.`,
      closing: (v) => `Highest-conviction opportunity. Landmark turnaround mandate with direct board capital at ${v.company}.`
    }
  }
};
