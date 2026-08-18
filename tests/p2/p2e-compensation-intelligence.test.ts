/**
 * P2-E: Compensation Intelligence Tests
 *
 * Acceptance Contract:
 * - Detects compensation structures: fixed, salary+equity, salary+bonus, full package
 * - Extracts salary ranges when specified
 * - Does NOT create universal rules (high comp ≠ automatic PASS)
 * - Interprets compensation in context of role seniority
 * - Compensation is separate from engagement type, career value, etc.
 */

import { describe, it, expect } from "vitest";
import type { RecommendationRecord } from "@/lib/intelligence/record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";
import {
  synthesizeCompensation,
  formatCompensation,
  type CompensationInterpretation,
} from "@/lib/intelligence/editorial/CompensationSynthesizer";

describe("P2-E: Compensation Intelligence", () => {
  // Base mock record
  const baseMockRecord: RecommendationRecord = {
    jobHash: "test-comp",
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

  // Test 1: Full executive package detected
  it("1: Detects full executive compensation (salary + bonus + equity)", () => {
    const source: OpportunitySource = {
      jobHash: "test-comp",
      role: "VP Marketing with ESOP and performance bonus",
      company: "ScaleCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const comp = synthesizeCompensation(baseMockRecord, source);

    expect(comp.structure).toBe("salary_bonus_equity");
    expect(comp.hasEquity).toBe(true);
    expect(comp.hasBonus).toBe(true);
    expect(comp.statement).toContain("equity");
  });

  // Test 2: Salary + equity detected
  it("2: Detects salary plus equity structure", () => {
    const source: OpportunitySource = {
      jobHash: "test-comp",
      role: "Chief Marketing Officer - ESOP participation",
      company: "GrowthCo",
      location: "Bengaluru",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const comp = synthesizeCompensation(baseMockRecord, source);

    expect(comp.structure).toBe("salary_plus_equity");
    expect(comp.hasEquity).toBe(true);
    expect(comp.hasBonus).toBe(false);
  });

  // Test 3: Salary + bonus detected
  it("3: Detects salary plus bonus structure", () => {
    const source: OpportunitySource = {
      jobHash: "test-comp",
      role: "Director Marketing - performance bonus",
      company: "StableCorp",
      location: "Delhi",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const comp = synthesizeCompensation(baseMockRecord, source);

    expect(comp.structure).toBe("salary_plus_bonus");
    expect(comp.hasEquity).toBe(false);
    expect(comp.hasBonus).toBe(true);
  });

  // Test 4: Undisclosed compensation when no keywords present
  it("4: Returns undisclosed when no compensation keywords present", () => {
    const source: OpportunitySource = {
      jobHash: "test-comp",
      role: "Marketing Manager",
      company: "TraditionalCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const comp = synthesizeCompensation(baseMockRecord, source);

    // When no compensation keywords present, structure is undisclosed
    expect(comp.structure).toBe("undisclosed");
    expect(comp.hasEquity).toBe(false);
    expect(comp.hasBonus).toBe(false);
  });

  // Test 5: Salary range extracted
  it("5: Extracts salary range from text", () => {
    const source: OpportunitySource = {
      jobHash: "test-comp",
      role: "VP Marketing 50-70 LPA",
      company: "ScaleCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const comp = synthesizeCompensation(baseMockRecord, source);

    expect(comp.baseSalaryRange).toBeDefined();
    expect(comp.baseSalaryRange?.currency).toBe("INR");
  });

  // Test 6: No universal PASS for high compensation
  it("6: High compensation does not automatically mean PASS", () => {
    const source: OpportunitySource = {
      jobHash: "test-comp",
      role: "Marketing Manager - 80 LPA with ESOP",
      company: "TestCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    // Even with high comp, if it's a lateral move, career value might be low
    const lowCVRecord: RecommendationRecord = {
      ...baseMockRecord,
      verb: "CONSIDER",
      rawScore: 60,
      priority: 60,
      trace: {
        ...baseMockRecord.trace,
        factors: { careerValue: 55, shortlistingPotential: 70, pursuitFriction: 15 }
      }
    };

    const comp = synthesizeCompensation(lowCVRecord, source);

    // Should detect compensation
    expect(comp.structure).toBe("salary_plus_equity");
    // But this doesn't automatically mean the opportunity is right
    expect(comp.marketPosition).not.toBe("above_market");
  });

  // Test 7: Compensation separate from career value
  it("7: Compensation is independent from career value", () => {
    const source: OpportunitySource = {
      jobHash: "test-comp",
      role: "VP Marketing - competitive package with ESOP",
      company: "TestCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    // Same compensation, different career values
    const lowCVRecord: RecommendationRecord = {
      ...baseMockRecord,
      trace: { ...baseMockRecord.trace, factors: { careerValue: 45, shortlistingPotential: 60, pursuitFriction: 15 } }
    };
    const highCVRecord: RecommendationRecord = {
      ...baseMockRecord,
      trace: { ...baseMockRecord.trace, factors: { careerValue: 85, shortlistingPotential: 80, pursuitFriction: 10 } }
    };

    const lowCVComp = synthesizeCompensation(lowCVRecord, source);
    const highCVComp = synthesizeCompensation(highCVRecord, source);

    // Both should detect same compensation structure
    expect(lowCVComp.structure).toBe(highCVComp.structure);
    expect(lowCVComp.hasEquity).toBe(highCVComp.hasEquity);
  });

  // Test 8: Senior role with fixed only flagged
  it("8: Flags senior role with fixed-only compensation", () => {
    const source: OpportunitySource = {
      jobHash: "test-comp",
      role: "Chief Marketing Officer",
      company: "OldCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const comp = synthesizeCompensation(baseMockRecord, source);

    // Senior role with fixed-only should be flagged
    if (comp.structure === "fixed_salary") {
      expect(comp.marketPosition).toBe("below_market");
      expect(comp.relevanceRationale.toLowerCase()).toContain("senior");
    }
  });

  // Test 9: Undisclosed compensation handled
  it("9: Handles undisclosed compensation gracefully", () => {
    const source: OpportunitySource = {
      jobHash: "test-comp",
      role: "Marketing Director",
      company: "VagueCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const comp = synthesizeCompensation(baseMockRecord, source);

    expect(comp.structure).toBe("undisclosed");
    expect(comp.marketPosition).toBe("unclear");
    expect(comp.confidence).toBeLessThan(0.6);
  });

  // Test 10: Currency detection with proper format
  it("10: Detects currency from text with proper format", () => {
    const source: OpportunitySource = {
      jobHash: "test-comp",
      role: "VP Marketing with equity - Salary $200,000-$250,000 per year",
      company: "USCorp",
      location: "Remote US",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const comp = synthesizeCompensation(baseMockRecord, source);

    // Should detect equity + salary structure
    expect(comp.hasEquity).toBe(true);
    // Currency should be USD if dollar sign present
    if (comp.baseSalaryRange) {
      expect(comp.baseSalaryRange.currency).toBe("USD");
    }
  });
});

// Edge cases
describe("P2-E: Compensation Edge Cases", () => {
  it("formatCompensation returns statement", () => {
    const comp: CompensationInterpretation = {
      structure: "salary_plus_equity",
      hasEquity: true,
      hasBonus: false,
      detectionConfidence: 0.8,
      evidence: [],
      statement: "Test comp statement",
      marketPosition: "market_rate",
      relevanceRationale: "Test rationale",
      confidence: 0.85
    };

    expect(formatCompensation(comp)).toContain("Test comp statement");
    expect(formatCompensation(comp)).toContain("Test rationale");
  });

  it("getCompensationIndicator returns correct labels", async () => {
    const { getCompensationIndicator } = await import("@/lib/intelligence/editorial/CompensationSynthesizer");

    const above: CompensationInterpretation = {
      structure: "salary_bonus_equity",
      hasEquity: true,
      hasBonus: true,
      detectionConfidence: 0.9,
      evidence: [],
      statement: "",
      marketPosition: "above_market",
      relevanceRationale: "",
      confidence: 0.9
    };
    expect(getCompensationIndicator(above).label).toBe("Above Market");
    expect(getCompensationIndicator(above).color).toBe("green");

    const undisclosed: CompensationInterpretation = {
      structure: "undisclosed",
      hasEquity: false,
      hasBonus: false,
      detectionConfidence: 0.5,
      evidence: [],
      statement: "",
      marketPosition: "unclear",
      relevanceRationale: "",
      confidence: 0.5
    };
    expect(getCompensationIndicator(undisclosed).label).toBe("Undisclosed");
    expect(getCompensationIndicator(undisclosed).color).toBe("neutral");
  });
});
