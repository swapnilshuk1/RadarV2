// Layer 3 — Hard gates. Never scored. If any gate trips, the record is
// filtered before Priority runs.

import { dim, type OpportunityIntelligence } from "./schema";
import type { CareerPreferences, SearchStrategy } from "./candidate";

export type EligibilityResult = {
  eligible: boolean;
  blockers: string[];
};

export function checkEligibility(
  oi: OpportunityIntelligence,
  _prefs: CareerPreferences,
  strategy: SearchStrategy,
): EligibilityResult {
  const blockers: string[] = [];
  const level = dim(oi, "requiredLevel");
  if (level && level.bucket === "Contradicted" && strategy.trajectory === "cxo") {
    blockers.push("requiredLevel");
  }
  return { eligible: blockers.length === 0, blockers };
}