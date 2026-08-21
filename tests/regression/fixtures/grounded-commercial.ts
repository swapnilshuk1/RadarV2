/**
 * P0 Fixture: Grounded Commercial
 * 
 * Purpose: Fully-specified JD with explicit, grounded evidence.
 * All quotes present in rawText.
 * Provenance: trusted (curated, extractor, gold, fixture, onboarder)
 * Expected: EVALUATED (not SPARSE_SPEC), priority !== null
 * Verdict: PURSUE (high fit)
 */

import type { OpportunitySource } from "@/data/opportunity-fixtures";

const RAW_TEXT = `
Chief Marketing Officer - BMW India

BMW India is seeking a Chief Marketing Officer to lead our digital transformation 
initiative across 22 dealers. This role reports directly to the Managing Director 
and Board with P&L responsibility of ₹1.5 Cr+.

Key responsibilities:
- Own the India marketing P&L (₹1.5 Cr+ scale)
- Lead Salesforce CRM transformation across 13 markets
- Deliver 24-month revenue targets
- Establish operational governance

Requirements:
- Board-ready executive with transformation track record
- Experience with Salesforce CDP and lifecycle marketing
- Gurugram-based hybrid working
`;

export const GROUNDED_COMMERCIAL = {
  source: {
    jobHash: "p0-grounded-commercial-001",
    role: "Chief Marketing Officer",
    company: "BMW India",
    location: "Gurugram · India",
    postedRelative: "Posted 2 days ago",
    scrapedFrom: "LinkedIn" as const,
    originalOpportunity: {
      sourcePayload: RAW_TEXT
    },
    rawText: RAW_TEXT,
    dimensions: [
      {
        key: "requiredLevel",
        jdEvidence: {
          status: "Explicit",
          value: "Chief Marketing Officer",
          evidence: [{ 
            quote: "Chief Marketing Officer", 
            provenance: "title"  // Trusted: title extractor
          }]
        }
      },
      {
        key: "reportingLine",
        jdEvidence: {
          status: "Explicit",
          value: "Managing Director + Board",
          evidence: [{ 
            quote: "reports directly to the Managing Director and Board", 
            provenance: "extractor"  // Trusted: structured extractor
          }]
        }
      },
      {
        key: "commercialAccountability",
        jdEvidence: {
          status: "Explicit",
          value: "₹1.5 Cr+ P&L",
          evidence: [{ 
            quote: "Own the India marketing P&L (₹1.5 Cr+ scale)", 
            provenance: "curated"  // Trusted: curated evidence
          }]
        }
      },
      {
        key: "mandate",
        jdEvidence: {
          status: "Explicit",
          value: "Transformation",
          evidence: [{ 
            quote: "lead our digital transformation initiative", 
            provenance: "gold"  // Trusted: gold link
          }]
        }
      }
    ],
    primaryConcern: null
  } as OpportunitySource,

  expected: {
    evaluationStatus: "EVALUATED",
    // Should NOT be SPARSE_SPEC
    isSparseSpec: false,
    verdict: "PURSUE",
    priority: { min: 70, max: 100 },  // Above PURSUE threshold
    vetoed: false,
    vetoReason: null,
    // Full pipeline evaluation
    pipelineStages: ["EvidenceGate", "Identity", "Capability", "Career", "Lifestyle", "Ranking"],
    hasCareerValueBreakdown: true,
    hasEvidenceMapping: true
  }
};

export function createGroundedCommercial(): typeof GROUNDED_COMMERCIAL.source {
  return JSON.parse(JSON.stringify(GROUNDED_COMMERCIAL.source));
}
