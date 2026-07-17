// Layer 3 metadata — Evidence Completeness → confidence ∈ [0,1].
// Confidence is metadata about intelligence, never an input to Decision.

import { CANONICAL_DIMENSIONS, type OpportunityIntelligence, dim } from "./schema";
import type { MarketIntelligence } from "./market";

export function evidenceCompleteness(
  oi: OpportunityIntelligence,
  market: MarketIntelligence,
): number {
  const total = CANONICAL_DIMENSIONS.length + 1;
  let present = 0;
  for (const key of CANONICAL_DIMENSIONS) {
    const d = dim(oi, key);
    if (!d) continue;
    if (d.jdEvidence.status === "Explicit") present += 1;
    else if (d.jdEvidence.status === "Inferred") present += 0.6;
  }
  if (market.status === "ready") present += 1;
  else if (market.status === "pending") present += 0.3;
  return Math.max(0, Math.min(1, present / total));
}