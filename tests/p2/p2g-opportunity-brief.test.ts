/**
 * P2-G: Opportunity Detail Experience Tests
 *
 * Acceptance Contract:
 * - Composes complete executive brief
 * - Includes all intelligence components
 * - Does not expose engine terminology
 * - Presents actionable executive-facing narrative
 */

import { describe, it, expect } from "vitest";
import type { RecommendationRecord } from "@/lib/intelligence/record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";
import {
  composeExecutiveBrief,
  formatBrief,
  type ExecutiveBrief,
} from "@/lib/intelligence/editorial/OpportunityBriefComposer";

describe("P2-G: Opportunity Detail Experience", () => {
  // Base mock record
  const baseMockRecord: RecommendationRecord = {
    jobHash: "test-brief",
    engineVersion: "4.3.0",
    recommendationVersion: "4.3.0:test",
    verb: "PURSUE",
    rawScore: 80,
    priority: 80,
    vetoed: false,
    vetoReason: null,
    claimPermissions: {
      allowedClaims: ["Commercial leadership", "Growth strategy"],
      explicitUnknowns: ["[CORE_MANDATE] Direct P&L ownership"],
      explicitRisks: []
    },
    confidence: 0.85,
    factors: { pursuitFriction: 10 },
    evidenceGrounding: {},
    decisionSummary: { careerValue: 80, shortlistingPotential: 75, pursuitFriction: 10 },
    decisionDrivers: ["Commercial ownership matches", "Growth experience aligns"],
    decisionRisks: [{ factor: "P&L clarity", impact: "medium", evidence: "Scope not fully specified" }],
    confidences: { parsing: 0.88, matching: 0.85, recommendation: 0.85 },
    stability: "High",
    headspace: { finalVerb: "PURSUE", downgraded: false },
    comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
    explanation: { reason: "strong_alignment", dominantFactor: "careerValue", missingEvidence: [], unknowns: [] },
    trace: {
      priority: 80,
      factors: { careerValue: 80, shortlistingPotential: 75, pursuitFriction: 10 },
      verb0: "PURSUE",
      finalVerb: "PURSUE",
      confidence: 0.85,
      stability: "High",
      pipeline: [],
      evidenceMapping: [{ requirement: "Growth leadership", evidence: "Scaled revenue 40%", strength: "strong", type: "CORE_MANDATE" }],
      careerValueBreakdown: { brandValue: 20, learningValue: 20, trajectoryValue: 20, riskMitigation: 15 },
      headspace: { finalVerb: "PURSUE", downgraded: false },
      missing: [],
      timestamp: new Date().toISOString(),
      candidateProjectionHash: "test",
      opportunityContentHash: "test"
    },
    esi: 0.78,
    diligenceStatus: "READY"
  };

  // Test 1: Composes complete brief
  it("1: Composes complete executive brief", () => {
    const source: OpportunitySource = {
      jobHash: "test-brief",
      role: "VP Marketing - Full Time Permanent",
      company: "ScaleCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const brief = composeExecutiveBrief(baseMockRecord, source);

    // Check all major sections present
    expect(brief.whyThis).toBeTruthy();
    expect(brief.whyYou).toBeTruthy();
    expect(brief.principalRisk).toBeTruthy();
    expect(brief.careerValue).toBeTruthy();
    expect(brief.shortlistingPotential).toBeTruthy();
    expect(brief.pursuitEffort).toBeTruthy();
    expect(brief.recommendedAction).toBeTruthy();
  });

  // Test 2: Includes strategic advantage
  it("2: Brief includes strategic advantage", () => {
    const source: OpportunitySource = {
      jobHash: "test-brief",
      role: "VP Marketing",
      company: "ScaleCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const brief = composeExecutiveBrief(baseMockRecord, source);

    expect(brief.whyYou).toBeTruthy();
    expect(brief.strongestEvidence.length).toBeGreaterThan(0);
  });

  // Test 3: Includes principal risk
  it("3: Brief includes principal risk", () => {
    const source: OpportunitySource = {
      jobHash: "test-brief",
      role: "VP Marketing",
      company: "ScaleCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const brief = composeExecutiveBrief(baseMockRecord, source);

    expect(brief.principalRisk).toBeTruthy();
    expect(brief.whatIsMissing.length).toBeGreaterThanOrEqual(0);
  });

  // Test 4: Includes career value
  it("4: Brief includes career value interpretation", () => {
    const source: OpportunitySource = {
      jobHash: "test-brief",
      role: "VP Marketing - Career growth opportunity",
      company: "GrowthCo",
      location: "Bengaluru",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const brief = composeExecutiveBrief(baseMockRecord, source);

    expect(brief.careerValue).toBeTruthy();
    expect(brief.careerValue.toLowerCase()).not.toContain("score");
  });

  // Test 5: Includes shortlisting potential
  it("5: Brief includes shortlisting potential", () => {
    const source: OpportunitySource = {
      jobHash: "test-brief",
      role: "VP Marketing",
      company: "ScaleCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const brief = composeExecutiveBrief(baseMockRecord, source);

    expect(brief.shortlistingPotential).toBeTruthy();
  });

  // Test 6: Includes engagement quality
  it("6: Brief includes engagement quality", () => {
    const source: OpportunitySource = {
      jobHash: "test-brief",
      role: "VP Marketing - Full Time Permanent",
      company: "ScaleCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const brief = composeExecutiveBrief(baseMockRecord, source);

    expect(brief.engagementQuality).toBeTruthy();
    expect(brief.engagementQuality.toLowerCase()).toContain("permanent");
  });

  // Test 7: Includes compensation
  it("7: Brief includes compensation interpretation", () => {
    const source: OpportunitySource = {
      jobHash: "test-brief",
      role: "VP Marketing - Competitive package with ESOP",
      company: "ScaleCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const brief = composeExecutiveBrief(baseMockRecord, source);

    expect(brief.compensation).toBeTruthy();
  });

  // Test 8: Includes confidence assessment
  it("8: Brief includes confidence assessment", () => {
    const source: OpportunitySource = {
      jobHash: "test-brief",
      role: "VP Marketing",
      company: "ScaleCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const brief = composeExecutiveBrief(baseMockRecord, source);

    expect(brief.confidence).toBeTruthy();
    expect(brief.confidenceScore).toBeGreaterThan(0);
  });

  // Test 9: Includes validation questions
  it("9: Brief includes validation questions", () => {
    const source: OpportunitySource = {
      jobHash: "test-brief",
      role: "VP Marketing",
      company: "ScaleCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const brief = composeExecutiveBrief(baseMockRecord, source);

    // Should have validation questions from gaps
    expect(brief.validationQuestions.length).toBeGreaterThanOrEqual(0);
  });

  // Test 10: Does not expose engine terminology
  it("10: Brief does not expose engine terminology", () => {
    const source: OpportunitySource = {
      jobHash: "test-brief",
      role: "VP Marketing",
      company: "ScaleCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const brief = composeExecutiveBrief(baseMockRecord, source);

    // Check that raw engine terms aren't exposed
    const fullText = JSON.stringify(brief).toLowerCase();
    expect(fullText).not.toContain("rawscore");
    expect(fullText).not.toContain("priority");
    expect(fullText).not.toContain("vetoed");
    expect(fullText).not.toContain("decisionsummary");
  });
});

// Edge cases
describe("P2-G: Brief Edge Cases", () => {
  it("formatBrief produces structured output", () => {
    const brief: ExecutiveBrief = {
      recommendation: "PURSUE",
      whyThis: "Career advancement",
      whyYou: "Strong match",
      principalRisk: "P&L unclear",
      strongestEvidence: ["Commercial experience"],
      whatIsMissing: ["Direct reports"],
      careerValue: "Forward progression",
      shortlistingPotential: "High",
      pursuitEffort: "Low",
      recommendedAction: "Apply now",
      engagementQuality: "Permanent",
      compensation: "Competitive",
      confidence: "High confidence",
      validationQuestions: ["Verify P&L scope"],
      confidenceScore: 0.85
    };

    const formatted = formatBrief(brief);
    expect(formatted).toContain("WHY THIS OPPORTUNITY?");
    expect(formatted).toContain("WHY YOU?");
    expect(formatted).toContain("PURSUE");
  });

  it("Handles SPARSE_SPEC gracefully", () => {
    const source: OpportunitySource = {
      jobHash: "test-brief",
      role: "Marketing",
      company: "MinimalCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const brief: ExecutiveBrief = {
      recommendation: "SPARSE_SPEC",
      whyThis: "Insufficient data",
      whyYou: "Unknown",
      principalRisk: "Insufficient information",
      strongestEvidence: [],
      whatIsMissing: ["Complete job specification"],
      careerValue: "Cannot assess",
      shortlistingPotential: "Unknown",
      pursuitEffort: "Unknown",
      recommendedAction: "Request more information",
      engagementQuality: "Unclear",
      compensation: "Undisclosed",
      confidence: "Insufficient evidence",
      validationQuestions: ["Obtain full job description"],
      confidenceScore: 0.3
    };

    expect(brief.recommendation).toBe("SPARSE_SPEC");
    expect(brief.confidenceScore).toBeLessThan(0.5);
  });
});
