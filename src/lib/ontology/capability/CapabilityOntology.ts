/**
 * CapabilityOntology.ts
 *
 * Step 3: Enduring Executive Capability Ontology.
 * Bounded Context: 10 Peer Enduring Executive Capability Families.
 */

import type { CapabilityDefinition, CapabilityFamily } from "../certification/OntologyContracts";

export class CapabilityOntology {
  private static readonly capabilities: CapabilityDefinition[] = [
    {
      id: "cap_enterprise_transformation",
      family: "Enterprise Transformation",
      name: "Enterprise Transformation & Operating Model Redesign",
      description: "Enduring capacity to lead legacy-to-modern transformations, operating model redesigns, and structural change initiatives.",
      aliases: ["enterprise transformation", "operating model redesign", "legacy migration", "business transformation", "re-platforming"]
    },
    {
      id: "cap_commercial_leadership",
      family: "Commercial Leadership",
      name: "Commercial Leadership & Revenue Governance",
      description: "Ability to establish multi-channel GTM strategies, govern commercial P&L allocations, and accelerate revenue growth.",
      aliases: ["commercial leadership", "revenue governance", "multi-channel gtm", "full-funnel acquisition", "commercial ownership"]
    },
    {
      id: "cap_product_innovation",
      family: "Product & Innovation",
      name: "Product Innovation & 0-to-1 Build",
      description: "Proven capacity to lead product vision, launch 0-to-1 divisions, and establish scalable platform architectures.",
      aliases: ["product innovation", "0-to-1 build", "platform strategy", "product vision", "portfolio expansion"]
    },
    {
      id: "cap_technology_leadership",
      family: "Technology Leadership",
      name: "Enterprise Technology Leadership & Architecture",
      description: "Leadership across enterprise technology stacks, cloud infrastructure, AI/ML platforms, and tech governance.",
      aliases: ["technology leadership", "enterprise architecture", "cloud infrastructure", "ai platform", "tech governance"]
    },
    {
      id: "cap_customer_growth",
      family: "Customer Growth & Lifecycle",
      name: "Customer Growth, Retention & Lifecycle Governance",
      description: "Accountability for customer data platforms, lifecycle retention engines, and lifetime value optimization.",
      aliases: ["customer growth", "lifecycle marketing", "crm strategy", "customer retention", "ltv expansion", "churn reduction"]
    },
    {
      id: "cap_operational_excellence",
      family: "Operational Excellence",
      name: "Operational Excellence & Global Capability Scaling",
      description: "Proven ability to scale GCCs/CoEs, streamline global supply chains, and enforce operational process governance.",
      aliases: ["operational excellence", "gcc scaling", "center of excellence", "supply chain optimization", "process governance"]
    },
    {
      id: "cap_capital_allocation",
      family: "Capital Allocation & Investment",
      name: "Capital Allocation & PE Value Creation",
      description: "Expertise in value creation planning, post-merger integration, M&A synergy realization, and exit readiness.",
      aliases: ["capital allocation", "pe value creation", "m&a integration", "synergies realization", "lbo value creation"]
    },
    {
      id: "cap_governance_steering",
      family: "Governance & Steering",
      name: "Executive Governance & Board Steering",
      description: "Experience in board advisory, corporate steering, regulatory compliance, and enterprise risk management.",
      aliases: ["executive governance", "board steering", "board advisory", "regulatory compliance", "enterprise risk management"]
    },
    {
      id: "cap_organizational_leadership",
      family: "Organizational Leadership",
      name: "Organizational Leadership & Talent Strategy",
      description: "Direct accountability to design global multi-region org structures, build executive pipelines, and foster culture.",
      aliases: ["organizational leadership", "talent strategy", "multi-region org design", "executive pipeline", "org design"]
    },
    {
      id: "cap_ecosystem_alliances",
      family: "Ecosystem & Alliances",
      name: "Ecosystem Partnerships & Strategic Alliances",
      description: "Ability to establish strategic joint ventures, partner distribution networks, and enterprise ecosystem alliances.",
      aliases: ["ecosystem partnerships", "strategic alliances", "joint ventures", "channel partner network"]
    }
  ];

  private static readonly index: Map<string, CapabilityDefinition> = new Map();

  static {
    for (const item of this.capabilities) {
      this.index.set(item.id, item);
      this.index.set(item.name.toLowerCase().trim(), item);
      for (const alias of item.aliases) {
        this.index.set(alias.toLowerCase().trim(), item);
      }
    }
  }

  public static lookup(term: string): CapabilityDefinition | null {
    const key = term.toLowerCase().trim();
    return this.index.get(key) || null;
  }

  public static getByFamily(family: CapabilityFamily): CapabilityDefinition[] {
    return this.capabilities.filter(c => c.family === family);
  }

  public static getAll(): CapabilityDefinition[] {
    return this.capabilities;
  }
}
