import { describe, it, expect } from "vitest";
import { QualityScoreCalculator } from "../../src/lib/intelligence/policy/QualityScoreCalculator";
import { DecisionPolicyEngine } from "../../src/lib/intelligence/policy/DecisionPolicyEngine";
import type { 
  IdentityAssessment, 
  CapabilityAssessment, 
  OpportunityAssessment, 
  CareerAssessment, 
  LifestyleAssessment 
} from "../../src/domain/semantic";

const dummyIdentity: IdentityAssessment = {
  status: "EVALUATED",
  verdict: "MATCH",
  coverage: 0.95,
  vectorSimilarity: 0.95,
  evidenceCount: 5,
  matchedKeywords: ["Commercial", "Leadership"]
};

const dummyCapability: CapabilityAssessment = {
  status: "EVALUATED",
  sufficiency: "SUFFICIENT",
  overallFit: 0.80,
  matchingConfidence: 0.90,
  evidenceCount: 6,
  matchedCapabilities: ["P&L", "GTM"],
  missingCapabilities: []
};

const dummyOpportunity: OpportunityAssessment = {
  status: "EVALUATED",
  mandateSeniority: "EXECUTIVE",
  opportunityScore: 85
};

const dummyCareer: CareerAssessment = {
  status: "EVALUATED",
  trajectory: "FORWARD",
  careerScore: 90,
  regressionScore: 10
};

const dummyLifestyle: LifestyleAssessment = {
  status: "EVALUATED",
  locationFrictionPenalty: 5
};

const sampleJD = "A comprehensive executive leadership posting for Vice President of Commercial Growth overseeing P&L scale and team expansion.";

