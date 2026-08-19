/**
 * P2-A.3: Career Value Interpretation Tests
 *
 * Acceptance Contract:
 * - Translates trajectory (FORWARD/LATERAL/BACKWARD) into executive meaning
 * - Does NOT merely expose raw trajectory enum
 * - Explains title progression, scope, commercial ownership, brand, optionality
 * - All claims grounded in CareerValueBreakdown evidence
 * - Career regression properly identified and explained
 * - Forward progression properly contextualized
 * - Lateral moves explained with nuance
 */

import { describe, it, expect } from "vitest";
import type { RecommendationRecord } from "@/lib/intelligence/record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";
import {
  synthesizeCareerValue,
  formatCareerValue,
  type CareerValueInterpretation,
} from "@/lib/intelligence/editorial/CareerValueSynthesizer";

describe("P2-A.3: Career Value Interpretation", () => {
  // Test 1: Forward progression is translated into executive meaning
  it("1: FORWARD trajectory translates to executive progression language", () => {
    const mockRecord: RecommendationRecord = {
      jobHash: "test-forward",
      engineVersion: "4.3.0",
      recommendationVersion: "4.3.0:test",
      verb: "PURSUE",
      rawScore: 85,
      priority: 85,
      vetoed: false,
      vetoReason: null,
      claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: [] },
      confidence: 0.88,
      factors: { pursuitFriction: 10 },
      evidenceGrounding: {},
      decisionSummary: { careerValue: 85, shortlistingPotential: 80, pursuitFriction: 10 },
      decisionDrivers: [{ factor: "Career Growth", impact: "positive", strength: "high", evidence: "Forward trajectory" }],
      decisionRisks: [],
      confidences: { parsing: 0.9, matching: 0.88, recommendation: 0.88 },
      stability: "High",
      headspace: { finalVerb: "PURSUE", downgraded: false },
      comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
      explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
      trace: {
        priority: 85,
        factors: { careerValue: 85, shortlistingPotential: 80, pursuitFriction: 10 },
        verb0: "PURSUE",
        finalVerb: "PURSUE",
        confidence: 0.88,
        stability: "High",
        pipeline: [],
        evidenceMapping: [],
        careerValueBreakdown: {
          titleProgression: { value: 0.9, reason: "Promotion to CMO", status: "KNOWN" },
          scopeExpansion: { value: 0.85, reason: "Transition to Executive Management", status: "KNOWN" },
          commercialScale: { value: 0.95, reason: "Explicit P&L or Revenue Responsibility", status: "KNOWN" },
          brandSignal: { value: 0.8, reason: "Tier 1 Brand Signal", status: "KNOWN" },
          futureOptionality: { value: 0.9, reason: "Path to CEO/Board", status: "ESTIMATED" }
        },
        headspace: { finalVerb: "PURSUE", downgraded: false },
        missing: [],
        timestamp: new Date().toISOString(),
        candidateProjectionHash: "test",
        opportunityContentHash: "test"
      },
      esi: 0.85,
      diligenceStatus: "READY"
    };

    const mockSource: OpportunitySource = {
      jobHash: "test-forward",
      role: "Chief Marketing Officer",
      company: "ScaleCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const careerValue = synthesizeCareerValue(mockRecord, mockSource);

    // Should translate to executive language
    expect(careerValue.trajectoryCategory).toBe("forward_progression");
    // Should NOT just say "FORWARD"
    expect(careerValue.statement.toLowerCase()).not.toBe("forward");
    // Should explain progression
    expect(careerValue.statement.toLowerCase()).toContain("advance");
    expect(careerValue.statement.toLowerCase()).toContain("progression");
    // Should have supporting evidence
    expect(careerValue.evidence.length).toBeGreaterThan(0);
    // Should have high confidence
    expect(careerValue.confidence).toBeGreaterThan(0.7);
    // Value score should be high
    expect(careerValue.valueScore).toBeGreaterThan(70);
  });

  // Test 2: Career regression is explained clearly
  it("2: BACKWARD trajectory explains regression meaning", () => {
    const mockRecord: RecommendationRecord = {
      jobHash: "test-backward",
      engineVersion: "4.3.0",
      recommendationVersion: "4.3.0:test",
      verb: "PASS",
      rawScore: 35,
      priority: 35,
      vetoed: true,
      vetoReason: "G-COMPATIBILITY-REGRESSION-VETO",
      claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: [] },
      confidence: 0.75,
      factors: { pursuitFriction: 25 },
      evidenceGrounding: {},
      decisionSummary: { careerValue: 30, shortlistingPotential: 25, pursuitFriction: 25 },
      decisionDrivers: [],
      decisionRisks: [{ factor: "Career Regression", impact: "negative", strength: "high", evidence: "Regression score: 75" }],
      confidences: { parsing: 0.85, matching: 0.75, recommendation: 0.75 },
      stability: "High",
      headspace: { finalVerb: "PASS", downgraded: false },
      comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
      explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
      trace: {
        priority: 35,
        factors: { careerValue: 30, shortlistingPotential: 25, pursuitFriction: 25 },
        verb0: "PASS",
        finalVerb: "PASS",
        confidence: 0.75,
        stability: "High",
        pipeline: [],
        evidenceMapping: [],
        careerValueBreakdown: {
          titleProgression: { value: 0.2, reason: "Title Regression to Manager", status: "KNOWN" },
          scopeExpansion: { value: 0.3, reason: "Execution scope", status: "KNOWN" },
          commercialScale: { value: 0.3, reason: "Cost Center / No Commercial Scope", status: "KNOWN" },
          brandSignal: { value: 0.4, reason: "Weak or Niche Brand", status: "KNOWN" },
          futureOptionality: { value: 0.3, reason: "Limited optionality", status: "ESTIMATED" }
        },
        headspace: { finalVerb: "PASS", downgraded: false },
        missing: [],
        timestamp: new Date().toISOString(),
        candidateProjectionHash: "test",
        opportunityContentHash: "test"
      },
      esi: 0.35,
      diligenceStatus: "READY"
    };

    const mockSource: OpportunitySource = {
      jobHash: "test-backward",
      role: "Marketing Manager",
      company: "SmallCo",
      location: "Pune",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const careerValue = synthesizeCareerValue(mockRecord, mockSource);

    // Should identify regression
    expect(careerValue.trajectoryCategory).toBe("backward_regression");
    // Should explain regression concern
    expect(careerValue.statement.toLowerCase()).toContain("step back");
    // Statement says "trajectory deceleration" rather than "regression"
    expect(careerValue.statement.toLowerCase()).toContain("deceleration");
    // Should mention trajectory
    expect(careerValue.statement.toLowerCase()).toContain("trajectory");
    // Value score should be low
    expect(careerValue.valueScore).toBeLessThan(50);
  });

  // Test 3: Lateral moves are explained with nuance
  it("3: LATERAL trajectory explains consolidation vs progression", () => {
    const mockRecord: RecommendationRecord = {
      jobHash: "test-lateral",
      engineVersion: "4.3.0",
      recommendationVersion: "4.3.0:test",
      verb: "CONSIDER",
      rawScore: 62,
      priority: 62,
      vetoed: false,
      vetoReason: null,
      claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: [] },
      confidence: 0.7,
      factors: { pursuitFriction: 15 },
      evidenceGrounding: {},
      decisionSummary: { careerValue: 60, shortlistingPotential: 60, pursuitFriction: 15 },
      decisionDrivers: [],
      decisionRisks: [],
      confidences: { parsing: 0.8, matching: 0.7, recommendation: 0.7 },
      stability: "Medium",
      headspace: { finalVerb: "CONSIDER", downgraded: false },
      comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
      explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
      trace: {
        priority: 62,
        factors: { careerValue: 60, shortlistingPotential: 60, pursuitFriction: 15 },
        verb0: "CONSIDER",
        finalVerb: "CONSIDER",
        confidence: 0.7,
        stability: "Medium",
        pipeline: [],
        evidenceMapping: [],
        careerValueBreakdown: {
          titleProgression: { value: 0.7, reason: "Lateral EXECUTIVE", status: "KNOWN" },
          scopeExpansion: { value: 0.75, reason: "Continued Executive Scope", status: "KNOWN" },
          commercialScale: { value: 0.7, reason: "Product-level Commercials", status: "KNOWN" },
          brandSignal: { value: 0.5, reason: "Brand metadata unavailable", status: "UNKNOWN" },
          futureOptionality: { value: 0.6, reason: "Standard Progression", status: "ESTIMATED" }
        },
        headspace: { finalVerb: "CONSIDER", downgraded: false },
        missing: [],
        timestamp: new Date().toISOString(),
        candidateProjectionHash: "test",
        opportunityContentHash: "test"
      },
      esi: 0.6,
      diligenceStatus: "READY"
    };

    const mockSource: OpportunitySource = {
      jobHash: "test-lateral",
      role: "VP Marketing",
      company: "SimilarCorp",
      location: "Bengaluru",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const careerValue = synthesizeCareerValue(mockRecord, mockSource);

    // Should identify lateral
    expect(careerValue.trajectoryCategory).toBe("lateral_consolidation");
    // Should explain lateral value
    expect(careerValue.statement.toLowerCase()).toContain("lateral");
    // Should mention consolidation or mandate
    const hasMandate = careerValue.statement.toLowerCase().includes("mandate");
    const hasConsolidation = careerValue.statement.toLowerCase().includes("consolidation");
    expect(hasMandate || hasConsolidation).toBe(true);
  });

  // Test 4: Career value is grounded in CareerValueBreakdown evidence
  it("4: Career value interpretation grounded in CareerValueBreakdown", () => {
    const mockRecord: RecommendationRecord = {
      jobHash: "test-evidence",
      engineVersion: "4.3.0",
      recommendationVersion: "4.3.0:test",
      verb: "PURSUE",
      rawScore: 78,
      priority: 78,
      vetoed: false,
      vetoReason: null,
      claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: [] },
      confidence: 0.82,
      factors: { pursuitFriction: 12 },
      evidenceGrounding: {},
      decisionSummary: { careerValue: 75, shortlistingPotential: 70, pursuitFriction: 12 },
      decisionDrivers: [],
      decisionRisks: [],
      confidences: { parsing: 0.88, matching: 0.82, recommendation: 0.82 },
      stability: "High",
      headspace: { finalVerb: "PURSUE", downgraded: false },
      comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
      explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
      trace: {
        priority: 78,
        factors: { careerValue: 75, shortlistingPotential: 70, pursuitFriction: 12 },
        verb0: "PURSUE",
        finalVerb: "PURSUE",
        confidence: 0.82,
        stability: "High",
        pipeline: [],
        evidenceMapping: [],
        careerValueBreakdown: {
          titleProgression: { value: 0.8, reason: "Promotion to VP", status: "KNOWN" },
          scopeExpansion: { value: 0.85, reason: "Transition to Executive Management", status: "KNOWN" },
          commercialScale: { value: 0.75, reason: "Budget Ownership", status: "KNOWN" },
          brandSignal: { value: 0.7, reason: "Strong Market Player", status: "KNOWN" },
          futureOptionality: { value: 0.85, reason: "Capability Portability", status: "ESTIMATED" }
        },
        headspace: { finalVerb: "PURSUE", downgraded: false },
        missing: [],
        timestamp: new Date().toISOString(),
        candidateProjectionHash: "test",
        opportunityContentHash: "test"
      },
      esi: 0.75,
      diligenceStatus: "READY"
    };

    const mockSource: OpportunitySource = {
      jobHash: "test-evidence",
      role: "VP Growth",
      company: "GrowthCorp",
      location: "Delhi",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const careerValue = synthesizeCareerValue(mockRecord, mockSource);

    // Evidence should be populated from breakdown
    expect(careerValue.evidence.length).toBeGreaterThan(0);
    // Evidence should include specific dimensions
    const evidenceText = careerValue.evidence.join(" ").toLowerCase();
    expect(evidenceText).toContain("title");
    expect(evidenceText).toContain("scope");
    expect(evidenceText).toContain("commercial");
  });

  // Test 5: Dimension interpretations are provided
  it("5: Career value provides dimension interpretations", () => {
    const mockRecord: RecommendationRecord = {
      jobHash: "test-dimensions",
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
        careerValueBreakdown: {
          titleProgression: { value: 0.9, reason: "Promotion", status: "KNOWN" },
          scopeExpansion: { value: 0.85, reason: "Executive Management", status: "KNOWN" },
          commercialScale: { value: 0.9, reason: "P&L", status: "KNOWN" },
          brandSignal: { value: 0.75, reason: "Strong", status: "KNOWN" },
          futureOptionality: { value: 0.8, reason: "Enhanced", status: "ESTIMATED" }
        },
        headspace: { finalVerb: "PURSUE", downgraded: false },
        missing: [],
        timestamp: new Date().toISOString(),
        candidateProjectionHash: "test",
        opportunityContentHash: "test"
      },
      esi: 0.78,
      diligenceStatus: "READY"
    };

    const mockSource: OpportunitySource = {
      jobHash: "test-dimensions",
      role: "CMO",
      company: "BrandCo",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const careerValue = synthesizeCareerValue(mockRecord, mockSource);

    // Should have dimension interpretations
    expect(careerValue.dimensions.title).toBeDefined();
    expect(careerValue.dimensions.scope).toBeDefined();
    expect(careerValue.dimensions.commercial).toBeDefined();
    expect(careerValue.dimensions.brand).toBeDefined();
    expect(careerValue.dimensions.optionality).toBeDefined();

    // Title direction should be indicated
    expect(["up", "lateral", "down", "unclear"]).toContain(careerValue.dimensions.title.direction);
    // Scope direction should be indicated
    expect(["broader", "similar", "narrower", "unclear"]).toContain(careerValue.dimensions.scope.direction);
    // Commercial direction should be indicated
    expect(["greater", "similar", "lesser", "unclear"]).toContain(careerValue.dimensions.commercial.direction);
  });

  // Test 6: Missing CareerValueBreakdown is handled gracefully
  it("6: Missing CareerValueBreakdown handled gracefully", () => {
    const mockRecord: RecommendationRecord = {
      jobHash: "test-missing-breakdown",
      engineVersion: "4.3.0",
      recommendationVersion: "4.3.0:test",
      verb: "CONSIDER",
      rawScore: 60,
      priority: 60,
      vetoed: false,
      vetoReason: null,
      claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: [] },
      confidence: 0.7,
      factors: { pursuitFriction: 15 },
      evidenceGrounding: {},
      decisionSummary: { careerValue: 60, shortlistingPotential: 55, pursuitFriction: 15 },
      decisionDrivers: [],
      decisionRisks: [],
      confidences: { parsing: 0.8, matching: 0.7, recommendation: 0.7 },
      stability: "Medium",
      headspace: { finalVerb: "CONSIDER", downgraded: false },
      comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
      explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
      trace: {
        priority: 60,
        factors: { careerValue: 60, shortlistingPotential: 55, pursuitFriction: 15 },
        verb0: "CONSIDER",
        finalVerb: "CONSIDER",
        confidence: 0.7,
        stability: "Medium",
        pipeline: [],
        evidenceMapping: [],
        // Missing careerValueBreakdown
        careerValueBreakdown: undefined as any,
        headspace: { finalVerb: "CONSIDER", downgraded: false },
        missing: [],
        timestamp: new Date().toISOString(),
        candidateProjectionHash: "test",
        opportunityContentHash: "test"
      },
      esi: 0.6,
      diligenceStatus: "READY"
    };

    const mockSource: OpportunitySource = {
      jobHash: "test-missing-breakdown",
      role: "Director",
      company: "TestCo",
      location: "Pune",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    // Should not throw
    expect(() => synthesizeCareerValue(mockRecord, mockSource)).not.toThrow();

    const careerValue = synthesizeCareerValue(mockRecord, mockSource);

    // Should provide some interpretation
    expect(careerValue.statement).toBeDefined();
    expect(careerValue.statement.length).toBeGreaterThan(0);
    // Confidence should reflect uncertainty
    expect(careerValue.confidence).toBeLessThan(0.7);
  });
});

