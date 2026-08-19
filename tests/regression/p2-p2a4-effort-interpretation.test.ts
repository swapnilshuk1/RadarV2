/**
 * P2-A.4: Effort Interpretation Tests
 *
 * Acceptance Contract:
 * - Translates tailoringEffort (LOW/MODERATE/HIGH) into executive action meaning
 * - Explains what preparation is required
 * - Provides time/headspace estimates
 * - Identifies specific friction points
 * - Suggests validation needed before investment
 * - All grounded in capability gaps from authoritative assessment
 */

import { describe, it, expect } from "vitest";
import type { RecommendationRecord } from "@/lib/intelligence/record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";
import {
  synthesizeEffort,
  formatEffort,
  formatEffortAction,
  type EffortInterpretation,
} from "@/lib/intelligence/editorial/EffortSynthesizer";

describe("P2-A.4: Effort Interpretation", () => {
  // Test 1: HIGH effort translates to executive action meaning
  it("1: HIGH effort explains repositioning requirements", () => {
    const mockRecord: RecommendationRecord = {
      jobHash: "test-high-effort",
      engineVersion: "4.3.0",
      recommendationVersion: "4.3.0:test",
      verb: "CONSIDER",
      rawScore: 55,
      priority: 55,
      vetoed: false,
      vetoReason: null,
      claimPermissions: {
        allowedClaims: [],
        explicitUnknowns: ["P&L Ownership [CORE_MANDATE]", "Enterprise Scale [EXECUTION_CAPABILITY]"],
        explicitRisks: []
      },
      confidence: 0.65,
      factors: { pursuitFriction: 25 },
      evidenceGrounding: {},
      decisionSummary: { careerValue: 60, shortlistingPotential: 50, pursuitFriction: 25 },
      decisionDrivers: [],
      decisionRisks: [{ factor: "Capability Gaps", impact: "negative", strength: "high", evidence: "Missing core capabilities" }],
      confidences: { parsing: 0.8, matching: 0.65, recommendation: 0.65 },
      stability: "Medium",
      headspace: { finalVerb: "CONSIDER", downgraded: false },
      comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
      explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
      trace: {
        priority: 55,
        factors: { careerValue: 60, shortlistingPotential: 50, pursuitFriction: 25, tailoringEffort: "HIGH" },
        verb0: "CONSIDER",
        finalVerb: "CONSIDER",
        confidence: 0.65,
        stability: "Medium",
        pipeline: [],
        evidenceMapping: [],
        careerValueBreakdown: { brandValue: 15, learningValue: 15, trajectoryValue: 15, riskMitigation: 10 },
        headspace: { finalVerb: "CONSIDER", downgraded: false },
        missing: ["P&L Ownership", "Enterprise Scale"],
        timestamp: new Date().toISOString(),
        candidateProjectionHash: "test",
        opportunityContentHash: "test"
      },
      esi: 0.55,
      diligenceStatus: "READY"
    };

    const mockSource: OpportunitySource = {
      jobHash: "test-high-effort",
      role: "Chief Revenue Officer",
      company: "ScaleCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const effort = synthesizeEffort(mockRecord, mockSource);

    // Should indicate high effort
    expect(effort.effortLevel).toBe("high");
    // Should NOT just say "HIGH"
    expect(effort.statement.toLowerCase()).not.toBe("high");
    // Should explain repositioning
    expect(effort.statement.toLowerCase()).toContain("repositioning");
    expect(effort.statement.toLowerCase()).toContain("preparation");
    // Should have time estimate
    expect(effort.timeEstimate).toBeDefined();
    expect(effort.timeEstimate.length).toBeGreaterThan(0);
    // Should have preparation requirements
    expect(effort.preparationRequired.length).toBeGreaterThan(0);
    // Should identify friction points
    expect(effort.frictionPoints.length).toBeGreaterThan(0);
    // Should have validation guidance
    expect(effort.validationNeeded).toBeDefined();
  });

  // Test 2: LOW effort explains minimal preparation
  it("2: LOW effort explains minimal preparation needed", () => {
    const mockRecord: RecommendationRecord = {
      jobHash: "test-low-effort",
      engineVersion: "4.3.0",
      recommendationVersion: "4.3.0:test",
      verb: "PURSUE",
      rawScore: 85,
      priority: 85,
      vetoed: false,
      vetoReason: null,
      claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: [] },
      confidence: 0.9,
      factors: { pursuitFriction: 5 },
      evidenceGrounding: {},
      decisionSummary: { careerValue: 85, shortlistingPotential: 80, pursuitFriction: 5 },
      decisionDrivers: [{ factor: "Strong Match", impact: "positive", strength: "high", evidence: "Complete capability alignment" }],
      decisionRisks: [],
      confidences: { parsing: 0.92, matching: 0.9, recommendation: 0.9 },
      stability: "High",
      headspace: { finalVerb: "PURSUE", downgraded: false },
      comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
      explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
      trace: {
        priority: 85,
        factors: { careerValue: 85, shortlistingPotential: 80, pursuitFriction: 5, tailoringEffort: "LOW" },
        verb0: "PURSUE",
        finalVerb: "PURSUE",
        confidence: 0.9,
        stability: "High",
        pipeline: [],
        evidenceMapping: [],
        careerValueBreakdown: { brandValue: 22, learningValue: 22, trajectoryValue: 20, riskMitigation: 18 },
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
      jobHash: "test-low-effort",
      role: "VP Marketing",
      company: "GrowthCorp",
      location: "Bengaluru",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const effort = synthesizeEffort(mockRecord, mockSource);

    // Should indicate low effort
    expect(effort.effortLevel).toBe("low");
    // Should explain minimal preparation
    expect(effort.statement.toLowerCase()).toContain("low");
    // Should mention alignment
    expect(effort.statement.toLowerCase()).toContain("align");
    // Short time estimate
    expect(effort.timeEstimate).toContain("2-3 hours");
    // Effort is justified
    expect(effort.effortJustified).toBe("yes");
  });

  // Test 3: MODERATE effort with execution gaps
  it("3: MODERATE effort explains execution-level preparation", () => {
    const mockRecord: RecommendationRecord = {
      jobHash: "test-moderate-effort",
      engineVersion: "4.3.0",
      recommendationVersion: "4.3.0:test",
      verb: "CONSIDER",
      rawScore: 68,
      priority: 68,
      vetoed: false,
      vetoReason: null,
      claimPermissions: {
        allowedClaims: [],
        explicitUnknowns: ["Salesforce [TECHNOLOGY_STACK]", "Adobe Analytics [TECHNOLOGY_STACK]"],
        explicitRisks: []
      },
      confidence: 0.75,
      factors: { pursuitFriction: 12 },
      evidenceGrounding: {},
      decisionSummary: { careerValue: 70, shortlistingPotential: 65, pursuitFriction: 12 },
      decisionDrivers: [],
      decisionRisks: [],
      confidences: { parsing: 0.85, matching: 0.75, recommendation: 0.75 },
      stability: "Medium",
      headspace: { finalVerb: "CONSIDER", downgraded: false },
      comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
      explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
      trace: {
        priority: 68,
        factors: { careerValue: 70, shortlistingPotential: 65, pursuitFriction: 12, tailoringEffort: "MODERATE" },
        verb0: "CONSIDER",
        finalVerb: "CONSIDER",
        confidence: 0.75,
        stability: "Medium",
        pipeline: [],
        evidenceMapping: [],
        careerValueBreakdown: { brandValue: 18, learningValue: 18, trajectoryValue: 17, riskMitigation: 14 },
        headspace: { finalVerb: "CONSIDER", downgraded: false },
        missing: ["Salesforce", "Adobe Analytics"],
        timestamp: new Date().toISOString(),
        candidateProjectionHash: "test",
        opportunityContentHash: "test"
      },
      esi: 0.68,
      diligenceStatus: "READY"
    };

    const mockSource: OpportunitySource = {
      jobHash: "test-moderate-effort",
      role: "VP Marketing",
      company: "TechCorp",
      location: "Delhi",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const effort = synthesizeEffort(mockRecord, mockSource);

    // Should indicate moderate effort
    expect(effort.effortLevel).toBe("moderate");
    // Should mention bridging gaps
    expect(effort.statement.toLowerCase()).toContain("bridge");
    // Should have preparation guidance
    expect(effort.preparationRequired.length).toBeGreaterThan(0);
  });

  // Test 4: Effort grounded in capability gaps
  it("4: Effort interpretation grounded in capability gaps", () => {
    const mockRecord: RecommendationRecord = {
      jobHash: "test-grounded",
      engineVersion: "4.3.0",
      recommendationVersion: "4.3.0:test",
      verb: "CONSIDER",
      rawScore: 60,
      priority: 60,
      vetoed: false,
      vetoReason: null,
      claimPermissions: {
        allowedClaims: [],
        explicitUnknowns: ["Healthcare Domain [DOMAIN_FAMILIARITY]"],
        explicitRisks: []
      },
      confidence: 0.7,
      factors: { pursuitFriction: 15 },
      evidenceGrounding: {},
      decisionSummary: { careerValue: 65, shortlistingPotential: 60, pursuitFriction: 15 },
      decisionDrivers: [],
      decisionRisks: [],
      confidences: { parsing: 0.8, matching: 0.7, recommendation: 0.7 },
      stability: "Medium",
      headspace: { finalVerb: "CONSIDER", downgraded: false },
      comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
      explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
      trace: {
        priority: 60,
        factors: { careerValue: 65, shortlistingPotential: 60, pursuitFriction: 15, tailoringEffort: "MODERATE" },
        verb0: "CONSIDER",
        finalVerb: "CONSIDER",
        confidence: 0.7,
        stability: "Medium",
        pipeline: [],
        evidenceMapping: [],
        careerValueBreakdown: { brandValue: 16, learningValue: 16, trajectoryValue: 16, riskMitigation: 12 },
        headspace: { finalVerb: "CONSIDER", downgraded: false },
        missing: ["Healthcare Domain"],
        timestamp: new Date().toISOString(),
        candidateProjectionHash: "test",
        opportunityContentHash: "test"
      },
      esi: 0.6,
      diligenceStatus: "READY"
    };

    const mockSource: OpportunitySource = {
      jobHash: "test-grounded",
      role: "VP Marketing",
      company: "HealthTech",
      location: "Bengaluru",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const effort = synthesizeEffort(mockRecord, mockSource);

    // Evidence should include gap information
    expect(effort.evidence.length).toBeGreaterThan(0);
    // Friction points should identify domain gap
    const frictionText = effort.frictionPoints.join(" ").toLowerCase();
    expect(frictionText).toContain("domain");
    // Friction points should identify domain gap
    expect(effort.frictionPoints.some(p => p.toLowerCase().includes("domain"))).toBe(true);
  });

  // Test 5: PASS opportunities indicate effort not justified
  it("5: PASS opportunities suggest effort not justified", () => {
    const mockRecord: RecommendationRecord = {
      jobHash: "test-pass",
      engineVersion: "4.3.0",
      recommendationVersion: "4.3.0:test",
      verb: "PASS",
      rawScore: 30,
      priority: 30,
      vetoed: true,
      vetoReason: "G-COMPATIBILITY-REGRESSION-VETO",
      claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: [] },
      confidence: 0.75,
      factors: { pursuitFriction: 30 },
      evidenceGrounding: {},
      decisionSummary: { careerValue: 25, shortlistingPotential: 20, pursuitFriction: 30 },
      decisionDrivers: [],
      decisionRisks: [{ factor: "Career Regression", impact: "negative", strength: "high", evidence: "Regression score: 75" }],
      confidences: { parsing: 0.85, matching: 0.75, recommendation: 0.75 },
      stability: "High",
      headspace: { finalVerb: "PASS", downgraded: false },
      comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
      explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
      trace: {
        priority: 30,
        factors: { careerValue: 25, shortlistingPotential: 20, pursuitFriction: 30, tailoringEffort: "HIGH" },
        verb0: "PASS",
        finalVerb: "PASS",
        confidence: 0.75,
        stability: "High",
        pipeline: [],
        evidenceMapping: [],
        careerValueBreakdown: { brandValue: 8, learningValue: 8, trajectoryValue: 6, riskMitigation: 5 },
        headspace: { finalVerb: "PASS", downgraded: false },
        missing: [],
        timestamp: new Date().toISOString(),
        candidateProjectionHash: "test",
        opportunityContentHash: "test"
      },
      esi: 0.3,
      diligenceStatus: "READY"
    };

    const mockSource: OpportunitySource = {
      jobHash: "test-pass",
      role: "Marketing Manager",
      company: "SmallCo",
      location: "Pune",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const effort = synthesizeEffort(mockRecord, mockSource);

    // Effort should not be justified for PASS
    expect(effort.effortJustified).toBe("no");
    // Statement should mention not warranted
    expect(effort.statement.toLowerCase()).toContain("not");
  });

  // Test 6: Missing capability data handled gracefully
  it("6: Missing capability gaps handled gracefully", () => {
    const mockRecord: RecommendationRecord = {
      jobHash: "test-missing",
      engineVersion: "4.3.0",
      recommendationVersion: "4.3.0:test",
      verb: "CONSIDER",
      rawScore: 60,
      priority: 60,
      vetoed: false,
      vetoReason: null,
      claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: [] },
      confidence: 0.7,
      factors: { pursuitFriction: 10 },
      evidenceGrounding: {},
      decisionSummary: { careerValue: 65, shortlistingPotential: 60, pursuitFriction: 10 },
      decisionDrivers: [],
      decisionRisks: [],
      confidences: { parsing: 0.8, matching: 0.7, recommendation: 0.7 },
      stability: "Medium",
      headspace: { finalVerb: "CONSIDER", downgraded: false },
      comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
      explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
      trace: {
        priority: 60,
        factors: { careerValue: 65, shortlistingPotential: 60, pursuitFriction: 10, tailoringEffort: "LOW" },
        verb0: "CONSIDER",
        finalVerb: "CONSIDER",
        confidence: 0.7,
        stability: "Medium",
        pipeline: [],
        evidenceMapping: [],
        careerValueBreakdown: { brandValue: 16, learningValue: 16, trajectoryValue: 16, riskMitigation: 12 },
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
      jobHash: "test-missing",
      role: "VP Marketing",
      company: "TestCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    // Should not throw
    expect(() => synthesizeEffort(mockRecord, mockSource)).not.toThrow();

    const effort = synthesizeEffort(mockRecord, mockSource);

    // Should provide some interpretation
    expect(effort.statement).toBeDefined();
    expect(effort.statement.length).toBeGreaterThan(0);
  });
});

// Edge case tests
describe("P2-A.4: Effort Edge Cases", () => {
  // Test format functions
  it("formatEffort returns statement", () => {
    const effort: EffortInterpretation = {
      statement: "Test effort interpretation",
      effortLevel: "moderate",
      timeEstimate: "4-6 hours",
      preparationRequired: ["Step 1", "Step 2"],
      effortJustified: "yes",
      frictionPoints: ["Gap 1"],
      evidence: [],
      confidence: 0.8
    };

    expect(formatEffort(effort)).toBe("Test effort interpretation");
  });

  it("formatEffortAction includes all components", () => {
    const effort: EffortInterpretation = {
      statement: "Test effort.",
      effortLevel: "moderate",
      timeEstimate: "4-6 hours",
      preparationRequired: ["Step 1", "Step 2"],
      validationNeeded: "Validate X",
      effortJustified: "yes",
      frictionPoints: [],
      evidence: [],
      confidence: 0.8
    };

    const formatted = formatEffortAction(effort);
    expect(formatted).toContain("Test effort.");
    expect(formatted).toContain("4-6 hours");
    expect(formatted).toContain("Step 1");
    expect(formatted).toContain("Validate X");
  });

  // Test effort indicator
  it("getEffortIndicator returns correct labels", async () => {
    const { getEffortIndicator } = await import("@/lib/intelligence/editorial/EffortSynthesizer");

    const high: EffortInterpretation = {
      statement: "High",
      effortLevel: "high",
      timeEstimate: "",
      preparationRequired: [],
      effortJustified: "marginal",
      frictionPoints: [],
      evidence: [],
      confidence: 0.7
    };
    expect(getEffortIndicator(high).label).toBe("High Effort");
    expect(getEffortIndicator(high).color).toBe("red");

    const moderate: EffortInterpretation = {
      statement: "Moderate",
      effortLevel: "moderate",
      timeEstimate: "",
      preparationRequired: [],
      effortJustified: "yes",
      frictionPoints: [],
      evidence: [],
      confidence: 0.8
    };
    expect(getEffortIndicator(moderate).label).toBe("Moderate Effort");
    expect(getEffortIndicator(moderate).color).toBe("amber");

    const low: EffortInterpretation = {
      statement: "Low",
      effortLevel: "low",
      timeEstimate: "",
      preparationRequired: [],
      effortJustified: "yes",
      frictionPoints: [],
      evidence: [],
      confidence: 0.85
    };
    expect(getEffortIndicator(low).label).toBe("Low Effort");
    expect(getEffortIndicator(low).color).toBe("green");
  });
});
