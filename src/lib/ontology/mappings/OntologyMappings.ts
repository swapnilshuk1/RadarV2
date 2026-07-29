/**
 * OntologyMappings.ts
 *
 * Step 3 (Data Knowledge Mappings): Explicit relationships linking
 * Executive Work Archetypes ──► Primary Executive Outcomes ──► Primary Capabilities.
 * Knowledge as pure data, not embedded procedural code.
 */

import type { WorkToOutcomeToCapabilityMapping } from "../certification/OntologyContracts";

export class OntologyMappings {
  private static readonly mappings: WorkToOutcomeToCapabilityMapping[] = [
    {
      workArchetypeId: "work_erp_modernization",
      primaryOutcomeIds: ["outcome_opex_reduction", "outcome_time_to_market"],
      primaryCapabilityIds: ["cap_technology_leadership", "cap_enterprise_transformation", "cap_operational_excellence"]
    },
    {
      workArchetypeId: "work_cloud_migration",
      primaryOutcomeIds: ["outcome_opex_reduction", "outcome_time_to_market"],
      primaryCapabilityIds: ["cap_technology_leadership", "cap_operational_excellence"]
    },
    {
      workArchetypeId: "work_gcc_establishment",
      primaryOutcomeIds: ["outcome_opex_reduction", "outcome_time_to_market"],
      primaryCapabilityIds: ["cap_operational_excellence", "cap_organizational_leadership"]
    },
    {
      workArchetypeId: "work_gtm_expansion",
      primaryOutcomeIds: ["outcome_revenue_acceleration", "outcome_market_expansion"],
      primaryCapabilityIds: ["cap_commercial_leadership", "cap_product_innovation"]
    },
    {
      workArchetypeId: "work_crm_modernization",
      primaryOutcomeIds: ["outcome_cac_reduction", "outcome_nps_retention_improvement"],
      primaryCapabilityIds: ["cap_customer_growth", "cap_commercial_leadership"]
    },
    {
      workArchetypeId: "work_pmi_execution",
      primaryOutcomeIds: ["outcome_opex_reduction", "outcome_ebitda_expansion"],
      primaryCapabilityIds: ["cap_capital_allocation", "cap_enterprise_transformation"]
    },
    {
      workArchetypeId: "work_pe_value_creation",
      primaryOutcomeIds: ["outcome_ebitda_expansion", "outcome_revenue_acceleration"],
      primaryCapabilityIds: ["cap_capital_allocation", "cap_governance_steering"]
    },
    {
      workArchetypeId: "work_operational_turnaround",
      primaryOutcomeIds: ["outcome_ebitda_expansion", "outcome_opex_reduction"],
      primaryCapabilityIds: ["cap_enterprise_transformation", "cap_capital_allocation"]
    }
  ];

  private static readonly mapByWork: Map<string, WorkToOutcomeToCapabilityMapping> = new Map();

  static {
    for (const m of this.mappings) {
      this.mapByWork.set(m.workArchetypeId, m);
    }
  }

  public static getMappingForWork(workArchetypeId: string): WorkToOutcomeToCapabilityMapping | null {
    return this.mapByWork.get(workArchetypeId) || null;
  }

  public static getAll(): WorkToOutcomeToCapabilityMapping[] {
    return this.mappings;
  }
}
