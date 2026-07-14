// Layer 3 — canonical bundle. Every downstream module consumes one
// EvaluationContext.

import type { OpportunityIntelligence } from "./schema";
import type {
  CandidateIdentity,
  CareerPreferences,
  SearchStrategy,
} from "./candidate";
import type { MarketIntelligence } from "./market";
import { evidenceCompleteness } from "./completeness";

export type EvaluationContext = Readonly<{
  opportunity: OpportunityIntelligence;
  identity: CandidateIdentity;
  preferences: CareerPreferences;
  strategy: SearchStrategy;
  market: MarketIntelligence;
  completeness: number;
  confidence: number;
}>;

export function buildEvaluationContext(input: {
  opportunity: OpportunityIntelligence;
  identity: CandidateIdentity;
  preferences: CareerPreferences;
  strategy: SearchStrategy;
  market: MarketIntelligence;
}): EvaluationContext {
  const completeness = evidenceCompleteness(input.opportunity, input.market);
  return Object.freeze({
    ...input,
    completeness,
    confidence: completeness,
  });
}