// Edge case tests
describe("P2-A.3: Career Value Edge Cases", () => {
  // Test format function
  it("formatCareerValue returns statement", () => {
    const careerValue: CareerValueInterpretation = {
      statement: "Test career value interpretation",
      trajectoryCategory: "forward_progression",
      dimensions: {
        title: { interpretation: "Test", direction: "up" },
        scope: { interpretation: "Test", direction: "broader" },
        commercial: { interpretation: "Test", direction: "greater" },
        brand: { interpretation: "Test", signal: "strong" },
        optionality: { interpretation: "Test", outlook: "enhanced" }
      },
      evidence: [],
      confidence: 0.8,
      valueScore: 75
    };

    expect(formatCareerValue(careerValue)).toBe("Test career value interpretation");
  });

  // Test trajectory indicator
  it("trajectory indicator returns correct labels", async () => {
    const { getTrajectoryIndicator } = await import("@/lib/intelligence/editorial/CareerValueSynthesizer");

    const forward: CareerValueInterpretation = {
      statement: "Forward",
      trajectoryCategory: "forward_progression",
      dimensions: {} as any,
      evidence: [],
      confidence: 0.8,
      valueScore: 80
    };
    expect(getTrajectoryIndicator(forward).label).toBe("Forward Progression");
    expect(getTrajectoryIndicator(forward).color).toBe("green");

    const lateral: CareerValueInterpretation = {
      statement: "Lateral",
      trajectoryCategory: "lateral_consolidation",
      dimensions: {} as any,
      evidence: [],
      confidence: 0.7,
      valueScore: 60
    };
    expect(getTrajectoryIndicator(lateral).label).toBe("Lateral Consolidation");
    expect(getTrajectoryIndicator(lateral).color).toBe("amber");

    const backward: CareerValueInterpretation = {
      statement: "Backward",
      trajectoryCategory: "backward_regression",
      dimensions: {} as any,
      evidence: [],
      confidence: 0.7,
      valueScore: 40
    };
    expect(getTrajectoryIndicator(backward).label).toBe("Career Regression");
    expect(getTrajectoryIndicator(backward).color).toBe("red");
  });
});
