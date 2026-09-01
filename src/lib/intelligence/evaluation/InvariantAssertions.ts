/**
 * InvariantAssertions.ts
 *
 * CANONICAL SHARED INVARIANT ASSERTIONS LIBRARY.
 * Imported by both Vitest test suites and the Certification harness.
 */

import { RecommendationRecord } from "../record";
import { JobProjection } from "../../domain/job_projection";
import { CandidateProjection } from "../../domain/candidate_projection";

export interface InvariantValidationResult {
  passed: boolean;
  ruleName: string;
  error?: string;
}

export class InvariantAssertions {
  /**
   * Rule 1: Execution Gate & Non-Contradiction Integrity
   */
  public static verifyExecutionGate(record: RecommendationRecord): InvariantValidationResult {
    const rec = record as unknown as { gates?: { executionGate?: { passed?: unknown; reason?: unknown } } };
    const gate = rec.gates?.executionGate;
    if (!gate) {
      return { passed: false, ruleName: "ExecutionGate", error: "Missing executionGate in recommendation record" };
    }
    if (typeof gate.passed !== "boolean") {
      return { passed: false, ruleName: "ExecutionGate", error: "executionGate.passed must be a boolean" };
    }
    if (gate.passed && typeof gate.reason === "string" && gate.reason.includes("CONTRADICTION")) {
      return { passed: false, ruleName: "ExecutionGate", error: "ExecutionGate marked passed despite contradiction" };
    }
    return { passed: true, ruleName: "ExecutionGate" };
  }

  /**
   * Rule 2: Compatibility Gate Integrity (Seniority, Location, WorkModel)
   */
  public static verifyCompatibilityGate(record: RecommendationRecord): InvariantValidationResult {
    const rec = record as unknown as { gates?: { compatibilityGate?: { passed?: unknown } } };
    const gate = rec.gates?.compatibilityGate;
    if (!gate) {
      return { passed: false, ruleName: "CompatibilityGate", error: "Missing compatibilityGate in recommendation record" };
    }
    if (typeof gate.passed !== "boolean") {
      return { passed: false, ruleName: "CompatibilityGate", error: "compatibilityGate.passed must be a boolean" };
    }
    return { passed: true, ruleName: "CompatibilityGate" };
  }

  /**
   * Rule 3: Decision Boundary & Verb Consistency
   */
  public static verifyDecisionBoundaries(record: RecommendationRecord): InvariantValidationResult {
    const validVerbs = ["PURSUE", "CONSIDER", "PASS", "SPARSE_SPEC", "DEFERRED_EVALUATION"];
    if (!validVerbs.includes(record.verb)) {
      return { passed: false, ruleName: "DecisionBoundaries", error: `Invalid recommendation verb: ${record.verb}` };
    }
    const declaredOverallScore = (record as unknown as { overallScore?: unknown }).overallScore;
    const score = typeof declaredOverallScore === "number"
      ? declaredOverallScore
      : typeof record.qualityScore === "number"
        ? record.qualityScore / 100
        : 0;
    if (record.verb === "PURSUE" && score < 0.50) {
      return { passed: false, ruleName: "DecisionBoundaries", error: `PURSUE awarded with overall score < 0.50 (${score})` };
    }
    return { passed: true, ruleName: "DecisionBoundaries" };
  }

  /**
   * Rule 4: Editorial Narrative Presence
   */
  public static verifyEditorialPresence(record: RecommendationRecord): InvariantValidationResult {
    if (record.verb === "SPARSE_SPEC" || record.verb === "NOT_EVALUABLE") {
      return { passed: true, ruleName: "EditorialPresence" };
    }
    const rec = record as unknown as { editorial?: unknown; presentation?: unknown };
    if (!rec.editorial && !rec.presentation) {
      return { passed: false, ruleName: "EditorialPresence", error: "Missing editorial or presentation payload for evaluated recommendation record" };
    }
    return { passed: true, ruleName: "EditorialPresence" };
  }

  /**
   * Verify all core invariants for a given recommendation record.
   */
  public static verifyAll(record: RecommendationRecord): InvariantValidationResult[] {
    return [
      this.verifyExecutionGate(record),
      this.verifyCompatibilityGate(record),
      this.verifyDecisionBoundaries(record),
      this.verifyEditorialPresence(record)
    ];
  }
}
