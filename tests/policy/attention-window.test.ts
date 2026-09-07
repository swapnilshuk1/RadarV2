import { describe, it, expect } from "vitest";
import { DecisionPolicyEngine } from "../../src/lib/intelligence/policy/DecisionPolicyEngine";
import { runEngine, injectFixtureRecords, clearFixtureRecords } from "../../src/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "../../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../../src/data/candidate-profile";
import { rawOpportunities } from "../../src/data/opportunity-fixtures";
import type { 
  IdentityAssessment, 
  CapabilityAssessment, 
  OpportunityAssessment, 
  CareerAssessment, 
  LifestyleAssessment 
} from "../../src/domain/semantic";

describe("Attention Window Capacity Invariance & Trace Flow", () => {
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

  const evaluateForCapacity = (capacityOverride: number, activePursuits: number = 4) => {
    // Policy evaluation is strictly isolated and agnostic to capacity
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

    return { policyResult };
  };

  it("Varies capacity (2, 6, 10) with fixed active pursuits (4) and proves policy invariance", () => {
    // Fixed active pursuits = 4; vary capacity window across 2, 6, and 10
    const runCap2 = evaluateForCapacity(2, 4);
    const runCap6 = evaluateForCapacity(6, 4);
    const runCap10 = evaluateForCapacity(10, 4);

    // Intrinsic policy verdicts, scores, and triggered rules MUST be 100% identical
    expect(runCap2.policyResult.verdict).toBe("PURSUE");
    expect(runCap2.policyResult.verdict).toBe(runCap6.policyResult.verdict);
    expect(runCap6.policyResult.verdict).toBe(runCap10.policyResult.verdict);

    expect(runCap2.policyResult.qualityScore).toBe(runCap6.policyResult.qualityScore);
    expect(runCap6.policyResult.qualityScore).toBe(runCap10.policyResult.qualityScore);

    expect(runCap2.policyResult.rawScore).toBe(runCap6.policyResult.rawScore);
    expect(runCap6.policyResult.rawScore).toBe(runCap10.policyResult.rawScore);

    expect(runCap2.policyResult.priorityScore).toBe(runCap6.policyResult.priorityScore);
    expect(runCap6.policyResult.priorityScore).toBe(runCap10.policyResult.priorityScore);

    expect(runCap2.policyResult.triggeredRuleIds).toEqual(runCap6.policyResult.triggeredRuleIds);
    expect(runCap6.policyResult.triggeredRuleIds).toEqual(runCap10.policyResult.triggeredRuleIds);
  });

  it("treats capacity as presentation-only and never modifies the policy verdict", () => {
    const runCap2 = evaluateForCapacity(2, 4);   // 4 active >= 2 cap -> Saturated
    const runCap6 = evaluateForCapacity(6, 4);   // 4 active < 6 cap -> Unsaturated
    const runCap10 = evaluateForCapacity(10, 4); // 4 active < 10 cap -> Unsaturated

    expect(runCap2.policyResult.verdict).toBe("PURSUE");
    expect(runCap6.policyResult.verdict).toBe("PURSUE");
    expect(runCap10.policyResult.verdict).toBe("PURSUE");
  });

  it("proves runEngine preserves the policy verdict regardless of active pursuit count", () => {
    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile({
      ...candidateProfile,
      attentionWindow: 2 // Saturated capacity for 4 active pursuits
    } as any);

    // Use BMW India CMO golden fixture (evaluates to PURSUE under normal capacity)
    const bmwOpp = {
      ...rawOpportunities[0],
      rawText: rawOpportunities[0].dimensions
        .map((d) => (d.jdEvidence as any)?.evidence?.[0]?.quote)
        .filter(Boolean)
        .join(". ") + ". Executive leadership position for BMW India.",
      dimensions: rawOpportunities[0].dimensions.map((d) => ({
        ...d,
        jdEvidence: {
          ...d.jdEvidence,
          evidence: (d.jdEvidence as any)?.evidence?.map((e: any) => ({ ...e, provenance: "fixture" }))
        }
      }))
    };

    // Run with 4 active pursuits under attentionWindow = 2
    const result = runEngine(projection, 4, [bmwOpp as any]);
    const record = result.records[0];

    expect(record).toBeDefined();
    expect(record.trace.verb0).toBe("PURSUE");
    expect(record.verb).toBe("PURSUE");
  });
});
