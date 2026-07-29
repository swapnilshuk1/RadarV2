/**
 * OntologyContracts.ts
 *
 * Step 0: Constitutional contracts, entity interfaces, and dependency rules for RADAR v2.
 * Version: 1.0.0
 * Status: FROZEN CONSTITUTIONAL BASELINE
 */

export const ONTOLOGY_SCHEMA_VERSION = "1.0.0";

/**
 * 1. Executive Work Archetype (Repeatable Executive Activity)
 */
export interface ExecutiveWorkArchetype {
  id: string;
  category: "Operational Change" | "Commercial Growth" | "Corporate Change" | "Governance & Restructuring";
  name: string;
  description: string;
  aliases: string[];
  typicalDeliverables: string[];
}

/**
 * 2. Executive Outcome (Quantifiable Deliverable / Business Value)
 */
export interface ExecutiveOutcome {
  id: string;
  category: "Cost & Margin" | "Revenue & Market" | "Velocity & Build" | "Risk & Quality";
  name: string;
  metricUnits: string[];
  aliases: string[];
}

/**
 * 3. Enduring Executive Capability
 */
export type CapabilityFamily =
  | "Enterprise Transformation"
  | "Commercial Leadership"
  | "Product & Innovation"
  | "Technology Leadership"
  | "Customer Growth & Lifecycle"
  | "Operational Excellence"
  | "Capital Allocation & Investment"
  | "Governance & Steering"
  | "Organizational Leadership"
  | "Ecosystem & Alliances";

export interface CapabilityDefinition {
  id: string;
  family: CapabilityFamily;
  name: string;
  description: string;
  aliases: string[];
}

/**
 * 4. Explicit Data Knowledge Relationship Mapping
 */
export interface WorkToOutcomeToCapabilityMapping {
  workArchetypeId: string;
  primaryOutcomeIds: string[];
  primaryCapabilityIds: string[];
}

/**
 * 5. Structured 3-Axis Work Nature
 */
export interface StructuredWorkNature {
  situation: ("TURNAROUND" | "HYPERGROWTH" | "CRISIS" | "STABILIZATION")[];
  context: ("GREENFIELD" | "M_AND_A" | "DIVESTITURE" | "PE_BACKED")[];
  pattern: ("STRATEGIC_TRANSFORMATION" | "OPERATIONAL_SCALING" | "ADVISORY")[];
}

/**
 * 6. Dual Confidence Metric
 */
export interface DualConfidence {
  evidenceConfidence: number;  // Certainty of extracted text facts from LLM
  inferenceConfidence: number; // Certainty of derived operating level / altitude classification
}