describe("Model C Quality Architecture Tests", () => {
  it("Test 1: Identity-ineligible (distance >= 0.80) -> qualityScore = null", () => {
    const res = QualityScoreCalculator.calculate({
      identityDistance: 0.85,
      identity: dummyIdentity,
      capability: dummyCapability,
      career: dummyCareer,
      opportunity: dummyOpportunity,
      isSparseSpec: false,
      criticalFailed: false
    });
    expect(res.qualityScore).toBeNull();
  });

  it("Test 2: Eligible opportunity produces numeric qualityScore [0-100]", () => {
    const res = QualityScoreCalculator.calculate({
      identityDistance: 0.10,
      identity: dummyIdentity,
      capability: dummyCapability,
      career: dummyCareer,
      opportunity: dummyOpportunity,
      isSparseSpec: false,
      criticalFailed: false
    });
    expect(typeof res.qualityScore).toBe("number");
    expect(res.qualityScore).toBeGreaterThanOrEqual(0);
    expect(res.qualityScore).toBeLessThanOrEqual(100);
  });

  it("Test 3: Formula exact calculation check (Career 6/13, Capability 3/13, Opportunity 4/13)", () => {
    const res = QualityScoreCalculator.calculate({
      identityDistance: 0.10,
      identity: dummyIdentity,
      capability: dummyCapability,
      career: dummyCareer,
      opportunity: dummyOpportunity,
      isSparseSpec: false,
      criticalFailed: false
    });
    const expectedQuality = Math.round((6/13)*90 + (3/13)*80 + (4/13)*85);
    expect(res.qualityScore).toBe(expectedQuality);
  });

  it("Test 4: Identity score contributes 0% to qualityScore", () => {
    const resBase = QualityScoreCalculator.calculate({
      identityDistance: 0.10,
      identity: dummyIdentity,
      capability: dummyCapability,
      career: dummyCareer,
      opportunity: dummyOpportunity,
      isSparseSpec: false,
      criticalFailed: false
    });
    const dummyIdentityLowCoverage: IdentityAssessment = { ...dummyIdentity, coverage: 0.20 };
    const res = QualityScoreCalculator.calculate({
      identityDistance: 0.10,
      identity: dummyIdentityLowCoverage,
      capability: dummyCapability,
      career: dummyCareer,
      opportunity: dummyOpportunity,
      isSparseSpec: false,
      criticalFailed: false
    });
    expect(res.qualityScore).toBe(resBase.qualityScore);
  });

  it("Test 5: Pursuit friction contributes 0% to qualityScore", () => {
    const resA = DecisionPolicyEngine.evaluate(
      dummyIdentity,
      dummyCapability,
      dummyOpportunity,
      dummyCareer,
      { locationFrictionPenalty: 5 } as any,
      "Commercial Leadership",
      "Commercial Leadership",
      sampleJD,
      true
    );
    const resB = DecisionPolicyEngine.evaluate(
      dummyIdentity,
      dummyCapability,
      dummyOpportunity,
      dummyCareer,
      { locationFrictionPenalty: 35 } as any,
      "Commercial Leadership",
      "Commercial Leadership",
      sampleJD,
      true
    );
    expect(resA.qualityScore).toBe(resB.qualityScore);
  });

  it("Test 6: Decision does not mutate qualityScore", () => {
    const expectedQuality = Math.round((6/13)*90 + (3/13)*80 + (4/13)*85);
    const res = DecisionPolicyEngine.evaluate(
      dummyIdentity,
      dummyCapability,
      dummyOpportunity,
      dummyCareer,
      { locationFrictionPenalty: 5 } as any,
      "Commercial Leadership",
      "Commercial Leadership",
      sampleJD,
      true
    );
    expect(res.qualityScore).toBe(expectedQuality);
  });

  it("Test 7: PASS opportunity retains numeric qualityScore", () => {
    const lowCareer: CareerAssessment = { ...dummyCareer, careerScore: 30 };
    const res = DecisionPolicyEngine.evaluate(
      dummyIdentity,
      { ...dummyCapability, overallFit: 0.40 },
      { ...dummyOpportunity, opportunityScore: 40 },
      lowCareer,
      dummyLifestyle,
      "Commercial Leadership",
      "Commercial Leadership",
      sampleJD,
      true
    );
    expect(res.verdict).toBe("PASS");
    expect(typeof res.qualityScore).toBe("number");
  });

  it("Test 8: SPARSE_SPEC -> qualityScore = null", () => {
    const res = DecisionPolicyEngine.evaluate(
      dummyIdentity,
      dummyCapability,
      dummyOpportunity,
      dummyCareer,
      dummyLifestyle,
      "Commercial Leadership",
      "Commercial Leadership",
      "Short text",
      false
    );
    expect(res.verdict).toBe("SPARSE_SPEC");
    expect(res.qualityScore).toBeNull();
  });

  it("Test 9: Sub-tier veto retains numeric qualityScore", () => {
    const subTierOpportunity: OpportunityAssessment = { ...dummyOpportunity, mandateSeniority: "SUB_TIER" };
    const res = DecisionPolicyEngine.evaluate(
      dummyIdentity,
      dummyCapability,
      subTierOpportunity,
      dummyCareer,
      dummyLifestyle,
      "Commercial Leadership",
      "Commercial Leadership",
      sampleJD,
      true
    );
    expect(res.vetoed).toBe(true);
    expect(res.vetoReason).toBe("G-SUB-TIER-MANDATE-VETO");
    expect(typeof res.qualityScore).toBe("number");
  });

  it("Test 10: qualityScore consistent across rawScore and priorityScore", () => {
    const res = DecisionPolicyEngine.evaluate(
      dummyIdentity,
      dummyCapability,
      dummyOpportunity,
      dummyCareer,
      { locationFrictionPenalty: 5 } as any,
      "Commercial Leadership",
      "Commercial Leadership",
      sampleJD,
      true
    );
    expect(res.qualityScore).toBe(res.rawScore);
    expect(res.qualityScore).toBe(res.priorityScore);
  });

  it("Test 11: Single authoritative QualityScoreCalculator matches DecisionPolicyEngine output", () => {
    const calcDirect = QualityScoreCalculator.calculate({
      identityDistance: 0.10,
      identity: dummyIdentity,
      capability: dummyCapability,
      career: dummyCareer,
      opportunity: dummyOpportunity,
      isSparseSpec: false,
      criticalFailed: false
    });
    const res = DecisionPolicyEngine.evaluate(
      dummyIdentity,
      dummyCapability,
      dummyOpportunity,
      dummyCareer,
      { locationFrictionPenalty: 5 } as any,
      "Commercial Leadership",
      "Commercial Leadership",
      sampleJD,
      true
    );
    expect(calcDirect.qualityScore).toBe(res.qualityScore);
  });

  it("Test 12: priorityScore equals qualityScore (not independent)", () => {
    const res = DecisionPolicyEngine.evaluate(
      dummyIdentity,
      dummyCapability,
      dummyOpportunity,
      dummyCareer,
      { locationFrictionPenalty: 5 } as any,
      "Commercial Leadership",
      "Commercial Leadership",
      sampleJD,
      true
    );
    expect(res.priorityScore).toBe(res.qualityScore);
  });

  it("Test 13: NULL remains NULL throughout canonical policy result", () => {
    const res = DecisionPolicyEngine.evaluate(
      dummyIdentity,
      dummyCapability,
      dummyOpportunity,
      dummyCareer,
      dummyLifestyle,
      "Commercial Leadership",
      "Commercial Leadership",
      "Short text",
      false
    );
    expect(res.qualityScore).toBeNull();
    expect(res.rawScore).toBeNull();
    expect(res.priorityScore).toBeNull();
  });

  it("Test 14: Easy Trap career value protection preserved", () => {
    const easyTrapCareer: CareerAssessment = { ...dummyCareer, careerScore: 40 };
    const res = DecisionPolicyEngine.evaluate(
      dummyIdentity,
      { ...dummyCapability, overallFit: 0.95 },
      { ...dummyOpportunity, opportunityScore: 95 },
      easyTrapCareer,
      { locationFrictionPenalty: 2 },
      "Commercial Leadership",
      "Commercial Leadership",
      sampleJD,
      true,
      undefined,
      undefined,
      85
    );
    expect(res.verdict).toBe("CONSIDER");
    expect(res.triggeredRuleIds).toContain("R-CONSIDER-CAREER-VALUE-PROTECTION");
  });

  it("source-grounded specialist-domain gap constrains PURSUE to CONSIDER without changing the score", () => {
    const baseline = DecisionPolicyEngine.evaluate(
      dummyIdentity,
      dummyCapability,
      dummyOpportunity,
      dummyCareer,
      dummyLifestyle,
      "Commercial & Marketing Leadership",
      "Commercial & Marketing Leadership",
      "Lead distressed debt acquisition, NPA portfolios, SARFAESI and ARC business development.",
      true,
      undefined,
      undefined,
      85,
    );
    const res = DecisionPolicyEngine.evaluate(
      dummyIdentity,
      { ...dummyCapability, missingCapabilities: ["Distressed Debt / ARC Operations [DOMAIN_FAMILIARITY]"] },
      dummyOpportunity,
      dummyCareer,
      dummyLifestyle,
      "Commercial & Marketing Leadership",
      "Commercial & Marketing Leadership",
      "Lead distressed debt acquisition, NPA portfolios, SARFAESI and ARC business development.",
      true,
      undefined,
      undefined,
      85,
    );
    expect(res.verdict).toBe("CONSIDER");
    expect(res.qualityScore).toBe(baseline.qualityScore);
    expect(res.triggeredRuleIds).toContain("POL-D-CONSIDER-SPECIALIST-DOMAIN-GAP");
  });
});
