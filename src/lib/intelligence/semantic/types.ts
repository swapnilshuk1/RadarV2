/**
 * src/lib/intelligence/semantic/types.ts
 *
 * RADAR V4 Pure Semantic Core Type Definitions & Evidence Contracts
 *
 * Invariant Rules:
 * 1. Semantic Resolution = Resolves meaning (What does this phrase/entity mean?)
 * 2. Requirement Satisfaction = Evaluated by assessment engines (Does that meaning satisfy this specific requirement?)
 * 3. Directionality = Strict non-symmetric relationships (MEMBER_OF, CONTAINS, SUBSIDIARY_OF, BUSINESS_UNIT_OF)
 * 4. Separation = Extraction confidence is NOT a score weight; Evidence relationship is NOT a policy verdict.
 */

export type SemanticRelationship =
  | "EXACT"
  | "ALIAS"
  | "ACRONYM"
  | "LEXICAL_VARIANT"
  | "STRONG_EQUIVALENT"
  | "SUBTYPE"
  | "SUPERTYPE"
  | "METRIC_OF"
  | "RELATED"
  | "PARENT_ENTITY"
  | "SUBSIDIARY"
  | "BUSINESS_UNIT"
  | "BRAND"
  | "PRODUCT"
  | "CITY_ALIAS"
  | "METRO_CLUSTER"
  | "ADMINISTRATIVE_CONTAINMENT"
  | "AMBIGUOUS"
  | "NEGATED"
  | "HISTORICAL"
  | "ASPIRATIONAL";

export type EvidenceRelationship =
  | "DIRECT_EQUIVALENT"
  | "STRONG_SUPPORT"
  | "PARTIAL_SUPPORT"
  | "CONTEXTUAL_SUPPORT"
  | "CONTRIBUTOR"
  | "STAKEHOLDER"
  | "NON_SATISFYING"
  | "EXCLUDED";

export type EntityType =
  | "CAPABILITY"
  | "FINANCIAL_SCOPE"
  | "SENIORITY_TITLE"
  | "GEOGRAPHY"
  | "ORGANIZATION"
  | "MANDATE"
  | "PEOPLE_SCOPE";

export type Directionality =
  | "BIDIRECTIONAL_EQUIVALENT"
  | "SOURCE_TO_TARGET"
  | "TARGET_TO_SOURCE"
  | "MEMBER_OF"
  | "CONTAINS"
  | "SUBSIDIARY_OF"
  | "PARENT_OF"
  | "BUSINESS_UNIT_OF"
  | "METRIC_FOR"
  | "NONE";

export type TemporalState = "CURRENT" | "HISTORICAL" | "ASPIRATIONAL" | "UNKNOWN";

export type EvidenceStrength =
  | "DIRECT_OWNERSHIP"
  | "CONTRIBUTOR"
  | "STAKEHOLDER"
  | "EXCLUDED";

export type SeniorityBand =
  | "C_SUITE"
  | "VP"
  | "DIRECTOR"
  | "HEAD"
  | "LEAD"
  | "MANAGER"
  | "INDIVIDUAL_CONTRIBUTOR"
  | "COORDINATOR_ENTRY"
  | "UNKNOWN";

export interface CanonicalSemanticEvidence {
  readonly canonicalConcept: string;
  readonly entityType: EntityType;
  readonly semanticRelationship: SemanticRelationship;
  readonly evidenceRelationship: EvidenceRelationship;
  readonly direction: Directionality;
  readonly confidence: number; // Measurement certainty [0.0 - 1.0], NEVER a scoring multiplier
  readonly sourcePhrase: string;
  readonly context: string;
  readonly negated: boolean;
  readonly temporalState: TemporalState;
  readonly evidenceStrength: EvidenceStrength;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SeniorityResolutionResult {
  readonly canonicalTitle: string;
  readonly seniorityBand: SeniorityBand;
  readonly functionalArea?: string;
  readonly organizationalScope?: string;
  readonly peopleManagementSignal: boolean;
  readonly geographicScope?: string;
  readonly businessOwnershipSignal: boolean;
  readonly ambiguityState: "RESOLVED" | "AMBIGUOUS" | "UNRESOLVED";
  readonly confidence: number;
  readonly evidence: CanonicalSemanticEvidence;
}

export interface FinancialScopeResolutionResult {
  readonly canonicalConcept: string;
  readonly scaleAmountUsd?: number;
  readonly scaleAmountInrCrores?: number;
  readonly hasPnlOwnership: boolean;
  readonly hasEbitdaAccountability: boolean;
  readonly hasRevenueAccountability: boolean;
  readonly hasBudgetAuthority: boolean;
  readonly evidenceStrength: EvidenceStrength;
  readonly temporalState: TemporalState;
  readonly negated: boolean;
  readonly evidence: CanonicalSemanticEvidence;
}

export interface GeographyResolutionResult {
  readonly sourceLocation: string;
  readonly targetLocation?: string;
  readonly canonicalLocation: string;
  readonly semanticRelationship: SemanticRelationship;
  readonly evidenceRelationship: EvidenceRelationship;
  readonly direction: Directionality;
  readonly isCityEquivalent: boolean;
  readonly isMetroCommuteCompatible: boolean;
  readonly isAdministrativeContainmentOnly: boolean;
  readonly confidence: number;
  readonly evidence: CanonicalSemanticEvidence;
}

export interface OrganizationResolutionResult {
  readonly sourceOrganization: string;
  readonly canonicalEntity: string;
  readonly parentEntity?: string;
  readonly organizationType: "PARENT" | "SUBSIDIARY" | "BUSINESS_UNIT" | "BRAND" | "STANDALONE";
  readonly semanticRelationship: SemanticRelationship;
  readonly direction: Directionality;
  readonly isTier1Pedigree: boolean;
  readonly confidence: number;
  readonly isFalsePositiveContext: boolean;
  readonly evidence: CanonicalSemanticEvidence;
}

export interface CompositionalEvidenceResult {
  readonly rawText: string;
  readonly evidenceList: readonly CanonicalSemanticEvidence[];
  readonly dominantScope?: FinancialScopeResolutionResult;
  readonly dominantSeniority?: SeniorityResolutionResult;
  readonly dominantGeography?: GeographyResolutionResult;
  readonly dominantOrganization?: OrganizationResolutionResult;
}
