// Layer 3 — Decision Engine. Priority alone → verb.
// Confidence is NOT consulted here. A high-priority / low-confidence record
// still yields PURSUE — the Narrative Formatter phrases the uncertainty.

import type { DecisionVerb } from "@/data/opportunity-fixtures";

export const BANDS = { PURSUE: 0.55, CONSIDER: 0.3 } as const;

export function decide(priority: number): DecisionVerb {
  if (priority >= BANDS.PURSUE) return "PURSUE";
  if (priority >= BANDS.CONSIDER) return "CONSIDER";
  return "PASS";
}

export function marginToBand(priority: number, verb: DecisionVerb): number {
  if (verb === "PURSUE") return priority - BANDS.PURSUE;
  if (verb === "CONSIDER") {
    return Math.min(BANDS.PURSUE - priority, priority - BANDS.CONSIDER);
  }
  return BANDS.CONSIDER - priority;
}