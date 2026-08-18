/**
 * P0 Fixture: Sparse Non-Commercial
 * 
 * Purpose: Minimal JD for engineering role should be excluded (PASS) not SPARSE_SPEC.
 * Word count: <25 words
 * Role: Non-commercial (Software Engineer)
 * Expected: Non-commercial detection → PASS (not SPARSE_SPEC)
 */

import type { OpportunitySource } from "@/data/opportunity-fixtures";

export const SPARSE_NONCOMMERCIAL = {
  source: {
    jobHash: "p0-sparse-noncommercial-001",
    role: "Senior Software Engineer",
    company: "TechCorp India",
    location: "Bengaluru · India",
    postedRelative: "Posted recently",
    scrapedFrom: "LinkedIn" as const,
    originalOpportunity: {
      sourcePayload: "Senior software engineer. Java, Spring. Full-time."
    },
    // 6 words
    rawText: "Senior software engineer. Java, Spring. Full-time.",
    dimensions: [],
    primaryConcern: null
  } as OpportunitySource,

  expected: {
    // Non-commercial sparse roles should PASS, not SPARSE_SPEC
    evaluationStatus: "EVALUATED" | "PASS",
    verdict: "PASS",
    vetoed: false,
    priority: 0,
    // Non-commercial keywords detected
    nonCommercialDetected: true
  }
};

export function createSparseNoncommercial(): typeof SPARSE_NONCOMMERCIAL.source {
  return JSON.parse(JSON.stringify(SPARSE_NONCOMMERCIAL.source));
}
