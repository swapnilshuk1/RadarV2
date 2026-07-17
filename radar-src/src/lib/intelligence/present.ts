// Layer 4 — Presenter. Consumes RecommendationRecord + source content
// (dimension evidence) and returns the Opportunity DTO the UI expects.
//
// The Presenter is the ONLY module aware of the UI shape. Swap this to swap
// the target renderer (email HTML, PDF, mobile) without touching the engine.

import type { Opportunity, OpportunitySource } from "@/data/opportunity-fixtures";
import type { RecommendationRecord } from "./record";
import { format, type Narrative } from "./narrative";

export type Presented = {
  opportunity: Opportunity;
  record: RecommendationRecord;
  narrative: Narrative;
};

/** Merge computed engine output onto the OpportunitySource. Source fields
 *  (dimension evidence) pass through verbatim; the engine's verb + narrative-generated
 *  prose lines (recommendation, positioning, etc.) are overlaid on top. */
export function present(
  source: OpportunitySource,
  record: RecommendationRecord,
): Presented {
  const narrative = format(record, source);

  return {
    opportunity: {
      ...source,
      decision: record.verb,
      recommendation: narrative.recommendation,
      whyNow: narrative.whyNow,
      positioning: narrative.positioning,
      primaryProof: narrative.primaryProof,
      headspaceInvestment: narrative.headspaceInvestment,
      headspace: narrative.headspace,
      hiringRisk: narrative.hiringRisk,
      alternativePath: narrative.alternativePath,
    },
    record,
    narrative,
  };
}