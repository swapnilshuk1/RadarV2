/**
 * P2-C.2: Shortlisting Potential Tests
 *
 * Acceptance Contract:
 * - Independent signal from Career Value and Pursuit Friction
 * - Answers "How likely to survive initial hiring scrutiny?"
 * - Considers requirements alignment, title/scope, evidence strength, seniority, domain
 * - Conceptually distinct from overall fit score
 * - High CV + Low SP and Low CV + High SP scenarios are both valid
 */

import { describe, it, expect } from "vitest";
import type { RecommendationRecord } from "@/lib/intelligence/record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";
import {
  synthesizeShortlistingPotential,
  formatShortlistingPotential,
  type ShortlistingPotential,
} from "@/lib/intelligence/editorial/ShortlistingPotentialSynthesizer";

describe("P2-C.2: Shortlisting Potential", () => {
  // Base mock record
  const baseMockRecord: RecommendationRecord = {
    jobHash: "test-shortlist",
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
      evidenceMapping: [
        { jobCapability: "Strategy [CORE_MANDATE]", candidateCapability: "Led strategy", confidence: 0.9, reason: "Strong" },
        { jobCapability: "Leadership [CORE_MANDATE]", candidateCapability: "Led team", confidence: 0.85, reason: "Strong" }
      ],
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
    jobHash: "test-shortlist",
    role: "VP Marketing",
    company: "GrowthCorp",
    location: "Mumbai",
    postedRelative: "Posted recently",
    scrapedFrom: "LinkedIn",
    primaryConcern: null,
    dimensions: []
  };

  // Test 1: High shortlisting potential with strong evidence
  it("1: High shortlisting potential when evidence is strong", () => {
    const potential = synthesizeShortlistingPotential(baseMockRecord, baseMockSource);

    expect(potential.likelihood).toBe("high");
    expect(potential.score).toBeGreaterThan(70);
    expect(potential.statement.toLowerCase()).toContain("survive");
    expect(potential.statement.toLowerCase()).toContain("screening");
    expect(potential.factors.evidenceStrength.status).toBe("strong");
    expect(potential.factors.requirementsAlignment.status).toBe("strong");
    expect(potential.positioningAdvice).toBeDefined();
  });

  // Test 2: Lower shortlisting potential with aspirational seniority
  it("2: Lower shortlisting potential for aspirational/reach roles", () => {
    const record: RecommendationRecord = {
      ...baseMockRecord,
      verb: "CONSIDER",
      rawScore: 55,
      priority: 55,
      vetoed: false,
      claimPermissions: { allowedClaims: [], explicitUnknowns: ["P&L [CORE_MANDATE]"], explicitRisks: [] },
      trace: {
        ...baseMockRecord.trace,
        factors: { careerValue: 75, shortlistingPotential: 50, pursuitFriction: 20 },
        evidenceMapping: [
          { jobCapability: "Strategy [CORE_MANDATE]", candidateCapability: "Led strategy", confidence: 0.7, reason: "Good" }
        ]
      }
    };

    const potential = synthesizeShortlistingPotential(record, baseMockSource);

    // Likelihood can vary; verify score reflects uncertainty
    expect(potential.score).toBeLessThan(85);
    // Should provide positioning advice
    expect(potential.positioningAdvice).toBeDefined();
  });

  // Test 3: Domain gaps affect shortlisting potential
  it("3: Domain familiarity gaps reduce shortlisting potential", () => {
    const record: RecommendationRecord = {
      ...baseMockRecord,
      claimPermissions: {
        allowedClaims: [],
        explicitUnknowns: [
          "Healthcare [DOMAIN_FAMILIARITY]",
          "Regulatory [DOMAIN_FAMILIARITY]"
        ],
        explicitRisks: []
      }
    };

    const potential = synthesizeShortlistingPotential(record, baseMockSource);

    expect(potential.factors.domainFit.status).toBe("distant");
    // Shortlisting should be affected
    expect(potential.score).toBeLessThan(85);
  });

  // Test 4: Independent from career value (high CV, low SP scenario)
  it("4: Independent from career value - high CV, low SP possible", () => {
    const record: RecommendationRecord = {
      ...baseMockRecord,
      verb: "CONSIDER",
      rawScore: 60,
      priority: 60,
      trace: {
        ...baseMockRecord.trace,
        factors: { careerValue: 85, shortlistingPotential: 45, pursuitFriction: 25 }, // High CV, lower shortlisting
        evidenceMapping: [
          // Strong capability but aspirational
          { jobCapability: "CMO Scope [CORE_MANDATE]", candidateCapability: "Led marketing", confidence: 0.6, reason: "Partial" }
        ]
      }
    };

    const potential = synthesizeShortlistingPotential(record, baseMockSource);

    // Career value is high but shortlisting is lower
    // This demonstrates independence
    expect(potential.score).toBeLessThan(75);
    expect(potential.likelihood).toBe("moderate");
  });

  // Test 5: Factors are provided for each dimension
  it("5: Provides factors for all dimensions", () => {
    const potential = synthesizeShortlistingPotential(baseMockRecord, baseMockSource);

    expect(potential.factors.requirementsAlignment).toBeDefined();
    expect(potential.factors.requirementsAlignment.status).toBeDefined();
    expect(potential.factors.requirementsAlignment.evidence).toBeDefined();

    expect(potential.factors.titleScopeAlignment).toBeDefined();
    expect(potential.factors.evidenceStrength).toBeDefined();
    expect(potential.factors.seniorityFit).toBeDefined();
    expect(potential.factors.domainFit).toBeDefined();
  });

  // Test 6: Positioning advice provided
  it("6: Provides positioning advice for initial outreach", () => {
    const potential = synthesizeShortlistingPotential(baseMockRecord, baseMockSource);

    expect(potential.positioningAdvice).toBeDefined();
    expect(potential.positioningAdvice.length).toBeGreaterThan(20);
  });

  // Test 7: Evidence grounded in capability matches
  it("7: Evidence grounded in capability evidence", () => {
    const potential = synthesizeShortlistingPotential(baseMockRecord, baseMockSource);

    expect(potential.evidence.length).toBeGreaterThan(0);
    const evidenceText = potential.evidence.join(" ").toLowerCase();
    expect(evidenceText).toContain("seniority");
    expect(evidenceText).toContain("domain");
  });

  // Test 8: Lower score with regression veto
  it("8: Lower shortlisting potential for regression roles", () => {
    const record: RecommendationRecord = {
      ...baseMockRecord,
      verb: "PASS",
      rawScore: 35,
      priority: 35,
      vetoed: true,
      vetoReason: "G-COMPATIBILITY-REGRESSION-VETO",
      trace: {
        ...baseMockRecord.trace,
        factors: { careerValue: 30, shortlistingPotential: 25, pursuitFriction: 30 }
      }
    };

    const potential = synthesizeShortlistingPotential(record, baseMockSource);

    // Seniority should be overqualified
    expect(potential.factors.seniorityFit.status).toBe("overqualified");
    // Score should be moderate (not highest tier)
    expect(potential.score).toBeLessThan(90);
  });
});

