/**
 * evaluation_freshness.ts
 *
 * Phase M3: Freshness Evaluator.
 *
 * Evaluates whether a materialized evaluation remains fresh or has become stale
 * due to upstream mutations in:
 * - SearchPlan snapshot
 * - Candidate profile version
 * - Compiled ontology fingerprint
 * - Canonical ontology version
 * - Decision policy version
 * - Opportunity evidence version
 */

import type {
  EvaluationContext,
  MaterializedEvaluation,
  FreshnessInput,
  FreshnessResult,
} from "./evaluation_context";

/**
 * Checks whether an existing MaterializedEvaluation remains fresh given current live state.
 */
export function isEvaluationFresh(
  evaluation: MaterializedEvaluation,
  context: EvaluationContext,
  current: FreshnessInput
): FreshnessResult {
  const staleFields: string[] = [];

  // Check opportunity evidence version freshness
  if (evaluation.opportunityVersion !== current.currentOpportunityVersion) {
    staleFields.push("opportunityVersion");
  }

  // Check search plan snapshot freshness
  if (context.searchPlanSnapshotId !== current.currentSearchPlanSnapshotId) {
    staleFields.push("searchPlanSnapshotId");
  }

  // Check ontology fingerprint freshness (compiled custom ontology)
  if (context.ontologyFingerprint !== current.currentOntologyFingerprint) {
    staleFields.push("ontologyFingerprint");
  }

  // Check canonical ontology version freshness
  if (context.ontologyVersion !== current.currentOntologyVersion) {
    staleFields.push("ontologyVersion");
  }

  // Check decision policy version freshness
  if (context.policyVersion !== current.currentPolicyVersion) {
    staleFields.push("policyVersion");
  }

  // Check candidate profile version freshness
  if (context.profileVersion !== current.currentProfileVersion) {
    staleFields.push("profileVersion");
  }

  if (staleFields.length > 0) {
    return {
      status: "STALE",
      isFresh: false,
      staleReason: `Evaluation is stale due to updated inputs: [${staleFields.join(", ")}]`,
      staleFields,
    };
  }

  return {
    status: "FRESH",
    isFresh: true,
  };
}
