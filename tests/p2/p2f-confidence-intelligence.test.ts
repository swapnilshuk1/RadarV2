/**
 * P2-F: Confidence / Uncertainty Intelligence Tests
 *
 * Acceptance Contract:
 * - Makes confidence actionable (not just numeric score)
 * - HIGH confidence → proceed decisively
 * - MODERATE confidence → proceed with validation
 * - LOW confidence → pause and validate
 * - SPARSE_SPEC / NOT_EVALUABLE → no fabricated recommendation
 * - Explicitly identifies what is unknown
 */

import { describe, it, expect } from "vitest";
import type { RecommendationRecord } from "@/lib/intelligence/record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";
import {
  synthesizeConfidence,
  formatConfidence,
  type ConfidenceInterpretation,
} from "@/lib/intelligence/editorial/ConfidenceSynthesizer";

describe("P2-F: Confidence Intelligence", () => {
  // Base mock record
  const baseMockRecord: RecommendationRecord = {
    jobHash: "test-conf",
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

  // Test 1: High confidence assessment
  it("1: High confidence enables decisive action", () => {
    const source: OpportunitySource = {
      jobHash: "test-conf",
      role: "VP Marketing",
      company: "ScaleCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const conf = synthesizeConfidence(baseMockRecord, source);

    expect(conf.level).toBe("high");
    expect(conf.trustLevel).toBe("proceed");
    expect(conf.statement.toLowerCase()).toContain("high confidence");
  });

  // Test 2: Moderate confidence requires validation
  it("2: Moderate confidence requires specific validation", () => {
    const source: OpportunitySource = {
      jobHash: "test-conf",
      role: "Marketing Director",
      company: "GrowthCo",
      location: "Bengaluru",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const record: RecommendationRecord = {
      ...baseMockRecord,
      confidence: 0.6,
      confidences: { parsing: 0.7, matching: 0.6, recommendation: 0.6 }
    };

    const conf = synthesizeConfidence(record, source);

    expect(conf.level).toBe("moderate");
    expect(conf.trustLevel).toBe("proceed_with_validation");
    expect(conf.statement.toLowerCase()).toContain("moderate");
  });

  // Test 3: Low confidence requires pause
  it("3: Low confidence requires pause and validation", () => {
    const source: OpportunitySource = {
      jobHash: "test-conf",
      role: "Marketing Manager",
      company: "VagueCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const record: RecommendationRecord = {
      ...baseMockRecord,
      confidence: 0.4,
      confidences: { parsing: 0.5, matching: 0.4, recommendation: 0.4 }
    };

    const conf = synthesizeConfidence(record, source);

    expect(conf.level).toBe("low");
    expect(conf.trustLevel).toBe("pause_and_validate");
    expect(conf.statement.toLowerCase()).toContain("low");
  });

  // Test 4: SPARSE_SPEC handled correctly
  it("4: SPARSE_SPEC results in insufficient evidence", () => {
    const source: OpportunitySource = {
      jobHash: "test-conf",
      role: "Marketing",
      company: "MinimalCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const record: RecommendationRecord = {
      ...baseMockRecord,
      verb: "SPARSE_SPEC",
      confidence: 0.3
    };

    const conf = synthesizeConfidence(record, source);

    expect(conf.level).toBe("insufficient");
    expect(conf.trustLevel).toBe("insufficient_evidence");
    expect(conf.statement.toLowerCase()).toContain("insufficient");
  });

  // Test 5: NOT_EVALUABLE handled correctly
  it("5: NOT_EVALUABLE results in insufficient evidence", () => {
    const source: OpportunitySource = {
      jobHash: "test-conf",
      role: "Marketing",
      company: "WeirdCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const record: RecommendationRecord = {
      ...baseMockRecord,
      verb: "NOT_EVALUABLE",
      confidence: 0.3
    };

    const conf = synthesizeConfidence(record, source);

    expect(conf.level).toBe("insufficient");
    expect(conf.trustLevel).toBe("insufficient_evidence");
  });

  // Test 6: Explicitly identifies unknowns
  it("6: Explicitly identifies what is unknown", () => {
    const source: OpportunitySource = {
      jobHash: "test-conf",
      role: "Marketing Director",
      company: "TestCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const record: RecommendationRecord = {
      ...baseMockRecord,
      confidence: 0.45,
      claimPermissions: {
        allowedClaims: [],
        explicitUnknowns: ["[CORE_MANDATE] P&L ownership", "[DOMAIN_FAMILIARITY] Industry experience"],
        explicitRisks: []
      }
    };

    const conf = synthesizeConfidence(record, source);

    // Should identify the unknowns
    expect(conf.unknowns.length).toBeGreaterThan(0);
    expect(conf.unknowns.some(u => u.toLowerCase().includes("p&l"))).toBe(true);
  });

  // Test 7: No blanket confidence threshold for PASS
  it("7: Low confidence does not automatically mean PASS", () => {
    const source: OpportunitySource = {
      jobHash: "test-conf",
      role: "VP Marketing",
      company: "TestCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    // Low confidence PURSUE
    const lowConfPursue: RecommendationRecord = {
      ...baseMockRecord,
      verb: "PURSUE",
      confidence: 0.4
    };

    const conf = synthesizeConfidence(lowConfPursue, source);

    // Should still be PURSUE with low confidence, not auto-PASS
    expect(conf.level).toBe("low");
    expect(conf.trustLevel).toBe("pause_and_validate");
  });

  // Test 8: Validation guidance for moderate confidence
  it("8: Moderate confidence includes specific validation guidance", () => {
    const source: OpportunitySource = {
      jobHash: "test-conf",
      role: "Marketing Director",
      company: "TestCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const record: RecommendationRecord = {
      ...baseMockRecord,
      confidence: 0.55,
      claimPermissions: {
        allowedClaims: [],
        explicitUnknowns: ["Reporting structure", "Team size"],
        explicitRisks: []
      }
    };

    const conf = synthesizeConfidence(record, source);

    expect(conf.level).toBe("moderate");
    expect(conf.validationNeeded).toBeDefined();
    expect(conf.validationNeeded?.toLowerCase()).toContain("validate");
  });

  // Test 9: High confidence with veto still clear
  it("9: High confidence with veto is still clear", () => {
    const source: OpportunitySource = {
      jobHash: "test-conf",
      role: "VP Marketing",
      company: "MismatchCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const record: RecommendationRecord = {
      ...baseMockRecord,
      verb: "PASS",
      vetoed: true,
      vetoReason: "Identity distance mismatch",
      confidence: 0.8
    };

    const conf = synthesizeConfidence(record, source);

    expect(conf.level).toBe("high");
    expect(conf.statement.toLowerCase()).toContain("veto");
  });

  // Test 10: Known evidence surfaced
  it("10: Surfaces what RADAR knows with confidence", () => {
    const source: OpportunitySource = {
      jobHash: "test-conf",
      role: "VP Marketing",
      company: "TestCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const conf = synthesizeConfidence(baseMockRecord, source);

    expect(conf.known.length).toBeGreaterThan(0);
    expect(conf.known.some(k => k.toLowerCase().includes("well-parsed") || k.toLowerCase().includes("well-grounded"))).toBe(true);
  });
});

// Edge cases
describe("P2-F: Confidence Edge Cases", () => {
  it("formatConfidence returns statement", () => {
    const conf: ConfidenceInterpretation = {
      level: "moderate",
      score: 0.6,
      statement: "Moderate confidence assessment.",
      known: [],
      unknowns: ["test"],
      validationNeeded: "Validate: test",
      trustLevel: "proceed_with_validation",
      evidence: [],
      confidence: 0.6
    };

    expect(formatConfidence(conf)).toContain("Moderate");
    expect(formatConfidence(conf)).toContain("Validate");
  });

  it("getConfidenceIndicator returns correct labels", async () => {
    const { getConfidenceIndicator } = await import("@/lib/intelligence/editorial/ConfidenceSynthesizer");

    const high: ConfidenceInterpretation = {
      level: "high",
      score: 0.85,
      statement: "",
      known: [],
      unknowns: [],
      trustLevel: "proceed",
      evidence: [],
      confidence: 0.85
    };
    expect(getConfidenceIndicator(high).label).toBe("High Confidence");
    expect(getConfidenceIndicator(high).color).toBe("green");

    const insufficient: ConfidenceInterpretation = {
      level: "insufficient",
      score: 0.3,
      statement: "",
      known: [],
      unknowns: [],
      trustLevel: "insufficient_evidence",
      evidence: [],
      confidence: 0.3
    };
    expect(getConfidenceIndicator(insufficient).label).toBe("Insufficient Evidence");
    expect(getConfidenceIndicator(insufficient).color).toBe("neutral");
  });
});