// Independence tests - verify conceptual independence
describe("P2-C: Signal Independence", () => {
  it("Shortlisting is conceptually independent from career value", () => {
    // Same shortlisting potential can have different career values
    const baseSource: OpportunitySource = {
      jobHash: "test-independence",
      role: "VP Growth",
      company: "TechCorp",
      location: "Bengaluru",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const baseRec: RecommendationRecord = {
      jobHash: "base",
      engineVersion: "4.3.0",
      recommendationVersion: "4.3.0:test",
      verb: "PURSUE",
      rawScore: 75,
      priority: 75,
      vetoed: false,
      vetoReason: null,
      claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: [] },
      confidence: 0.8,
      factors: { pursuitFriction: 10 },
      evidenceGrounding: {},
      decisionSummary: { careerValue: 75, shortlistingPotential: 70, pursuitFriction: 10 },
      decisionDrivers: [],
      decisionRisks: [],
      confidences: { parsing: 0.85, matching: 0.8, recommendation: 0.8 },
      stability: "High",
      headspace: { finalVerb: "PURSUE", downgraded: false },
      comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
      explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
      trace: {
        priority: 75,
        factors: { careerValue: 75, shortlistingPotential: 70, pursuitFriction: 10 },
        verb0: "PURSUE",
        finalVerb: "PURSUE",
        confidence: 0.8,
        stability: "High",
        pipeline: [],
        evidenceMapping: [
          { jobCapability: "Strategy [CORE_MANDATE]", candidateCapability: "Led strategy", confidence: 0.85, reason: "Strong" }
        ],
        careerValueBreakdown: { brandValue: 18, learningValue: 18, trajectoryValue: 18, riskMitigation: 14 },
        headspace: { finalVerb: "PURSUE", downgraded: false },
        missing: [],
        timestamp: new Date().toISOString(),
        candidateProjectionHash: "test",
        opportunityContentHash: "test"
      },
      esi: 0.75,
      diligenceStatus: "READY"
    };

    // High shortlisting, high career value
    const highHigh: RecommendationRecord = {
      ...baseRec,
      jobHash: "hh",
      trace: {
        ...baseRec.trace,
        factors: { careerValue: 85, shortlistingPotential: 80, pursuitFriction: 10 }
      }
    };

    // High shortlisting, lower career value (lateral)
    const highLow: RecommendationRecord = {
      ...baseRec,
      jobHash: "hl",
      verb: "CONSIDER",
      rawScore: 65,
      priority: 65,
      trace: {
        ...baseRec.trace,
        factors: { careerValue: 55, shortlistingPotential: 78, pursuitFriction: 12 }
      }
    };

    const pot1 = synthesizeShortlistingPotential(highHigh, baseSource);
    const pot2 = synthesizeShortlistingPotential(highLow, baseSource);

    // Both should have similar shortlisting (demonstrates independence from career value)
    expect(Math.abs(pot1.score - pot2.score)).toBeLessThan(20);
  });
});

