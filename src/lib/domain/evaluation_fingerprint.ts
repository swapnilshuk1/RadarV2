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

  const state = evaluation.evaluationState || (evaluation.decision ? "EVALUATED" : "UNKNOWN");

  // 1. Non-Evaluated States: decision and qualityScore MUST be null
  if (
    state === "SPARSE_SPEC" ||
    state === "ACQUISITION_PENDING" ||
    state === "ACQUISITION_FAILED" ||
    state === "EXPIRED" ||
    state === "NOT_EVALUABLE" ||
    state === "UNKNOWN"
  ) {
    if (evaluation.decision !== null && evaluation.decision !== undefined) {
      throw new Error(
        `MaterializedEvaluation invariant violation: relational decision must be null when evaluationState is '${state}', received '${evaluation.decision}'`
      );
    }
    if (evaluation.qualityScore !== null && evaluation.qualityScore !== undefined) {
      throw new Error(
        `MaterializedEvaluation invariant violation: relational qualityScore must be null when evaluationState is '${state}', received '${evaluation.qualityScore}'`
      );
    }
    // Consistent with non-evaluated state; internal JSON verdict traces are intentionally ignored
    return;
  }

  // 2. Evaluated State: decision MUST be {PURSUE, CONSIDER, PASS} and qualityScore MUST be a number
  if (state === "EVALUATED") {
    if (!evaluation.decision || !["PURSUE", "CONSIDER", "PASS"].includes(evaluation.decision)) {
      throw new Error(
        `MaterializedEvaluation invariant violation: relational decision must be PURSUE, CONSIDER, or PASS when evaluationState is 'EVALUATED', received '${evaluation.decision}'`
      );
    }
    if (
      evaluation.qualityScore === null ||
      evaluation.qualityScore === undefined ||
      typeof evaluation.qualityScore !== "number" ||
      !isFinite(evaluation.qualityScore) ||
      isNaN(evaluation.qualityScore) ||
      evaluation.qualityScore < 0 ||
      evaluation.qualityScore > 100
    ) {
      throw new Error(
        `MaterializedEvaluation invariant violation: relational qualityScore must be a valid number when evaluationState is 'EVALUATED', received '${evaluation.qualityScore}'`
      );
    }
    const evaluationFingerprint = parsed.evaluationInputHash;
    if (typeof evaluationFingerprint !== "string" || evaluationFingerprint.trim().length === 0) {
      throw new Error("MaterializedEvaluation invariant violation: EVALUATED payload must contain evaluationInputHash");
    }
    if (evaluation.evaluationFingerprint !== undefined && evaluation.evaluationFingerprint !== evaluationFingerprint) {
      throw new Error(
        `MaterializedEvaluation column mismatch: evaluationFingerprint '${evaluation.evaluationFingerprint}' does not match JSON evaluationInputHash '${evaluationFingerprint}'`
      );
    }

    // Validate decision consistency against payload
    const jsonDecision = parsed.decision || parsed.effective_decision || parsed.engine_verdict;
    if (jsonDecision && jsonDecision !== evaluation.decision) {
      throw new Error(
        `MaterializedEvaluation column mismatch: relational decision '${evaluation.decision}' does not match JSON payload decision '${jsonDecision}'`
      );
    }

    // Validate quality score consistency against payload
    const jsonScore = parsed.score ?? parsed.qualityScore ?? parsed.quality_score ?? parsed.engine_quality_score;
    if (jsonScore !== undefined && jsonScore !== null) {
      if (Math.abs(Number(jsonScore) - Number(evaluation.qualityScore)) > 0.001) {
        throw new Error(
          `MaterializedEvaluation column mismatch: relational qualityScore '${evaluation.qualityScore}' does not match JSON payload qualityScore '${jsonScore}'`
        );
      }
    }
    return;
  }

  throw new Error(`MaterializedEvaluation has unrecognized evaluationState: '${state}'`);
}
