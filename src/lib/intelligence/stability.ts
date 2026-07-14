// Layer 3 — Stability Engine. Computed AFTER Priority. Distinct from
// confidence: stability answers "how likely is the verb to change if new
// evidence arrives?", not "how complete is the evidence today?".

import type { DecisionVerb } from "@/data/opportunity-fixtures";
import type { PriorityResult } from "./priority";
import { marginToBand } from "./decision";

export type Stability = "High" | "Medium" | "Low";

export function computeStability(input: {
  priority: number;
  verb: DecisionVerb;
  factors: PriorityResult["factors"];
  completeness: number;
  dominantFactor: PriorityResult["dominantFactor"];
}): Stability {
  const margin = Math.abs(marginToBand(input.priority, input.verb));
  // A record whose verb sits at the edge of a band is inherently fragile.
  let score = margin * 4; // 0.05 margin → 0.2, 0.25 margin → 1.0
  // Missing evidence increases sensitivity to new data.
  score *= 0.5 + 0.5 * input.completeness;
  // Reporting-line / mandate dominance is more fragile than career value.
  if (input.dominantFactor === "shortlistingPotential") score *= 0.9;
  if (score >= 0.7) return "High";
  if (score >= 0.35) return "Medium";
  return "Low";
}