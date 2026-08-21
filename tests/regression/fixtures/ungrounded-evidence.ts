/**
 * P0 Fixture: Ungrounded Evidence
 * 
 * Purpose: Structured evidence where quote is NOT in rawText and provenance is NOT trusted.
 * The evidence claim "Owns P&L" appears nowhere in source JD.
 * Expected: NOT treated as hasStructuredEvidence (regression from provenance fallback)
 */

import type { OpportunitySource } from "@/data/opportunity-fixtures";

export const UNGROUNDED_EVIDENCE = {
  source: {
    jobHash: "p0-ungrounded-001",
    role: "Marketing Director",
    company: "TestCorp",
    location: "Mumbai · India",
    postedRelative: "Posted recently",
    scrapedFrom: "LinkedIn" as const,
    originalOpportunity: {
      sourcePayload: "Marketing director needed. Growth focus. Apply."
    },
    // Raw text does NOT contain "Owns P&L"
    rawText: "Marketing director needed. Growth focus. Apply.",
    dimensions: [
      {
        key: "commercialAccountability",
        jdEvidence: {
          status: "Explicit",
          value: "Owns P&L",
          // Evidence quote is fabricated/not in source
          evidence: [{
            quote: "Owns P&L",
            provenance: "llm"  // NOT in trusted list
          }]
        }
      }
    ],
    primaryConcern: null
  } as OpportunitySource,

  expected: {
    // With P0-A fix (remove !ev.provenance fallback):
    // This evidence should NOT be treated as structured evidence
    hasStructuredEvidence: false,
    // Result may be SPARSE_SPEC or lower-confidence evaluation
    confidencePenalty: 0.15,  // Less than typical due to ungrounded evidence
    // The ungrounded claim should NOT contribute to allowedClaims
    pnlScaleClaimed: false
  }
};

export function createUngroundedEvidence(): typeof UNGROUNDED_EVIDENCE.source {
  return JSON.parse(JSON.stringify(UNGROUNDED_EVIDENCE.source));
}
