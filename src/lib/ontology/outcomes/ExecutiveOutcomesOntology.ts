/**
 * ExecutiveOutcomesOntology.ts
 *
 * Step 2: Executive Outcomes & Business Value Ontology.
 * Bounded Context: Quantifiable business deliverables (*e.g., Opex Reduction, CAC Reduction, EBITDA Expansion, Time-to-Market Acceleration*).
 */

import type { ExecutiveOutcome } from "../certification/OntologyContracts";

export class ExecutiveOutcomesOntology {
  private static readonly outcomes: ExecutiveOutcome[] = [
    // Cost & Margin Category
    {
      id: "outcome_opex_reduction",
      category: "Cost & Margin",
      name: "Opex Reduction & Efficiency Realization",
      metricUnits: ["%", "$ USD", "₹ INR", "bps"],
      aliases: ["opex reduction", "cost reduction", "operating cost savings", "cost optimization", "efficiency realization", "margin expansion"]
    },
    {
      id: "outcome_ebitda_expansion",
      category: "Cost & Margin",
      name: "EBITDA Expansion & Recovery",
      metricUnits: ["%", "$ USD", "₹ INR", "bps"],
      aliases: ["ebitda expansion", "ebitda growth", "ebitda recovery", "margin recovery", "profitability enhancement"]
    },

    // Revenue & Market Category
    {
      id: "outcome_cac_reduction",
      category: "Revenue & Market",
      name: "CAC Reduction & Conversion Optimization",
      metricUnits: ["%", "$ USD", "₹ INR"],
      aliases: ["cac reduction", "customer acquisition cost reduction", "conversion optimization", "roas improvement", "lower cac"]
    },
    {
      id: "outcome_revenue_acceleration",
      category: "Revenue & Market",
      name: "Revenue Acceleration & LTV Expansion",
      metricUnits: ["%", "$ USD", "₹ INR", "ARR"],
      aliases: ["revenue acceleration", "ltv expansion", "arr growth", "top-line growth", "revenue expansion"]
    },
    {
      id: "outcome_market_expansion",
      category: "Revenue & Market",
      name: "Geographical & Vertical Market Expansion",
      metricUnits: ["countries", "regions", "% market share", "$ USD"],
      aliases: ["market expansion", "geographical expansion", "new market entry", "market share growth"]
    },

    // Velocity & Build Category
    {
      id: "outcome_time_to_market",
      category: "Velocity & Build",
      name: "Time-to-Market Acceleration & Build Cycle Speed",
      metricUnits: ["months", "weeks", "% cycle reduction"],
      aliases: ["time-to-market acceleration", "faster release cycle", "build speed", "reduced time to market"]
    },

    // Risk & Quality Category
    {
      id: "outcome_nps_retention_improvement",
      category: "Risk & Quality",
      name: "NPS & Customer Retention Improvement",
      metricUnits: ["NPS points", "% churn reduction", "% retention"],
      aliases: ["nps improvement", "churn reduction", "customer retention growth", "higher nps", "net promoter score"]
    }
  ];

  private static readonly index: Map<string, ExecutiveOutcome> = new Map();

  static {
    for (const item of this.outcomes) {
      this.index.set(item.id, item);
      this.index.set(item.name.toLowerCase().trim(), item);
      for (const alias of item.aliases) {
        this.index.set(alias.toLowerCase().trim(), item);
      }
    }
  }

  public static lookup(term: string): ExecutiveOutcome | null {
    const key = term.toLowerCase().trim();
    return this.index.get(key) || null;
  }

  public static getAll(): ExecutiveOutcome[] {
    return this.outcomes;
  }
}
