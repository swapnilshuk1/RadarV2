// Layer 3 — Decision Trace. Auto-generated per record for QA, regression,
// and future debugging. The UI does not need it; tests will.

import type { DecisionVerb } from "@/data/opportunity-fixtures";
import type { PriorityResult } from "./priority";
import type { Stability } from "./stability";
import type { HeadspaceOutcome } from "./headspace-filter";

export type DecisionTrace = Readonly<{
  priority: number;
  factors: PriorityResult["factors"];
  verb0: DecisionVerb;        // before headspace
  finalVerb: DecisionVerb;
  confidence: number;
  stability: Stability;
  headspace: HeadspaceOutcome;
  missing: string[];
  timestamp: string;
}>;

export function buildTrace(input: {
  priority: PriorityResult;
  verb0: DecisionVerb;
  finalVerb: DecisionVerb;
  confidence: number;
  stability: Stability;
  headspace: HeadspaceOutcome;
  missing: string[];
}): DecisionTrace {
  return Object.freeze({
    priority: input.priority.priority,
    factors: input.priority.factors,
    verb0: input.verb0,
    finalVerb: input.finalVerb,
    confidence: input.confidence,
    stability: input.stability,
    headspace: input.headspace,
    missing: input.missing,
    timestamp: new Date(0).toISOString(), // stable for tests; overwrite in runtime if needed
  });
}