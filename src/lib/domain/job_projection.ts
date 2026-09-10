// src/lib/domain/job_projection.ts

import { ClassifierResult, OperatingLevel, WorkNature, DecisionAuthority, CommercialScope } from "./semantic";
import type { CanonicalSemanticEvidence } from "../intelligence/semantic/types";

export type DocumentRegion = 
  | "TITLE"
  | "SUMMARY"
  | "RESPONSIBILITIES"
  | "REQUIREMENTS"
  | "COMPANY"
  | "BENEFITS";

/**
 * A bounded, source-grounded employer fact retained for presentation.
 * This is deliberately separate from capability classification and candidate
 * qualification requirements. It is not an evaluation-policy input.
 */
export type RoleWorkEvidenceKind =
  | "RESPONSIBILITY"
  | "OUTCOME"
  | "ROLE_CONTEXT";

export interface ProjectedRoleWorkEvidence {
  /** Stable source identity: opportunity version + normalized atom + occurrence. */
  id: string;
  kind: RoleWorkEvidenceKind;
  /** Whitespace-normalized exact sourceQuote; never an editorial paraphrase. */
  statement: string;
  sourceQuote: string;
  /** Extractor interpretation metadata; deliberately not part of identity. */
  sourceRegion: DocumentRegion;
  /** One-based normalized-source occurrence of sourceQuote in the pinned source. */
  ordinal: number;
  capabilityKeys: string[];
  confidence: number;
}

export type CapabilityTaxonomyTier = 
  | "CORE_MANDATE" 
  | "EXECUTION_CAPABILITY" 
  | "TECHNOLOGY_STACK" 
  | "DOMAIN_FAMILIARITY";

export interface ProjectedCapability {
  name: string;
  source: "explicit" | "inferred";
  confidence: number;
  tier?: CapabilityTaxonomyTier;
  evidence?: string[];
  /** Canonical semantic concept, provenance, and epistemic state for auditability. */
  canonicalConcept?: string;
  sourceQuote?: string;
  evidenceRelationship?: "DIRECT_EQUIVALENT" | "STRONG_SUPPORT" | "PARTIAL_SUPPORT" | "CONTEXTUAL_SUPPORT";
  state?: "EXPLICIT" | "INFERRED" | "UNKNOWN";
}

/**
 * A source-grounded qualification requirement for a capability. This is
 * deliberately separate from a responsibility: only explicit candidate
 * qualification language can set `required`.
 */
export interface CapabilityRequirement {
  capability: string;
  tier: CapabilityTaxonomyTier;
  required: boolean;
  materiality: "CORE" | "SUPPORTING";
  /** Stable references to the source phrases retained below. */
  evidenceIds: string[];
  sourceQuotes: string[];
}

export interface ExecutiveIdentity {
  value: string;
  confidence: number;
  evidence: string[];
}

export interface OperatingContext {
  budgetOwnership?: boolean;
  pnlResponsibility?: boolean;
  teamSize?: string | number;
  directReports?: boolean;
  vendorManagement?: boolean;
  complianceAudit?: boolean;
  remote?: boolean;
  hybrid?: boolean;
  travel?: boolean;
}

export type TrueExecutiveMandate = 
  | "SCALE" 
  | "TRANSFORMATION" 
  | "TURNAROUND" 
  | "GOVERNANCE" 
  | "COMMERCIAL_EXPANSION";

export type OrganizationalIntent = 
  | "REPLACE_FAILED_LEADER"
  | "BUILD_NEW_CAPABILITY"
  | "PROFESSIONALIZE_FOUNDER_COMPANY"
  | "PREPARE_IPO"
  | "INTEGRATE_ACQUISITION"
  | "REPAIR_EXECUTION"
  | "ACCELERATE_GROWTH"
  | "EXPAND_GEOGRAPHY"
  | "COMMERCIALIZE_TECHNOLOGY";

export interface ExecutiveMission {
  intent: OrganizationalIntent;
  statement: string;
  successConditions: string[];
}

export interface GroundedDimensionEvidence {
  quote?: string;
  provenance?: "curated" | "extractor" | "gold" | "fixture" | "onboarder";
}

