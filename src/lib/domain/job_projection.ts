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

/**
 * A bounded, source-grounded candidate qualification retained for
 * presentation. It is deliberately separate from role work and unavailable
 * to evaluation policy.
 */
export interface ProjectedQualificationEvidence {
  id: string;
  statement: string;
  sourceQuote: string;
  sourceRegion: DocumentRegion;
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
  /** Stable canonical source references when an explicit capability retains a quote. */
  evidenceIds?: string[];
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

/**
 * A minimal, structured source-reference view available to evaluation.
 * It carries capability identity and stable evidence identifiers only; it
 * deliberately does not expose presentation statements or reclassify source
 * material inside an evaluation engine.
 */
export interface EvaluationCapabilityEvidenceRef {
  capabilityKey: string;
  evidenceIds: string[];
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
  /** Presentation-only qualification retention; never an evaluation input. */
  presentationQualificationEvidence?: readonly ProjectedQualificationEvidence[];
  presentationQualificationEvidenceVersion?: string;
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
> & {
  /** Opaque evaluator-facing source references; never role-work prose. */
  capabilityEvidence: readonly EvaluationCapabilityEvidenceRef[];
};

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

  const capabilityEvidence = new Map<string, Set<string>>();
  const addEvidence = (capabilityKey: unknown, evidenceIds: unknown) => {
    if (typeof capabilityKey !== "string" || !capabilityKey.trim() || !Array.isArray(evidenceIds)) return;
    const key = capabilityKey.trim();
    const ids = capabilityEvidence.get(key) ?? new Set<string>();
    for (const id of evidenceIds) {
      if (typeof id === "string" && id.trim()) ids.add(id.trim());
    }
    if (ids.size > 0) capabilityEvidence.set(key, ids);
  };

  // Requirements are canonical capability evidence. Presentation evidence is
  // carried only as opaque ids keyed by its already-classified capability;
  // evaluation never reads its text or changes its classification.
  for (const requirement of capabilityRequirements ?? []) {
    addEvidence(requirement.capability, requirement.evidenceIds);
  }
  for (const capability of capabilities ?? []) {
    if (typeof capability === "string") continue;
    addEvidence(capability.canonicalConcept || capability.name, capability.evidenceIds);
  }
  for (const atom of [
    ...(projection.roleWorkEvidence ?? []),
    ...(projection.presentationQualificationEvidence ?? []),
  ]) {
    for (const capabilityKey of atom.capabilityKeys ?? []) {
      addEvidence(capabilityKey, [atom.id]);
    }
  }

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
    capabilityEvidence: [...capabilityEvidence.entries()].map(([capabilityKey, ids]) => ({
      capabilityKey,
      evidenceIds: [...ids].sort(),
    })),
    originalOpportunity,
  };
}
