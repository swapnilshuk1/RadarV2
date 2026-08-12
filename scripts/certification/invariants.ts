import type { RecommendationRecord } from "../../src/lib/intelligence/record";
import type { Presented } from "../../src/lib/intelligence/present";

export interface InvariantFailure {
  contract: "A" | "C" | "E";
  id: string;
  rule: string;
  message: string;
}

/** Contract A — Evidence Invariants */
export function evaluateContractA(record: RecommendationRecord, presented?: Presented): InvariantFailure[] {
  const failures: InvariantFailure[] = [];

  if (record.verb === "SPARSE_SPEC") {
    if (record.priority !== null) {
      failures.push({
        contract: "A",
        id: record.jobHash,
        rule: "SparseNullScore",
        message: `SPARSE_SPEC must have priorityScore === null, got ${record.priority}`
      });
    }
    if (record.vetoed !== true) {
      failures.push({
        contract: "A",
        id: record.jobHash,
        rule: "SparseVetoFlag",
        message: `SPARSE_SPEC must have vetoed === true`
      });
    }
  }

  return failures;
}

/** Contract C — Policy Invariants */
export function evaluateContractC(record: RecommendationRecord): InvariantFailure[] {
  const failures: InvariantFailure[] = [];

  // Veto Invariant
  if (record.vetoed === true) {
    if (record.verb !== "PASS" && record.verb !== "SPARSE_SPEC" && record.verb !== "NOT_EVALUABLE") {
      failures.push({
        contract: "C",
        id: record.jobHash,
        rule: "VetoVerbPass",
        message: `Vetoed record must have verb PASS/SPARSE_SPEC/NOT_EVALUABLE, got ${record.verb}`
      });
    }
    if (record.priority !== 0 && record.priority !== null) {
      failures.push({
        contract: "C",
        id: record.jobHash,
        rule: "VetoZeroScore",
        message: `Vetoed record must have priorityScore === 0 or null, got ${record.priority}`
      });
    }
  } else {
    // Non-vetoed invariant
    if (record.priority !== record.rawScore && record.verb !== "PASS" && record.verb !== "SPARSE_SPEC" && record.verb !== "NOT_EVALUABLE") {
      failures.push({
        contract: "C",
        id: record.jobHash,
        rule: "NonVetoScoreEquality",
        message: `Non-vetoed record priorityScore (${record.priority}) must equal rawScore (${record.rawScore})`
      });
    }
  }

  return failures;
}

/** Contract E — UI ViewModel Invariants */
export function evaluateContractE(presented: Presented): InvariantFailure[] {
  const failures: InvariantFailure[] = [];
  const opp = presented.opportunity;

  if (presented.record.verb === "SPARSE_SPEC") {
    const recText = (opp.recommendation || "").toLowerCase();
    if (recText.includes("pursue") || recText.includes("consider")) {
      failures.push({
        contract: "E",
        id: presented.record.jobHash,
        rule: "SparseNoDecisionText",
        message: `SPARSE_SPEC presented view model contains misleading decision text: ${opp.recommendation}`
      });
    }
  }

  if (presented.record.verb === "PASS") {
    if (presented.record.priority !== 0 && presented.record.priority !== null) {
      failures.push({
        contract: "E",
        id: presented.record.jobHash,
        rule: "PassNoAttractiveScore",
        message: `PASS presented view model displays misleading non-zero priority score: ${presented.record.priority}`
      });
    }
  }

  return failures;
}
