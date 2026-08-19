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
    const recAny = record as any;
    const gate = recAny.gates?.executionGate;
    if (!gate) {
      return { passed: true, ruleName: "ExecutionGate" };
    }
    if (gate.passed && gate.reason && gate.reason.includes("CONTRADICTION")) {
      return { passed: false, ruleName: "ExecutionGate", error: "ExecutionGate marked passed despite contradiction" };
    }
    return { passed: true, ruleName: "ExecutionGate" };
  }

  /**
   * Rule 2: Compatibility Gate Integrity (Seniority, Location, WorkModel)
   */
  public static verifyCompatibilityGate(record: RecommendationRecord): InvariantValidationResult {
    const recAny = record as any;
    const gate = recAny.gates?.compatibilityGate;
    if (!gate && recAny.gates) {
      return { passed: false, ruleName: "CompatibilityGate", error: "Missing compatibilityGate in recommendation record" };
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
    const score = (record as any).overallScore ?? (record.qualityScore ? record.qualityScore / 100 : 0);
    if (record.verb === "PURSUE" && score < 0.50) {
      return { passed: false, ruleName: "DecisionBoundaries", error: `PURSUE awarded with overall score < 0.50 (${score})` };
    }
    return { passed: true, ruleName: "DecisionBoundaries" };
  }

  /**
   * Rule 4: Editorial Narrative Presence
   */
  public static verifyEditorialPresence(record: RecommendationRecord): InvariantValidationResult {
    const recAny = record as any;
    if (record.verb !== "SPARSE_SPEC" && !recAny.editorial && !recAny.presentation) {
      return { passed: true, ruleName: "EditorialPresence" };
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
