// Layer 3 — Headspace Filter. Post-decision capacity adjustment.
//
// === BANDWIDTH CAPACITY CONTROL (COGNITIVE BANDWIDTH PROTECTION) ===
// This filter intercepts the priority pipeline decision. If the user's active
// pursuits exceed or meet their Monthly Capacity (defined in candidate-profile.json
// as headspaceCapacityPerMonth, default 5), the system triggers an "asymmetric downgrade".
// Under this rule, any job evaluated as 'PURSUE' is downgraded to 'CONSIDER'.
//
// This protects the candidate's focus and calendar from saturation while still
// highlighting highly aligned roles under 'CONSIDER' with an explanatory warning.
//
// Connections:
// - candidate.ts -> buildHeadspace()
// - pipeline.ts -> runPipeline() -> applyHeadspaceFilter()
// ===================================================================

import type { DecisionVerb } from "@/data/opportunity-fixtures";
import type { HeadspaceState } from "./candidate";

export type HeadspaceOutcome = Readonly<{
  finalVerb: DecisionVerb;
  downgraded: boolean;
  reason?: string;
}>;

export function applyHeadspaceFilter(
  verb: DecisionVerb,
  headspace: HeadspaceState,
): HeadspaceOutcome {
  if (headspace.saturated && verb === "PURSUE") {
    return {
      finalVerb: "CONSIDER",
      downgraded: true,
      reason: `You are at capacity (${headspace.activePursuits}/${headspace.capacityPerMonth} active pursuits). Priority remains high — reassess when a pursuit closes.`,
    };
  }
  return { finalVerb: verb, downgraded: false };
}