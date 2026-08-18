/**
 * P0 Fixture: Sparse Commercial
 * 
 * Purpose: Minimal JD for a commercial role that should trigger SPARSE_SPEC.
 * Word count: <25 words
 * Role: Commercial (CMO track)
 * Expected: SPARSE_SPEC, vetoed=false, priority=null
 */

import type { OpportunitySource } from "@/data/opportunity-fixtures";

export const SPARSE_COMMERCIAL = {
  source: {
    jobHash: "p0-sparse-commercial-001",
    role: "Chief Marketing Officer",
    company: "Acme Growth Co",
    location: "Remote · India",
    postedRelative: "Posted recently",
    scrapedFrom: "LinkedIn" as const,
    originalOpportunity: {
      sourcePayload: "CMO needed for fast-growing SaaS. Hybrid. Apply now."
    },
    // 9 words - well below 25-word threshold
    rawText: "CMO needed for fast-growing SaaS. Hybrid. Apply now.",
    // NO structured evidence - this is genuinely ungrounded sparse input
    dimensions: [],
    primaryConcern: null
  } as OpportunitySource,

  expected: {
    evaluationStatus: "SPARSE_SPEC",
    vetoed: false,
    vetoReason: null,
    priority: null,
    recommendation: null,
    // Pipeline should contain ONLY EvidenceGate
    pipelineLength: 1,
    pipelineFirstStage: "EvidenceGate",
    // No downstream artifacts
    hasCareerValueBreakdown: false,
    hasEvidenceMapping: false
  }
};

/**
 * Factory function returns deep copy to prevent test cross-contamination
 */
export function createSparseCommercial(): typeof SPARSE_COMMERCIAL.source {
  return JSON.parse(JSON.stringify(SPARSE_COMMERCIAL.source));
}
