/**
 * ExecutiveWorkOntology.ts
 *
 * Step 1: Hierarchical Executive Work Archetype Ontology.
 * Bounded Context: Repeatable executive activities (*e.g., ERP Modernization, Post-Merger Integration, Building GCC*).
 */

import type { ExecutiveWorkArchetype } from "../certification/OntologyContracts";

export class ExecutiveWorkOntology {
  private static readonly archetypes: ExecutiveWorkArchetype[] = [
    // Operational Change Category
    {
      id: "work_erp_modernization",
      category: "Operational Change",
      name: "ERP Modernization & Core Migration",
      description: "Leading complex enterprise ERP migrations, core platform replacements, and digital core modernization.",
      aliases: ["erp modernization", "erp migration", "sap migration", "s/4hana", "oracle cloud erp", "core migration", "erp replacement"],
      typicalDeliverables: ["ERP Architecture Roadmap", "System Cutover", "Process Standardization"]
    },
    {
      id: "work_cloud_migration",
      category: "Operational Change",
      name: "Cloud Infrastructure Migration",
      description: "Migrating legacy data center workloads to cloud environments and establishing hybrid cloud governance.",
      aliases: ["cloud migration", "data center migration", "cloud transformation", "aws migration", "azure cloud", "gcp migration"],
      typicalDeliverables: ["Cloud Architecture Blueprint", "Legacy Decommissioning", "Opex Optimization"]
    },
    {
      id: "work_gcc_establishment",
      category: "Operational Change",
      name: "GCC / CoE Establishment & Scaling",
      description: "Establishing and scaling Global Capability Centers, Centers of Excellence, and shared services organizations.",
      aliases: ["gcc establishment", "center of excellence", "coe scaling", "shared services launch", "global capability center"],
      typicalDeliverables: ["Operating Model Design", "Location Strategy", "Talent Ramp"]
    },

    // Commercial Growth Category
    {
      id: "work_gtm_expansion",
      category: "Commercial Growth",
      name: "Multi-Channel GTM Expansion",
      description: "Designing and executing go-to-market strategies, expanding into new geographical or vertical channels.",
      aliases: ["gtm expansion", "go-to-market strategy", "market entry", "channel expansion", "international GTM"],
      typicalDeliverables: ["GTM Playbook", "Sales Channel Scaling", "Customer Acquisition Ramp"]
    },
    {
      id: "work_crm_modernization",
      category: "Commercial Growth",
      name: "CRM & Lifecycle Marketing Scaling",
      description: "Modernizing customer relationship management platforms and scaling automated lifecycle retention engines.",
      aliases: ["crm modernization", "lifecycle marketing", "salesforce marketing cloud", "retention engine", "crm scaling"],
      typicalDeliverables: ["Customer Data Platform Setup", "Churn Reduction Engine", "LTV Expansion"]
    },

    // Corporate Change Category
    {
      id: "work_pmi_execution",
      category: "Corporate Change",
      name: "Post-Merger Integration (PMI)",
      description: "Executing post-acquisition integrations, consolidating technology platforms, and realizing commercial synergies.",
      aliases: ["post-merger integration", "pmi", "m&a integration", "acquisition integration", "synergies realization"],
      typicalDeliverables: ["100-Day PMI Plan", "Tech Platform Consolidation", "Synergy Capture Report"]
    },
    {
      id: "work_pe_value_creation",
      category: "Corporate Change",
      name: "PE Value Creation Plan Execution",
      description: "Executing value creation plans for PE-backed portfolio companies to drive margin expansion and exit readiness.",
      aliases: ["pe value creation", "value creation plan", "lbo value creation", "exit readiness", "portfolio optimization"],
      typicalDeliverables: ["EBITDA Expansion Plan", "Working Capital Optimization", "Exit Due Diligence Brief"]
    },

    // Governance & Restructuring Category
    {
      id: "work_operational_turnaround",
      category: "Governance & Restructuring",
      name: "Operational Turnaround & Cost Restructuring",
      description: "Stabilizing distressed business units, restructuring operational costs, and restoring margin profitability.",
      aliases: ["operational turnaround", "cost restructuring", "turnaround", "distressed business stabilization", "cost optimization"],
      typicalDeliverables: ["Cost Reduction Roadmap", "Cash Flow Stabilization", "Org Rightsizing"]
    }
  ];

  private static readonly index: Map<string, ExecutiveWorkArchetype> = new Map();

  static {
    for (const item of this.archetypes) {
      this.index.set(item.id, item);
      this.index.set(item.name.toLowerCase().trim(), item);
      for (const alias of item.aliases) {
        this.index.set(alias.toLowerCase().trim(), item);
      }
    }
  }

  public static lookup(term: string): ExecutiveWorkArchetype | null {
    const key = term.toLowerCase().trim();
    return this.index.get(key) || null;
  }

  public static getAll(): ExecutiveWorkArchetype[] {
    return this.archetypes;
  }
}
