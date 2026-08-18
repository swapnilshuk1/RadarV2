/**
 * P2-D: Engagement Quality Tests
 *
 * Acceptance Contract:
 * - Distinguishes engagement types: permanent, fractional, interim, advisory, consulting, contract, gig
 * - Does NOT create universal PASS rule for contract/fractional/advisory
 * - Assesses strategic relevance based on evidence + candidate context
 * - Engagement type is separate from seniority/scope, career value, shortlisting, friction
 */

import { describe, it, expect } from "vitest";
import type { RecommendationRecord } from "@/lib/intelligence/record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";
import {
  synthesizeEngagementQuality,
  formatEngagementQuality,
  type EngagementQuality,
} from "@/lib/intelligence/editorial/EngagementTypeSynthesizer";

describe("P2-D: Engagement Quality", () => {
  // Base mock record
  const baseMockRecord: RecommendationRecord = {
    jobHash: "test-engagement",
    engineVersion: "4.3.0",
    recommendationVersion: "4.3.0:test",
    verb: "PURSUE",
    rawScore: 80,
    priority: 80,
    vetoed: false,
    vetoReason: null,
    claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: [] },
    confidence: 0.85,
    factors: { pursuitFriction: 10 },
    evidenceGrounding: {},
    decisionSummary: { careerValue: 80, shortlistingPotential: 75, pursuitFriction: 10 },
    decisionDrivers: [],
    decisionRisks: [],
    confidences: { parsing: 0.88, matching: 0.85, recommendation: 0.85 },
    stability: "High",
    headspace: { finalVerb: "PURSUE", downgraded: false },
    comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
    explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
    trace: {
      priority: 80,
      factors: { careerValue: 80, shortlistingPotential: 75, pursuitFriction: 10 },
      verb0: "PURSUE",
      finalVerb: "PURSUE",
      confidence: 0.85,
      stability: "High",
      pipeline: [],
      evidenceMapping: [],
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

  // Test 1: Permanent executive detected
  it("1: Detects permanent executive engagement", () => {
    const source: OpportunitySource = {
      jobHash: "test-engagement",
      role: "Chief Marketing Officer - Full Time Permanent",
      company: "ScaleCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const quality = synthesizeEngagementQuality(baseMockRecord, source);

    expect(quality.engagementType).toBe("permanent_executive");
    expect(quality.strategicRelevance).toBe("high");
    expect(quality.statement.toLowerCase()).toContain("permanent");
  });

  // Test 2: Fractional executive detected
  it("2: Detects fractional executive engagement", () => {
    const source: OpportunitySource = {
      jobHash: "test-engagement",
      role: "Fractional CMO - 2 days/week",
      company: "StartupCo",
      location: "Remote",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const quality = synthesizeEngagementQuality(baseMockRecord, source);

    expect(quality.engagementType).toBe("fractional_executive");
    expect(quality.timeCommitment).toBeDefined();
    expect(quality.statement.toLowerCase()).toContain("fractional");
  });

  // Test 3: Interim executive detected
  it("3: Detects interim executive engagement", () => {
    const source: OpportunitySource = {
      jobHash: "test-engagement",
      role: "Interim Chief Revenue Officer (6 months)",
      company: "GrowthCorp",
      location: "Delhi",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const quality = synthesizeEngagementQuality(baseMockRecord, source);

    expect(quality.engagementType).toBe("interim_executive");
    expect(quality.duration).toBeDefined();
    expect(quality.statement.toLowerCase()).toContain("interim");
  });

  // Test 4: Advisory detected
  it("4: Detects advisory engagement", () => {
    const source: OpportunitySource = {
      jobHash: "test-engagement",
      role: "Strategic Advisor - Board Role",
      company: "ScaleCorp",
      location: "Remote",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const quality = synthesizeEngagementQuality(baseMockRecord, source);

    expect(quality.engagementType).toBe("advisory");
    expect(quality.statement.toLowerCase()).toContain("advisory");
  });

  // Test 5: Contract detected
  it("5: Detects contract engagement", () => {
    const source: OpportunitySource = {
      jobHash: "test-engagement",
      role: "Marketing Consultant - 12 month contract",
      company: "ProjectCo",
      location: "Bengaluru",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const quality = synthesizeEngagementQuality(baseMockRecord, source);

    expect(quality.engagementType).toBe("contract_execution");
    expect(quality.duration).toBeDefined();
  });

  // Test 6: Gig/hourly detected
  it("6: Detects hourly/gig engagement", () => {
    const source: OpportunitySource = {
      jobHash: "test-engagement",
      role: "Marketing Expert - $150/hr",
      company: "GigPlatform",
      location: "Remote",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    // Low career value gig to test low strategic relevance
    const lowCVRecord: RecommendationRecord = {
      ...baseMockRecord,
      trace: {
        ...baseMockRecord.trace,
        factors: { careerValue: 45, shortlistingPotential: 60, pursuitFriction: 15 }
      }
    };

    const quality = synthesizeEngagementQuality(lowCVRecord, source);

    expect(quality.engagementType).toBe("gig_hourly");
    expect(quality.compensationStructure).toBeDefined();
    expect(quality.strategicRelevance).toBe("low");
  });

  // Test 7: Engagement type separate from career value
  it("7: Engagement type is independent from career value", () => {
    // Same engagement type (contract) with different career values
    const source: OpportunitySource = {
      jobHash: "test-engagement",
      role: "Contract VP Marketing - 12 months",
      company: "TestCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    // Low career value contract
    const lowCVRecord: RecommendationRecord = {
      ...baseMockRecord,
      trace: {
        ...baseMockRecord.trace,
        factors: { careerValue: 45, shortlistingPotential: 60, pursuitFriction: 15 },
        careerValueBreakdown: { brandValue: 12, learningValue: 10, trajectoryValue: 12, riskMitigation: 8 }
      }
    };

    // High career value contract
    const highCVRecord: RecommendationRecord = {
      ...baseMockRecord,
      trace: {
        ...baseMockRecord.trace,
        factors: { careerValue: 80, shortlistingPotential: 70, pursuitFriction: 15 },
        careerValueBreakdown: { brandValue: 20, learningValue: 20, trajectoryValue: 20, riskMitigation: 15 }
      }
    };

    const lowCVQuality = synthesizeEngagementQuality(lowCVRecord, source);
    const highCVQuality = synthesizeEngagementQuality(highCVRecord, source);

    // Both should detect same engagement type
    expect(lowCVQuality.engagementType).toBe("contract_execution");
    expect(highCVQuality.engagementType).toBe("contract_execution");

    // But different strategic relevance
    expect(lowCVQuality.strategicRelevance).not.toBe(highCVQuality.strategicRelevance);
  });

  // Test 8: No universal PASS for contract/fractional
  it("8: Contract/fractional does not automatically PASS or get high relevance", () => {
    const source: OpportunitySource = {
      jobHash: "test-engagement",
      role: "Fractional CMO - 1 day/week",
      company: "SmallStartup",
      location: "Remote",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const record: RecommendationRecord = {
      ...baseMockRecord,
      verb: "CONSIDER",
      rawScore: 55,
      priority: 55,
      trace: {
        ...baseMockRecord.trace,
        factors: { careerValue: 55, shortlistingPotential: 60, pursuitFriction: 15 }
      }
    };

    const quality = synthesizeEngagementQuality(record, source);

    // Should be fractional
    expect(quality.engagementType).toBe("fractional_executive");
    // Should NOT automatically be high relevance (default is moderate for fractional)
    expect(quality.strategicRelevance).toBe("moderate");
  });

  // Test 9: Unclear engagement type handled
  it("9: Handles unclear engagement type gracefully", () => {
    const source: OpportunitySource = {
      jobHash: "test-engagement",
      role: "Marketing Leader",
      company: "VagueCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const quality = synthesizeEngagementQuality(baseMockRecord, source);

    expect(quality.engagementType).toBe("unclear");
    expect(quality.strategicRelevance).toBe("unclear");
    expect(quality.confidence).toBeLessThan(0.6);
  });

  // Test 10: Senior title with hourly structure flagged
  it("10: Flags senior title with hourly compensation", () => {
    const source: OpportunitySource = {
      jobHash: "test-engagement",
      role: "Chief Marketing Officer - $200/hour",
      company: "WeirdCorp",
      location: "Remote",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const quality = synthesizeEngagementQuality(baseMockRecord, source);

    expect(quality.engagementType).toBe("gig_hourly");
    // Should flag concern about senior title with hourly
    expect(quality.relevanceRationale.toLowerCase()).toContain("unusual");
  });
});

// Edge cases
describe("P2-D: Engagement Edge Cases", () => {
  it("formatEngagementQuality returns statement", () => {
    const quality: EngagementQuality = {
      engagementType: "permanent_executive",
      detectionConfidence: 0.9,
      evidence: [],
      statement: "Test engagement statement",
      strategicRelevance: "high",
      relevanceRationale: "Test rationale",
      confidence: 0.85
    };

    expect(formatEngagementQuality(quality)).toContain("Test engagement statement");
    expect(formatEngagementQuality(quality)).toContain("Test rationale");
  });

  it("getEngagementIndicator returns correct labels", async () => {
    const { getEngagementIndicator } = await import("@/lib/intelligence/editorial/EngagementTypeSynthesizer");

    const permanent: EngagementQuality = {
      engagementType: "permanent_executive",
      detectionConfidence: 0.9,
      evidence: [],
      statement: "",
      strategicRelevance: "high",
      relevanceRationale: "",
      confidence: 0.9
    };
    expect(getEngagementIndicator(permanent).label).toBe("Permanent Executive");
    expect(getEngagementIndicator(permanent).color).toBe("green");

    const fractional: EngagementQuality = {
      engagementType: "fractional_executive",
      detectionConfidence: 0.8,
      evidence: [],
      statement: "",
      strategicRelevance: "moderate",
      relevanceRationale: "",
      confidence: 0.8
    };
    expect(getEngagementIndicator(fractional).label).toBe("Fractional");
    expect(getEngagementIndicator(fractional).color).toBe("amber");

    const gig: EngagementQuality = {
      engagementType: "gig_hourly",
      detectionConfidence: 0.8,
      evidence: [],
      statement: "",
      strategicRelevance: "low",
      relevanceRationale: "",
      confidence: 0.8
    };
    expect(getEngagementIndicator(gig).label).toBe("Hourly/Gig");
    expect(getEngagementIndicator(gig).color).toBe("red");
  });
});
