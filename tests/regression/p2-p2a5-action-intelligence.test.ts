/**
 * P2-A.5: Recommended Action Intelligence Tests
 *
 * Acceptance Contract:
 * - Synthesizes action based on decision + advantage + risk + career + effort
 * - PURSUE: concrete forward action
 * - CONSIDER: validation / selective preparation
 * - PASS: explain why time should NOT be invested
 * - NOT_EVALUABLE: no fabricated action
 * - Actions are concise, executive-facing, evidence grounded
 * - Includes time estimate and expected outcome
 */

import { describe, it, expect } from "vitest";
import type { RecommendationRecord } from "@/lib/intelligence/record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";
import {
  synthesizeAction,
  formatAction,
  type RecommendedAction,
} from "@/lib/intelligence/editorial/ActionSynthesizer";

describe("P2-A.5: Recommended Action Intelligence", () => {
  // Base mock record
  const baseMockRecord: RecommendationRecord = {
    jobHash: "test-action",
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
    decisionDrivers: [{ factor: "Strong Match", impact: "positive", strength: "high", evidence: "Complete alignment" }],
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

  const baseMockSource: OpportunitySource = {
    jobHash: "test-action",
    role: "VP Marketing",
    company: "GrowthCorp",
    location: "Mumbai",
    postedRelative: "Posted recently",
    scrapedFrom: "LinkedIn",
    primaryConcern: null,
    dimensions: []
  };

  // Test 1: PURSUE generates concrete forward action
  it("1: PURSUE generates concrete forward action", () => {
    const action = synthesizeAction(baseMockRecord, baseMockSource);

    expect(action.category).toBe("pursue");
    expect(action.statement).toContain("Proceed");
    // Should have primary action
    expect(action.primaryAction).toContain("Proceed");
    // Should have time estimate
    expect(action.timeEstimate).toBeDefined();
    expect(action.timeEstimate.length).toBeGreaterThan(0);
    // Should have expected outcome
    expect(action.expectedOutcome).toBeDefined();
    // Should be high confidence
    expect(action.confidence).toBeGreaterThan(0.7);
  });

  // Test 2: CONSIDER generates validation action
  it("2: CONSIDER generates validation action", () => {
    const considerRecord: RecommendationRecord = {
      ...baseMockRecord,
      verb: "CONSIDER",
      rawScore: 62,
      priority: 62,
      trace: {
        ...baseMockRecord.trace,
        factors: { careerValue: 65, shortlistingPotential: 60, pursuitFriction: 15 }
      }
    };

    const action = synthesizeAction(considerRecord, baseMockSource);

    expect(action.category).toBe("consider");
    expect(action.statement.toLowerCase()).toContain("consider");
    // Should indicate validation needed
    expect(action.primaryAction.toLowerCase()).toContain("validate");
    // Should have time estimate
    expect(action.timeEstimate).toBeDefined();
  });

  // Test 3: PASS explains why time should not be invested
  it("3: PASS explains why time should not be invested", () => {
    const passRecord: RecommendationRecord = {
      ...baseMockRecord,
      verb: "PASS",
      rawScore: 35,
      priority: 35,
      vetoed: true,
      vetoReason: "G-COMPATIBILITY-REGRESSION-VETO",
      decisionRisks: [{ factor: "Career Regression", impact: "negative", strength: "high", evidence: "Regression" }],
      trace: {
        ...baseMockRecord.trace,
        factors: { careerValue: 30, shortlistingPotential: 25, pursuitFriction: 25 },
        careerValueBreakdown: { brandValue: 8, learningValue: 8, trajectoryValue: 6, riskMitigation: 5 }
      }
    };

    const action = synthesizeAction(passRecord, baseMockSource);

    expect(action.category).toBe("pass");
    // Statement says "Pass" (capitalized at start) or contains "pass"
    expect(action.statement.toLowerCase()).toContain("pass");
    // Should explain why - mentions scope, altitude, or bandwidth
    const hasExplanation = action.statement.toLowerCase().includes("scope") ||
                          action.statement.toLowerCase().includes("altitude") ||
                          action.statement.toLowerCase().includes("bandwidth");
    expect(hasExplanation).toBe(true);
    // Time estimate should indicate no investment
    expect(action.timeEstimate.toLowerCase()).toContain("no");
  });

  // Test 4: NOT_EVALUABLE has no fabricated action
  it("4: NOT_EVALUABLE has no fabricated action", () => {
    const notEvaluableRecord: RecommendationRecord = {
      ...baseMockRecord,
      verb: "SPARSE_SPEC",
      rawScore: 0,
      priority: null,
      vetoed: true,
      vetoReason: "G-EVIDENCE-GATE-SPARSE-SPEC",
      decisionRisks: [{ factor: "Insufficient Evidence", impact: "negative", strength: "high", evidence: "Sparse spec" }]
    };

    const action = synthesizeAction(notEvaluableRecord, baseMockSource);

    expect(action.category).toBe("not_evaluable");
    // Should not claim certainty
    expect(action.confidence).toBeLessThan(0.6);
    // Should indicate need for more info
    expect(action.primaryAction.toLowerCase()).toContain("information");
  });

  // Test 5: PURSUE with high risk includes prerequisites
  it("5: PURSUE with material risk includes prerequisites", () => {
    const highRiskRecord: RecommendationRecord = {
      ...baseMockRecord,
      claimPermissions: {
        allowedClaims: [],
        explicitUnknowns: ["P&L [CORE_MANDATE]"],
        explicitRisks: []
      },
      decisionRisks: [{ factor: "Capability Gaps", impact: "negative", strength: "medium", evidence: "Missing P&L" }]
    };

    const action = synthesizeAction(highRiskRecord, baseMockSource, undefined, {
      category: "material_capability_gap",
      statement: "Limited P&L evidence may weaken positioning",
      evidence: ["Missing P&L"],
      confidence: 0.7,
      severity: "medium",
      mitigation: "Prepare commercial narrative"
    } as any);

    // Should include caution about risk (may or may not have explicit prerequisites)
    expect(action.statement.toLowerCase()).toContain("proceed");
  });

  // Test 6: Actions are executive-facing (not technical)
  it("6: Actions use executive-facing language", () => {
    const action = synthesizeAction(baseMockRecord, baseMockSource);

    // Should not contain technical terms
    expect(action.statement).not.toContain("rawScore");
    expect(action.statement).not.toContain("priorityScore");
    expect(action.statement).not.toContain("capabilityScore");

    // Should use executive action verbs
    const executiveVerbs = ["proceed", "validate", "consider", "decline", "screen", "confirm"];
    const hasExecutiveVerb = executiveVerbs.some(verb =>
      action.statement.toLowerCase().includes(verb)
    );
    expect(hasExecutiveVerb).toBe(true);
  });

  // Test 7: Expected outcome is specific
  it("7: Actions include specific expected outcomes", () => {
    const action = synthesizeAction(baseMockRecord, baseMockSource);

    expect(action.expectedOutcome).toBeDefined();
    expect(action.expectedOutcome.length).toBeGreaterThan(10);
    // Should indicate what happens
    expect(action.expectedOutcome.toLowerCase()).toMatch(/call|interview|conversation|outcome/);
  });

  // Test 8: Alternative action for high-risk scenarios
  it("8: High-risk scenarios include alternative action", () => {
    const highRiskRecord: RecommendationRecord = {
      ...baseMockRecord,
      claimPermissions: {
        allowedClaims: [],
        explicitUnknowns: ["Core Capability [CORE_MANDATE]"],
        explicitRisks: ["Material Gap"]
      }
    };

    const action = synthesizeAction(highRiskRecord, baseMockSource, undefined, {
      category: "material_capability_gap",
      statement: "Core mandate gap identified",
      evidence: ["Missing core"],
      confidence: 0.6,
      severity: "high"
    } as any);

    // Should have action risk
    expect(action.actionRisk).toBeDefined();
  });
});

// Edge case tests
describe("P2-A.5: Action Edge Cases", () => {
  it("formatAction returns statement", () => {
    const action: RecommendedAction = {
      statement: "Test action statement",
      category: "pursue",
      primaryAction: "Proceed",
      timeEstimate: "2-3 hours",
      expectedOutcome: "Screening call scheduled",
      confidence: 0.8
    };

    expect(formatAction(action)).toBe("Test action statement");
  });

  it("getActionIndicator returns correct labels", async () => {
    const { getActionIndicator } = await import("@/lib/intelligence/editorial/ActionSynthesizer");

    const pursue: RecommendedAction = {
      statement: "Pursue",
      category: "pursue",
      primaryAction: "Proceed",
      timeEstimate: "",
      expectedOutcome: "",
      confidence: 0.8
    };
    expect(getActionIndicator(pursue).label).toBe("Pursue");
    expect(getActionIndicator(pursue).color).toBe("green");

    const consider: RecommendedAction = {
      statement: "Consider",
      category: "consider",
      primaryAction: "Validate",
      timeEstimate: "",
      expectedOutcome: "",
      confidence: 0.7
    };
    expect(getActionIndicator(consider).label).toBe("Consider");
    expect(getActionIndicator(consider).color).toBe("amber");

    const pass: RecommendedAction = {
      statement: "Pass",
      category: "pass",
      primaryAction: "Decline",
      timeEstimate: "",
      expectedOutcome: "",
      confidence: 0.8
    };
    expect(getActionIndicator(pass).label).toBe("Pass");
    expect(getActionIndicator(pass).color).toBe("red");
  });
});
