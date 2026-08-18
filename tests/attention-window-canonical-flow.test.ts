import { describe, it, expect } from "vitest";
import { DecisionPolicyEngine } from "../src/lib/intelligence/policy/DecisionPolicyEngine";
import { buildHeadspace } from "../src/lib/intelligence/candidate";
import { applyHeadspaceFilter } from "../src/lib/intelligence/headspace-filter";
import type { 
  IdentityAssessment, 
  CapabilityAssessment, 
  OpportunityAssessment, 
  CareerAssessment, 
  LifestyleAssessment 
} from "../src/domain/semantic";

describe("Phase 5 — Attention Window Clean Flow & Certification", () => {
  const dummyIdentity: IdentityAssessment = {
    status: "COMPLETE",
    verdict: "MATCH",
    coverage: 0.95,
    vectorSimilarity: 0.95,
    evidenceCount: 5,
    matchedThemes: ["Commercial & Marketing Leadership"],
    missingThemes: []
  };

  const dummyCapability: CapabilityAssessment = {
    status: "COMPLETE",
    sufficiency: "SUFFICIENT",
    overallFit: 0.85,
    matchingConfidence: 0.90,
    evidenceCount: 6,
    matchedCapabilities: ["P&L", "GTM Strategy"],
    missingCapabilities: []
  };

  const dummyOpportunity: OpportunityAssessment = {
    status: "COMPLETE",
    mandateSeniority: "QUALIFIED",
    mandateFit: "STRONG",
    operatingLevelAssessment: "MATCH",
    workNatureAssessment: "MATCH",
    commercialScopeAssessment: "MATCH"
  };

  const dummyCareer: CareerAssessment = {
    status: "COMPLETE",
    trajectory: "FORWARD",
    careerScore: 88,
    regressionScore: 10
  };

  const dummyLifestyle: LifestyleAssessment = {
    status: "COMPLETE",
    locationFrictionPenalty: 0
  };

  const sampleJD = "Executive commercial leadership posting for Chief Commercial Officer directing $50M regional P&L and growth architecture.";

  const sampleDimensions = [
    { key: "functionalScope", jdEvidence: { value: "Commercial Leadership", status: "Extracted" } },
    { key: "mandate", jdEvidence: { value: "P&L Ownership", status: "Extracted" } },
    { key: "operatingLevel", jdEvidence: { value: "EXECUTIVE", status: "Extracted" } },
    { key: "commercialScope", jdEvidence: { value: "ENTERPRISE", status: "Extracted" } }
  ];

  const evaluateForWindow = (activePursuits: number) => {
    const policyResult = DecisionPolicyEngine.evaluate(
      dummyIdentity,
      dummyCapability,
      dummyOpportunity,
      dummyCareer,
      dummyLifestyle,
      "Commercial & Marketing Leadership",
      "Commercial & Marketing Leadership",
      sampleJD,
      true,
      undefined,
      sampleDimensions,
      88 // Authoritative Shortlisting Potential
    );

    const headspace = buildHeadspace(activePursuits);
    const headspaceOutcome = applyHeadspaceFilter(policyResult.verdict as any, headspace);

    return { policyResult, headspace, headspaceOutcome };
  };

  it("Asserts policyResult is 100% identical across windows 1, 5, and 10 before headspace", () => {
    const run1 = evaluateForWindow(1);
    const run5 = evaluateForWindow(5);
    const run10 = evaluateForWindow(10);

    // Intrinsic policy verdicts, scores, and triggered rules MUST NOT be affected by attention window
    expect(run1.policyResult.verdict).toBe("PURSUE");
    expect(run1.policyResult.verdict).toBe(run5.policyResult.verdict);
    expect(run5.policyResult.verdict).toBe(run10.policyResult.verdict);

    expect(run1.policyResult.qualityScore).toBe(run5.policyResult.qualityScore);
    expect(run5.policyResult.qualityScore).toBe(run10.policyResult.qualityScore);

    expect(run1.policyResult.priorityScore).toBe(run5.policyResult.priorityScore);
    expect(run5.policyResult.priorityScore).toBe(run10.policyResult.priorityScore);

    expect(run1.policyResult.triggeredRuleIds).toEqual(run5.policyResult.triggeredRuleIds);
    expect(run5.policyResult.triggeredRuleIds).toEqual(run10.policyResult.triggeredRuleIds);
  });

  it("Asserts headspace saturation differs cleanly without mutating intrinsic policy score", () => {
    const run1 = evaluateForWindow(1);
    const run6 = evaluateForWindow(6);

    // Run 1 (1 active pursuit < capacity 6) -> unsaturated, not downgraded
    expect(run1.headspace.saturated).toBe(false);
    expect(run1.headspaceOutcome.downgraded).toBe(false);
    expect(run1.headspaceOutcome.finalVerb).toBe("PURSUE");

    // Run 6 (6 active pursuits >= capacity 6) -> saturated, downgraded to CONSIDER in presentation
    expect(run6.headspace.saturated).toBe(true);
    expect(run6.headspaceOutcome.downgraded).toBe(true);
    expect(run6.headspaceOutcome.finalVerb).toBe("CONSIDER");

    // Intrinsic Quality Score remains identical
    expect(run1.policyResult.qualityScore).toBe(run6.policyResult.qualityScore);
  });
});
