/**
 * Registry.ts
 *
 * Lightweight, static, memory-efficient capability registry mapping
 * alias terms and synonyms directly to canonical capability keys.
 *
 * Avoids Neo4j or complex databases; loads as a pure static lookup.
 */

export interface CapabilityRegistryEntry {
  id: string;
  name: string;
  description: string;
  aliases: string[];
  relatedTerms: string[];
}

export class CapabilityRegistry {
  private static readonly entries: CapabilityRegistryEntry[] = [
    {
      id: "cap_crm_strategy",
      name: "CRM & Customer Retention Strategy",
      description: "Ability to lead, scale, and govern CRM systems and customer retention architectures.",
      aliases: ["crm", "salesforce", "hubspot", "microsoft dynamics", "zoho crm", "customer retention", "customer lifecycle", "crm strategy", "crm migration", "crm transformation", "lifecycle marketing", "customer journey", "salesforce marketing cloud", "salesforce cdp", "salesforce data cloud"],
      relatedTerms: ["marketing automation", "retention metrics", "clv", "churn reduction"]
    },
    {
      id: "cap_growth_marketing",
      name: "Growth Marketing & Demand Generation",
      description: "Proven capacity to design and execute high-scale customer acquisition and full-funnel performance marketing initiatives.",
      aliases: ["growth strategy", "growth marketing", "customer acquisition", "demand generation", "performance marketing", "digital acquisition", "full-funnel acquisition", "roas optimization", "lead generation", "paid search", "paid social", "organic acquisition"],
      relatedTerms: ["roas", "cac", "funnel conversion", "brand awareness"]
    },
    {
      id: "cap_marketing_analytics",
      name: "Marketing Analytics & Data Science",
      description: "Ability to establish attribution frameworks, run cross-channel experimentation, and embed analytics into strategy.",
      aliases: ["marketing analytics", "digital analytics", "performance analytics", "experimentation", "cro", "a/b testing", "multivariate testing", "o2o attribution", "data analytics", "attribution modeling", "experimentation lab"],
      relatedTerms: ["google analytics", "bi dashboards", "conversion optimization", "data-driven decisions"]
    },
    {
      id: "cap_digital_transformation",
      name: "Digital & Business Transformation",
      description: "Accountability for leading complex legacy-to-modern transformations, operating model design, and scaling capability centers.",
      aliases: ["digital transformation", "business transformation", "marketing transformation", "operating model design", "center of excellence", "gcc scaling", "global capability center", "re-platform", "legacy migration"],
      relatedTerms: ["change management", "organizational design", "coe scaling", "capability centers"]
    },
    {
      id: "cap_executive_growth_scale",
      name: "Executive Growth & Scale Mandate",
      description: "Direct executive accountability to scale operations or establish completely new greenfield structures.",
      aliases: ["scale", "greenfield", "growth scale", "operations scaling", "global expansion", "scaling operations"],
      relatedTerms: ["ceo", "board reporting", "executive steering", "hypergrowth"]
    },

    {
      id: "cap_business_turnaround",
      name: "Corporate Turnaround & Restructuring",
      description: "Expertise in stabilizing declining business units, restructuring teams, and driving EBITDA/margin recovery.",
      aliases: ["turnaround", "restructuring", "ebitda recovery", "margin recovery", "operational turnaround", "stabilization"],
      relatedTerms: ["cost optimization", "org design", "change management"]
    },
    {
      id: "cap_enterprise_financial_stewardship",
      name: "Enterprise Financial Stewardship",
      description: "Direct accountability for managing large operational budgets, revenue targets, and P&L allocations.",
      aliases: ["budget", "p&l ownership", "revenue targets", "ebitda", "financial stewardship", "p&l responsibility", "opex", "capex"],
      relatedTerms: ["financial forecasting", "capital allocation", "cost centers"]
    },
    {
      id: "cap_high_growth_builder",
      name: "Greenfield Builder",
      description: "Experience building product divisions or regional branches from 0 to 1.",
      aliases: ["greenfield building", "0 to 1", "new divisions", "division launch", "geographical expansion", "entity launch"],
      relatedTerms: ["hiring pipeline", "market entry", "mvp launch"]
    }
  ];

  private static readonly aliasIndex: Map<string, string> = new Map();

  static {
    for (const entry of this.entries) {
      for (const alias of entry.aliases) {
        this.aliasIndex.set(alias.toLowerCase().trim(), entry.id);
      }
      // Also index related terms to expand matching
      for (const term of entry.relatedTerms) {
        this.aliasIndex.set(term.toLowerCase().trim(), entry.id);
      }
      // Index the canonical ID and name lowercased
      this.aliasIndex.set(entry.id.toLowerCase(), entry.id);
      this.aliasIndex.set(entry.name.toLowerCase().trim(), entry.id);
    }
  }

  /**
   * Performs an O(1) lexical lookup for a capability based on an alias or synonym.
   */
  public static lookup(term: string): CapabilityRegistryEntry | null {
    const key = term.toLowerCase().trim();
    const id = this.aliasIndex.get(key);
    if (!id) return null;
    return this.entries.find(e => e.id === id) || null;
  }

  /**
   * Extracts matched capability IDs from any arbitrary array of lexical keywords/labels.
   */
  public static extractCapabilities(keywords: string[]): string[] {
    const matchedIds = new Set<string>();
    for (const keyword of keywords) {
      const match = this.lookup(keyword);
      if (match) {
        matchedIds.add(match.id);
      }
    }
    return Array.from(matchedIds);
  }

  /**
   * Returns all registered capabilities.
   */
  public static getAll(): CapabilityRegistryEntry[] {
    return this.entries;
  }
}
