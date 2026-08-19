/**
 * evaluation_fingerprint.ts
 *
 * Phase M3: Deterministic Fingerprinting & Identity Generators.
 *
 * Implements canonical serialization discipline established in M2 to prevent
 * raw string concatenation vulnerabilities or key order ambiguities.
 */

import {
  canonicalNormalize,
  computeDeterministicHash,
} from "@/lib/ontology/compiler/OntologyCompiler";
import type {
  SearchCriteriaPayload,
  EvaluationContext,
  EvaluationIdentity,
  MaterializedEvaluation,
} from "./evaluation_context";

/**
 * Computes the purely semantic SHA-256 snapshot hash for search plan criteria.
 * Independent of searchPlanId, tenantId, or timestamp.
 */
export function computeSearchPlanSnapshotHash(criteria: SearchCriteriaPayload): string {
  const normalized = canonicalNormalize(criteria);
  return computeDeterministicHash(normalized);
}

export interface EvaluationContextInput {
  tenantId: string;
  personId: string;
  searchPlanSnapshotId: string;
  ontologyVersion: string;
  ontologyFingerprint: string;
  policyVersion: string;
  profileVersion: string;
}

/**
 * Computes the immutable context fingerprint from the canonical context tuple.
 * Applies deterministic serialization to guarantee invariant:
 * Same inputs => Same contextFingerprint.
 */
export function computeEvaluationContextFingerprint(
  input: EvaluationContextInput
): string {
  const normalized = canonicalNormalize({
    tenantId: input.tenantId.trim(),
    personId: input.personId.trim(),
    searchPlanSnapshotId: input.searchPlanSnapshotId.trim(),
    ontologyVersion: input.ontologyVersion.trim(),
    ontologyFingerprint: input.ontologyFingerprint.trim(),
    policyVersion: input.policyVersion.trim(),
    profileVersion: input.profileVersion.trim(),
  });

  return computeDeterministicHash(normalized);
}

/**
 * Derives the first-class EvaluationIdentity and its deterministic idempotencyKey.
 */
export function computeEvaluationIdentity(
  canonicalJobId: string,
  opportunityVersion: string,
  evaluationContextFingerprint: string
): EvaluationIdentity {
  const normalized = canonicalNormalize({
    canonicalJobId: canonicalJobId.trim(),
    opportunityVersion: opportunityVersion.trim(),
    evaluationContextFingerprint: evaluationContextFingerprint.trim(),
  });

  const idempotencyKey = computeDeterministicHash(normalized);

  return {
    canonicalJobId: canonicalJobId.trim(),
    opportunityVersion: opportunityVersion.trim(),
    evaluationContextFingerprint: evaluationContextFingerprint.trim(),
    idempotencyKey,
  };
}

/**
 * Validates that relational columns in MaterializedEvaluation match the serialized evaluationJson
 * to prevent divergence between relational indices and payload data.
 */
export function validateEvaluationConsistency(evaluation: MaterializedEvaluation): void {
  if (!evaluation.evaluationJson) {
    throw new Error("MaterializedEvaluation must contain non-empty evaluationJson");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(evaluation.evaluationJson);
  } catch (err: any) {
    throw new Error(`MaterializedEvaluation evaluationJson is not valid JSON: ${err.message}`);
  }

  // Validate decision consistency
  const jsonDecision = parsed.decision || parsed.effective_decision || parsed.engine_verdict;
  if (jsonDecision && jsonDecision !== evaluation.decision) {
    throw new Error(
      `MaterializedEvaluation column mismatch: relational decision '${evaluation.decision}' does not match JSON payload decision '${jsonDecision}'`
    );
  }

  // Validate quality score consistency
  const jsonScore = parsed.qualityScore ?? parsed.quality_score ?? parsed.engine_quality_score;
  if (jsonScore !== undefined && Math.abs(Number(jsonScore) - evaluation.qualityScore) > 0.001) {
    throw new Error(
      `MaterializedEvaluation column mismatch: relational qualityScore '${evaluation.qualityScore}' does not match JSON payload qualityScore '${jsonScore}'`
    );
  }
}
