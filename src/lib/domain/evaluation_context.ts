/**
 * evaluation_context.ts
 *
 * Phase M3: Multi-Tenant Evaluation Context & Read Model Domain Types.
 *
 * Invariants:
 * 1. SearchPlanSnapshot is immutable: snapshotHash is SHA-256 of canonicalized criteria.
 * 2. EvaluationContext is immutable: contextFingerprint is SHA-256 of canonical context tuple.
 * 3. MaterializedEvaluation is immutable: binds (canonicalJobId, opportunityVersion, contextFingerprint).
 * 4. User decisions are strictly decoupled from MaterializedEvaluation.
 */

import type { AuthorizedPersonScope } from "../security/auth";

/**
 * Explicit serving policy for the geographic scope expressed by a search plan.
 * Portal-side query parameters are discovery hints; this policy is enforced
 * against the captured job location before candidate projection.
 */
export type LocationEligibilityPolicy =
  | "GURUGRAM_ONLY"
  | "NCR"
  | "REMOTE_COMPATIBLE"
  | "NATIONWIDE";

/** Immutable semantic companion to query-oriented acquisition planning. */
export interface EligibilitySpec {
  version: "eligibility-spec/v1";
  ontologyVersion: string;
  roleFamilies: string[];
  functions: string[];
  seniorityRange: string[];
  locations: string[];
  /**
   * Omitted only for legacy immutable contexts. New contexts must state their
   * serving geography rather than relying on a portal query-string filter.
   */
  locationPolicy?: LocationEligibilityPolicy;
  industries: string[];
  adjacentFamilies: string[];
  excludedCompanies: string[];
}

export interface SearchCriteriaPayload {
  targetSeniority: string[];
  targetRoles: string[];
  targetLocations: string[];
  targetIndustries?: string[];
  targetEmploymentTypes?: string[];
  excludedCompanies?: string[];
  minimumFitThreshold?: number;
  eligibilitySpec?: EligibilitySpec;
  customParameters?: Record<string, unknown>;
}

export interface SearchPlan {
  id: string;
  tenantId: string;
  personId: string;
  title: string;
  status: "active" | "paused" | "archived";
  criteria: SearchCriteriaPayload;
  createdAt: string;
  updatedAt: string;
}

export interface SearchPlanSnapshot {
  id: string;
  searchPlanId: string;
  tenantId: string;
  personId: string;
  snapshotHash: string; // SHA-256 of canonicalized criteria payload
  payload: SearchCriteriaPayload;
  createdAt: string;
}

export interface EvaluationContext {
  contextFingerprint: string; // SHA-256 of canonical context tuple
  tenantId: string;
  personId: string;
  searchPlanSnapshotId: string;
  ontologyVersion: string;
  ontologyFingerprint: string; // From M2 compiled ontology
  policyVersion: string;
  profileVersion: string;
  createdAt: string;
}

export interface EvaluationIdentity {
  canonicalJobId: string;
  opportunityVersion: string;
  evaluationContextFingerprint: string;
  idempotencyKey: string; // SHA-256 of (canonicalJobId, opportunityVersion, evaluationContextFingerprint)
}

import type { EvaluationState } from "./canonical_acquisition";

export type EvaluationDecision = "PURSUE" | "CONSIDER" | "PASS";

export interface MaterializedEvaluation {
  id: string; // Equals evaluationIdentity.idempotencyKey
  tenantId: string;
  personId: string;
  canonicalJobId: string;
  opportunityVersion: string;
  evaluationContextFingerprint: string;
  /** Exact canonical intrinsic evaluationInputHash; never substituted from context. */
  evaluationFingerprint?: string | null;
  evaluationState: EvaluationState;
  decision: EvaluationDecision | null;
  qualityScore: number | null;
  rationale: string;
  evidenceIds: string[];
  evaluationJson: string; // Serialized representation
  materializedAt: string;
}

export interface FreshnessInput {
  currentSearchPlanSnapshotId: string;
  currentOntologyVersion: string;
  currentOntologyFingerprint: string;
  currentPolicyVersion: string;
  currentProfileVersion: string;
  currentOpportunityVersion: string;
}

export type FreshnessStatus = "FRESH" | "STALE" | "CONTEXT_MISMATCH";

export interface FreshnessResult {
  status: FreshnessStatus;
  isFresh: boolean;
  staleReason?: string;
  staleFields?: string[];
}
