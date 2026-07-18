// Layer 3 — Headspace Filter. Post-decision capacity adjustment.
// If the candidate is saturated, PURSUE gets downgraded to CONSIDER with
// an explicit reason — the Presenter surfaces this to the user.

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