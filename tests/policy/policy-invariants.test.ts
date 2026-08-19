import { describe, it, expect } from "vitest";
import { DecisionPolicyEngine, POLICY_THRESHOLDS } from "../../src/lib/intelligence/policy/DecisionPolicyEngine";
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

describe("Policy D Boundary Invariant Tests", () => {
  it("1. Quality 65 + SP 50 + Friction 15 -> PURSUE", () => {
    const res = DecisionPolicyEngine.evaluate(
      dummyIdentity,
      { ...dummyCapability, overallFit: 0.65 },
      { ...dummyOpportunity, opportunityScore: 65 },
      { ...dummyCareer, careerScore: 65 },
      { locationFrictionPenalty: 15 } as any,
      "Commercial Leadership",
      "Commercial Leadership",
      sampleJD,
      true,
      undefined,
      undefined,
      50
    );
    expect(res.qualityScore).toBe(65);
    expect(res.verdict).toBe("PURSUE");
  });

  it("2. Quality < 65 -> not PURSUE", () => {
    const res = DecisionPolicyEngine.evaluate(
      dummyIdentity,
      { ...dummyCapability, overallFit: 0.64 },
      { ...dummyOpportunity, opportunityScore: 64 },
      { ...dummyCareer, careerScore: 64 },
      { locationFrictionPenalty: 15 } as any,
      "Commercial Leadership",
      "Commercial Leadership",
      sampleJD,
      true,
      undefined,
      undefined,
      50
    );
    expect(res.qualityScore!).toBeLessThan(65);
    expect(res.verdict).not.toBe("PURSUE");
  });

  it("3. Quality 55 + Friction 25 -> CONSIDER", () => {
    const res = DecisionPolicyEngine.evaluate(
      dummyIdentity,
      { ...dummyCapability, overallFit: 0.55 },
      { ...dummyOpportunity, opportunityScore: 55 },
      { ...dummyCareer, careerScore: 55 },
      { locationFrictionPenalty: 25 } as any,
      "Commercial Leadership",
      "Commercial Leadership",
      sampleJD,
      true,
      undefined,
      undefined,
      50
    );
    expect(res.qualityScore).toBe(55);
    expect(res.verdict).toBe("CONSIDER");
  });

  it("4. Quality < 55 -> PASS", () => {
    const res = DecisionPolicyEngine.evaluate(
      dummyIdentity,
      { ...dummyCapability, overallFit: 0.54 },
      { ...dummyOpportunity, opportunityScore: 54 },
      { ...dummyCareer, careerScore: 54 },
      { locationFrictionPenalty: 25 } as any,
      "Commercial Leadership",
      "Commercial Leadership",
      sampleJD,
      true,
      undefined,
      undefined,
      50
    );
    expect(res.qualityScore!).toBeLessThan(55);
    expect(res.verdict).toBe("PASS");
  });

  it("5. SP < 50 blocks PURSUE -> CONSIDER", () => {
    const res = DecisionPolicyEngine.evaluate(
      dummyIdentity,
      dummyCapability,
      dummyOpportunity,
      dummyCareer,
      { locationFrictionPenalty: 5 } as any,
      "Commercial Leadership",
      "Commercial Leadership",
      sampleJD,
      true,
      undefined,
      undefined,
      45
    );
    expect(res.qualityScore!).toBeGreaterThanOrEqual(65);
    expect(res.verdict).toBe("CONSIDER");
  });

  it("6. Friction > 15 blocks PURSUE -> CONSIDER", () => {
    const res = DecisionPolicyEngine.evaluate(
      dummyIdentity,
      dummyCapability,
      dummyOpportunity,
      dummyCareer,
      { locationFrictionPenalty: 18 } as any,
      "Commercial Leadership",
      "Commercial Leadership",
      sampleJD,
      true,
      undefined,
      undefined,
      80
    );
    expect(res.qualityScore!).toBeGreaterThanOrEqual(65);
    expect(res.verdict).toBe("CONSIDER");
  });

  it("7. Friction > 25 blocks CONSIDER -> PASS", () => {
    const res = DecisionPolicyEngine.evaluate(
      dummyIdentity,
      dummyCapability,
      dummyOpportunity,
      dummyCareer,
      { locationFrictionPenalty: 28 } as any,
      "Commercial Leadership",
      "Commercial Leadership",
      sampleJD,
      true,
      undefined,
      undefined,
      80
    );
    expect(res.qualityScore!).toBeGreaterThanOrEqual(65);
    expect(res.verdict).toBe("PASS");
  });

  it("8. Easy Trap overrides PURSUE -> CONSIDER", () => {
    const res = DecisionPolicyEngine.evaluate(
      dummyIdentity,
      { ...dummyCapability, overallFit: 0.90 },
      { ...dummyOpportunity, opportunityScore: 90 },
      { ...dummyCareer, careerScore: 45 },
      { locationFrictionPenalty: 5 } as any,
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

  it("9. Hard veto overrides quality and SP", () => {
    const res = DecisionPolicyEngine.evaluate(
      dummyIdentity,
      dummyCapability,
      dummyOpportunity,
      dummyCareer,
      dummyLifestyle,
      "Software Engineering",
      "Commercial Leadership",
      sampleJD,
      true,
      undefined,
      undefined,
      90
    );
    expect(res.verdict).toBe("PASS");
    expect(res.vetoed).toBe(true);
    expect(res.vetoReason).toBe("G-EXECUTIVE-IDENTITY-MISMATCH");
  });

  it("10. SPARSE_SPEC remains N/A", () => {
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

  it("11. NOT_EVALUABLE remains N/A", () => {
    const res = DecisionPolicyEngine.evaluate(
      { ...dummyIdentity, status: "FAILED", failureCode: "MISSING_EVIDENCE" },
      dummyCapability,
      dummyOpportunity,
      dummyCareer,
      dummyLifestyle,
      "Commercial Leadership",
      "Commercial Leadership",
      sampleJD,
      true
    );
    expect(res.verdict).toBe("NOT_EVALUABLE");
    expect(res.qualityScore).toBeNull();
  });

  it("12. High quality + high friction retains qualityScore=86 while verdict=PASS", () => {
    const res = DecisionPolicyEngine.evaluate(
      dummyIdentity,
      dummyCapability,
      dummyOpportunity,
      dummyCareer,
      { locationFrictionPenalty: 28 } as any,
      "Commercial Leadership",
      "Commercial Leadership",
      sampleJD,
      true,
      undefined,
      undefined,
      80
    );
    expect(res.qualityScore).toBe(86);
    expect(res.verdict).toBe("PASS");
  });
});
