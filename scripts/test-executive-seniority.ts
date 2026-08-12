/**
 * scripts/test-executive-seniority.ts
 *
 * Runs the 13-scenario Executive Seniority & Contradiction Filter Test Harness.
 * Validates mandate classification, editorial distinctions, and Decision Engine policy vetoes.
 */

import { V3EvaluationEngine } from "../src/lib/intelligence/V3EvaluationEngine";
import type { CandidateProjection } from "../src/lib/domain/candidate";
import type { CandidateIntent } from "../src/lib/domain/intent";
import type { OpportunityIdentity } from "../src/lib/domain/opportunity";

const mockCandidate: CandidateProjection = {
  id: "cand_swapnil",
  name: "Swapnil Shukla",
  title: "VP Marketing / Performance CoE Lead",
  yearsOfExperience: 20,
  skills: ["cap_crm_strategy", "cap_growth_marketing", "CRM", "Performance Marketing", "Growth Strategy", "Digital Transformation", "Salesforce CDP"],
  claims: [
    { id: "c1", statement: "Managed an $8M Ford commercial portfolio", evidenceIds: ["ev1"] },
    { id: "c2", statement: "CRM migration across 13 markets", evidenceIds: ["ev2"] },
    { id: "c3", statement: "cap_crm_strategy", evidenceIds: ["ev3"] },
    { id: "c4", statement: "cap_growth_marketing", evidenceIds: ["ev4"] }
  ]
};

const mockIntent: CandidateIntent = {
  targetTitles: ["VP Marketing", "Chief Growth Officer", "CMO", "Head of Digital"],
  preferredLocations: ["Gurugram", "Delhi NCR", "Noida", "Bengaluru", "Mumbai"],
  salaryBand: { min: 15000000, currency: "INR" }, // 1.5 Cr floor
  workModelPreference: "HYBRID"
};

interface TestCase {
  id: number;
  title: string;
  description: string;
  salaryMax?: number;
  expectedVerb: "PURSUE" | "CONSIDER" | "PASS";
  expectedReason: string;
}

const testCases: TestCase[] = [
  {
    id: 1,
    title: "Head Digital Marketing",
    description: "Looking for 3-7 years exp. Hands-on campaign execution, social media, A/B testing, list import, form capture.",
    expectedVerb: "PASS",
    expectedReason: "Seniority contradiction (Head title + 3-7 yrs execution scope)"
  },
  {
    id: 2,
    title: "Digital Marketing Specialist",
    description: "Looking for 3-5 years exp in digital marketing, campaign execution, hubspot, A/B testing.",
    expectedVerb: "PASS",
    expectedReason: "Sub-tier mandate (Specialist IC title + 3-5 yrs exp)"
  },
  {
    id: 3,
    title: "Head Marketing",
    description: "Looking for 8-10 years exp. Mix of campaign execution and brand growth strategy.",
    expectedVerb: "CONSIDER",
    expectedReason: "Borderline mandate (8-10 yrs mixed scope)"
  },
  {
    id: 4,
    title: "VP Growth",
    description: "Looking for 8-10 years exp. Direct P&L responsibility, revenue ownership, EBITDA, enterprise growth.",
    expectedVerb: "PURSUE",
    expectedReason: "Qualified executive mandate (8-10 yrs + strong strategic scope)"
  },
  {
    id: 5,
    title: "VP Marketing",
    description: "12-15 years experience required. Enterprise transformation, global strategy, P&L ownership.",
    expectedVerb: "PURSUE",
    expectedReason: "Qualified executive mandate (12+ yrs experience)"
  },
  {
    id: 6,
    title: "CMO",
    description: "Direct report to CEO, Board of Directors interaction, global P&L responsibility, digital transformation.",
    expectedVerb: "PURSUE",
    expectedReason: "Verified CXO exception (Unstated experience + Board/P&L scope)"
  },
  {
    id: 7,
    title: "CMO",
    description: "3-5 years exp required. Hands-on social media, campaign execution, list import.",
    expectedVerb: "PASS",
    expectedReason: "Critical Seniority Contradiction (CMO title + 3-5 yrs execution scope)"
  },
  {
    id: 8,
    title: "VP Marketing",
    description: "12+ years exp required. Global P&L, strategic mandate.",
    salaryMax: 3000000, // 30L (below 1.5Cr target)
    expectedVerb: "PASS",
    expectedReason: "Disqualified by hard salary gate"
  },
  {
    id: 9,
    title: "Director Marketing",
    description: "15+ years exp required. Campaign execution and day-to-day lead generation operations.",
    expectedVerb: "CONSIDER",
    expectedReason: "Execution-heavy scope friction"
  },
  {
    id: 10,
    title: "Chief Growth Officer",
    description: "15+ years exp required. Enterprise transformation, global capability center, board reporting.",
    expectedVerb: "PURSUE",
    expectedReason: "Full golden executive mandate"
  },
  {
    id: 11,
    title: "VP Marketing",
    description: "Global strategic transformation, multi-market revenue ownership, board reporting.",
    expectedVerb: "PURSUE",
    expectedReason: "Unstated experience retains altitude for global strategic scope"
  },
  {
    id: 12,
    title: "VP Growth",
    description: "7 years exp required. Day-to-day campaign execution, A/B testing, paid media, form capture.",
    expectedVerb: "PASS",
    expectedReason: "Negative control: VP + 7 yrs execution ➔ PASS (Seniority Contradiction)"
  },
  {
    id: 13,
    title: "VP Growth",
    description: "7 years exp required. Direct report to CEO, Global P&L ownership, enterprise growth strategy.",
    expectedVerb: "CONSIDER",
    expectedReason: "Negative control: VP + 7 yrs + Global P&L ➔ CONSIDER (Borderline review)"
  }
];

function runSuite() {
  console.log("===============================================================================");
  console.log("  RADAR v2 - EXECUTIVE SENIORITY & CONTRADICTION FILTER TEST HARNESS (13/13)");
  console.log("===============================================================================\n");

  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    const opp: OpportunityIdentity = {
      id: `opp_${tc.id}`,
      canonicalTitle: tc.title,
      companyName: "Enterprise Co",
      description: tc.description,
      requiredCapabilities: ["cap_crm_strategy", "cap_growth_marketing"],
      location: "Gurugram, India",
      salaryBounds: tc.salaryMax ? { min: 2000000, max: tc.salaryMax, currency: "INR" } : undefined,
      postingWindow: "Recently"
    };

    const result = V3EvaluationEngine.evaluate(mockCandidate, mockIntent, opp);
    const verbMatches = result.recommendation.verb === tc.expectedVerb;

    if (verbMatches) {
      passed++;
      console.log(`[PASS] Case #${tc.id}: ${tc.title}`);
      console.log(`       Target: ${tc.expectedVerb} | Actual: ${result.recommendation.verb}`);
      console.log(`       Primary Concern / Rationale: ${result.recommendation.primaryConcern || result.recommendation.rationale}\n`);
    } else {
      failed++;
      console.log(`[FAIL] Case #${tc.id}: ${tc.title}`);
      console.log(`       Expected: ${tc.expectedVerb} | Got: ${result.recommendation.verb}`);
      console.log(`       Rationale: ${result.recommendation.rationale}\n`);
    }
  }

  console.log("-------------------------------------------------------------------------------");
  console.log(`RESULTS: ${passed}/${testCases.length} Passed (${failed} Failed)`);
  console.log("-------------------------------------------------------------------------------\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite();