export interface GroundedOpportunityDimension {
  key: string;
  label: string;
  importance: "Core" | "Supporting" | "Context";
  bucket: "Matched" | "Adjacent" | "Missing" | "Contradicted";
  jdEvidence: {
    status: "Explicit" | "Implicit" | "Missing" | "Missing Evidence";
    value?: string;
    evidence?: GroundedDimensionEvidence[];
  };
  candidateProof?: { headline: string; detail: string };
}

export interface JobProjection {
  jobHash: string;
  role: string;
  company: string;
  
  // High-level professional identity
  executiveIdentity: ExecutiveIdentity;
  
  // Inferred True Executive Mandate & Intent
  trueExecutiveMandate?: TrueExecutiveMandate;
  executiveMission?: ExecutiveMission;

  // Standard semantic classifiers
  operatingLevel: ClassifierResult<OperatingLevel>;
  workNature: ClassifierResult<WorkNature>;
  decisionAuthority: ClassifierResult<DecisionAuthority>;
  commercialScope: ClassifierResult<CommercialScope>;
  
  // Normalized capabilities
  capabilities: ProjectedCapability[];
  /** Explicit job-side qualification requirements; never inferred from duties alone. */
  capabilityRequirements?: CapabilityRequirement[];
  
  // Theme dimensions
  executiveFunction: string[];
  businessObjectives: string[];
  executionStyle: string[];
  
  // Deterministic structural metadata
  operatingContext: OperatingContext;
  
  location: string;
  workModel: "HYBRID" | "REMOTE" | "ON_SITE" | "UNKNOWN";
  capabilityExtractionStatus: "COMPLETE" | "PARTIAL" | "FAILED";
  originalOpportunity?: any;
  dimensions?: readonly GroundedOpportunityDimension[];
  // Phase 5C.2: Additive Canonical Semantic Evidence
  semanticEvidence?: readonly CanonicalSemanticEvidence[];
  /**
   * Presentation-only source retention. Evaluation engines receive
   * EvaluationJobProjection, where this field is intentionally unavailable.
   */
  roleWorkEvidence?: readonly ProjectedRoleWorkEvidence[];
  roleWorkEvidenceVersion?: string;
  projectionVersion?: string;
  projectionFingerprint?: string;
}

/**
 * The only projection view evaluation engines may consume. Keep presentation
 * evidence out of the evaluation-policy type contract, not merely out of
 * current engine implementations.
 *
 * originalOpportunity remains because the established assessment engines use
 * it for evidence-richness calculations; it must not be used to reconstruct
 * roleWorkEvidence inside evaluation code.
 */
export type EvaluationJobProjection = Pick<
  JobProjection,
  | "jobHash"
  | "role"
  | "company"
  | "executiveIdentity"
  | "trueExecutiveMandate"
  | "executiveMission"
  | "operatingLevel"
  | "workNature"
  | "decisionAuthority"
  | "commercialScope"
  | "capabilities"
  | "capabilityRequirements"
  | "executiveFunction"
  | "businessObjectives"
  | "executionStyle"
  | "operatingContext"
  | "location"
  | "workModel"
  | "capabilityExtractionStatus"
  | "dimensions"
  | "semanticEvidence"
  | "originalOpportunity"
>;

export function toEvaluationJobProjection(
  projection: JobProjection,
): EvaluationJobProjection {
  const {
    jobHash,
    role,
    company,
    executiveIdentity,
    trueExecutiveMandate,
    executiveMission,
    operatingLevel,
    workNature,
    decisionAuthority,
    commercialScope,
    capabilities,
    capabilityRequirements,
    executiveFunction,
    businessObjectives,
    executionStyle,
    operatingContext,
    location,
    workModel,
    capabilityExtractionStatus,
    dimensions,
    semanticEvidence,
    originalOpportunity,
  } = projection;

  return {
    jobHash,
    role,
    company,
    executiveIdentity,
    trueExecutiveMandate,
    executiveMission,
    operatingLevel,
    workNature,
    decisionAuthority,
    commercialScope,
    capabilities,
    capabilityRequirements,
    executiveFunction,
    businessObjectives,
    executionStyle,
    operatingContext,
    location,
    workModel,
    capabilityExtractionStatus,
    dimensions,
    semanticEvidence,
    originalOpportunity,
  };
}