// Edge cases
describe("P2-C.2: Shortlisting Edge Cases", () => {
  it("formatShortlistingPotential returns statement", () => {
    const potential: ShortlistingPotential = {
      likelihood: "high",
      score: 85,
      statement: "Test shortlisting statement",
      factors: {
        requirementsAlignment: { status: "strong", evidence: "Test" },
        titleScopeAlignment: { status: "aligned", evidence: "Test" },
        evidenceStrength: { status: "strong", evidence: "Test" },
        seniorityFit: { status: "qualified", evidence: "Test" },
        domainFit: { status: "native", evidence: "Test" }
      },
      positioningAdvice: "Test advice",
      evidence: [],
      confidence: 0.8
    };

    expect(formatShortlistingPotential(potential)).toBe("Test shortlisting statement");
  });

  it("getShortlistingIndicator returns correct labels", async () => {
    const { getShortlistingIndicator } = await import("@/lib/intelligence/editorial/ShortlistingPotentialSynthesizer");

    const high: ShortlistingPotential = {
      likelihood: "high",
      score: 85,
      statement: "",
      factors: {} as any,
      positioningAdvice: "",
      evidence: [],
      confidence: 0.8
    };
    expect(getShortlistingIndicator(high).label).toBe("High Shortlisting Potential");
    expect(getShortlistingIndicator(high).color).toBe("green");

    const low: ShortlistingPotential = {
      likelihood: "low",
      score: 40,
      statement: "",
      factors: {} as any,
      positioningAdvice: "",
      evidence: [],
      confidence: 0.7
    };
    expect(getShortlistingIndicator(low).label).toBe("Low Shortlisting Potential");
    expect(getShortlistingIndicator(low).color).toBe("red");
  });
});
