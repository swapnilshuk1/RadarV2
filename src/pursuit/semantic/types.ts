/**
 * src/pursuit/semantic/types.ts
 *
 * Three truth layers, kept separate so they cannot collapse into one another:
 *   1. SOURCE TRUTH       — what the evidence establishes (claim type, provenance).
 *   2. PURSUIT MEANING    — what it means for THIS mandate (DIRECT … UNSUPPORTED).
 *   3. PRESENTATION       — how strongly it may be said (phrase strength).
 * Evidence distance lives on the mapping edge, never on the claim.
 */

export const SEMANTIC_VERSIONS = {
  mandateSchema: "mandate-v1",
  evidenceMapper: "mapper-v1",
  artifactPolicy: "artifact-policy-v1",
  claimClassifier: "claim-classifier-v1",
} as const;

export type Domain =
  | "AGENCY_CLIENT_SERVICES"
  | "EXECUTIVE_SEARCH"
  | "DATA_AI_SERVICES"
  | "DATA_PLATFORMS"
  | "DIGITAL_MARKETING"
  | "BRAND_MARKETING"
  | "AUTOMOTIVE"
  | "GCC_OPERATIONS"
  | "PRODUCT_GROWTH"
  | "GENERAL";

export type SemanticClaimType =
  | "ROLE_TITLE"
  | "RESPONSIBILITY"
  | "SCOPE"
  | "ACHIEVEMENT"
  | "OUTCOME"
  | "METRIC"
  | "CAPABILITY"
  | "PROJECT"
  | "CREDENTIAL";

export type RenderState = "RAW_EVIDENCE" | "RESUME_READY" | "NEEDS_CONTEXT";

export interface ClaimClassification {
  claimId: string;
  semanticType: SemanticClaimType;
  renderState: RenderState;
  domains: Domain[];
  kinds: DimensionKind[];
  /** Kinds where the claim is only supporting (e.g. a spend budget vs ownership). */
  supportOnlyKinds: DimensionKind[];
  version: string;
}

export interface EvidenceBundle {
  id: string;
  employer: string;
  roleTitle: string | null;
  episode: string | null;
  claimIds: string[];
}

export type DimensionKind =
  | "CORE_DOMAIN_DELIVERY"
  | "COMMERCIAL_OWNERSHIP"
  | "CLIENT_LEADERSHIP"
  | "NEW_BUSINESS"
  | "PRACTICE_BUILDING"
  | "TEAM_LEADERSHIP"
  | "MULTI_MARKET_SCOPE"
  | "EXECUTIVE_STAKEHOLDER"
  | "DATA_TRANSFORMATION";

export type RequirementClass =
  | "MANDATE_CRITICAL"
  | "DOMAIN_CRITICAL"
  | "SCALE_CRITICAL"
  | "COMMERCIAL_CRITICAL"
  | "CREDENTIAL_CRITICAL"
  | "PREFERRED_CAPABILITY"
  | "GENERIC_TRAIT"
  | "SOFT_SKILL"
  | "HYGIENE_TOOL"
  | "BOILERPLATE";

export const CRITICAL_CLASSES: ReadonlySet<RequirementClass> = new Set([
  "MANDATE_CRITICAL",
  "DOMAIN_CRITICAL",
  "SCALE_CRITICAL",
  "COMMERCIAL_CRITICAL",
  "CREDENTIAL_CRITICAL",
]);

export interface MandateDimension {
  id: string;
  kind: DimensionKind;
  /** Domain the evidence must come from to count as DIRECT. Null = domain-agnostic. */
  scopedDomain: Domain | null;
  label: string;
  requirementClass: RequirementClass;
  importance: "REQUIRED" | "PREFERRED";
  sourceText: string;
  /** Canonical evaluator relationship for the linked dossier requirement (a ceiling). */
  dossierStatus?: string | null;
  /** Dossier candidate-claim ids and texts the evaluator used for this requirement. */
  dossierCandidateClaimIds?: string[];
  dossierEvidence?: string[];
}

export interface ClassifiedRequirement {
  requirement: string;
  requirementClass: RequirementClass;
  importance: "REQUIRED" | "PREFERRED";
  evaluatorStatus: string;
}

export interface MandateModel {
  roleDomain: Domain;
  roleDomainLabel: string;
  coreOutcome: string;
  dimensions: MandateDimension[];
  requirements: ClassifiedRequirement[];
}

export type EvidenceRelationship = "DIRECT" | "ANALOGOUS" | "ADJACENT" | "UNSUPPORTED";

export interface EvidenceMapping {
  dimensionId: string;
  claimId: string | null;
  bundleId: string | null;
  relationship: EvidenceRelationship;
  rationale: string;
  confidence: number;
}

export interface DimensionCoverage {
  dimensionId: string;
  label: string;
  best: EvidenceRelationship;
  claimIds: string[];
}

export interface Positioning {
  /** Stable identifier, e.g. "LATERAL:EXECUTIVE_SEARCH". */
  id: string;
  mode: "DIRECT_DOMAIN" | "LATERAL";
  domain: Domain;
  label: string;
  supporting: string[];
  gaps: string[];
}

export interface SemanticSnapshot {
  versions: typeof SEMANTIC_VERSIONS;
  candidateContextFingerprint: string;
  roleContextFingerprint: string;
  mandate: MandateModel;
  classifications: ClaimClassification[];
  bundles: EvidenceBundle[];
  mappings: EvidenceMapping[];
  coverage: DimensionCoverage[];
  positioning: Positioning;
  /** Proof claim id → relationship to the mandate, licensing phrase strength. */
  proofRelationships: Record<string, EvidenceRelationship>;
  knownContacts: string[];
}

export interface LensRelationshipRow {
  archetypeId: string;
  archetypeName: string;
  score: number;
  relationship: "STRONG_DIRECT" | "SUPPORTING" | "LOW";
  reasons: string[];
}
