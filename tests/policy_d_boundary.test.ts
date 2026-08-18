import { DecisionPolicyEngine, POLICY_THRESHOLDS } from "../src/lib/intelligence/policy/DecisionPolicyEngine";
import type { 
  IdentityAssessment, 
  CapabilityAssessment, 
  OpportunityAssessment, 
  CareerAssessment, 
  LifestyleAssessment 
} from "../src/domain/semantic";

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

export function runPolicyDBoundaryTests(): { passed: number; failed: number; errors: string[] } {
  let passed = 0;
  let failed = 0;
  const errors: string[] = [];

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      passed++;
      console.log(`  ✓ ${testName}`);
    } else {
      failed++;
      const msg = `  ✗ FAIL: ${testName}${detail ? ` - ${detail}` : ""}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  console.log("\n--- Running Targeted Policy D Boundary Tests ---\n");

  // Helper to construct exact quality score inputs:
  // QualityScore = Math.round((6/13)*Career + (3/13)*Capability*100 + (4/13)*OpportunityScore)
  // For Career=65, Cap=65%, Opp=65 -> QualityScore = 65
  // For Career=64.9, Cap=64.9%, Opp=64.9 -> QualityScore = 65 or 64.91 -> Math.round -> 64.91
  
  // 1. Quality 65 + SP 50 + Friction 15 → PURSUE
  const res1 = DecisionPolicyEngine.evaluate(
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
  assert(res1.qualityScore === 65 && res1.verdict === "PURSUE", 
    `1. Quality 65 + SP 50 + Friction 15 -> PURSUE (Got score=${res1.qualityScore}, verdict=${res1.verdict})`);

  // 2. Quality 64.99 (rounded to 64 or 62) → not PURSUE
  const res2 = DecisionPolicyEngine.evaluate(
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
  assert(res2.qualityScore! < 65 && res2.verdict !== "PURSUE", 
    `2. Quality < 65 -> not PURSUE (Got score=${res2.qualityScore}, verdict=${res2.verdict})`);

  // 3. Quality 55 + Friction 25 → CONSIDER
  const res3 = DecisionPolicyEngine.evaluate(
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
  assert(res3.qualityScore === 55 && res3.verdict === "CONSIDER", 
    `3. Quality 55 + Friction 25 -> CONSIDER (Got score=${res3.qualityScore}, verdict=${res3.verdict})`);

  // 4. Quality 54.99 (rounded to 54) → PASS
  const res4 = DecisionPolicyEngine.evaluate(
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
  assert(res4.qualityScore! < 55 && res4.verdict === "PASS", 
    `4. Quality < 55 -> PASS (Got score=${res4.qualityScore}, verdict=${res4.verdict})`);

  // 5. SP < 50 blocks PURSUE (Quality=86, SP=45, Friction=5 -> CONSIDER)
  const res5 = DecisionPolicyEngine.evaluate(
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
  assert(res5.qualityScore! >= 65 && res5.verdict === "CONSIDER", 
    `5. SP < 50 blocks PURSUE -> CONSIDER (Got verdict=${res5.verdict})`);

  // 6. Friction > 15 blocks PURSUE (Quality=86, SP=80, Friction=18 -> CONSIDER)
  const res6 = DecisionPolicyEngine.evaluate(
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
  assert(res6.qualityScore! >= 65 && res6.verdict === "CONSIDER", 
    `6. Friction > 15 blocks PURSUE -> CONSIDER (Got verdict=${res6.verdict})`);

  // 7. Friction > 25 blocks CONSIDER (Quality=86, SP=80, Friction=28 -> PASS)
  const res7 = DecisionPolicyEngine.evaluate(
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
  assert(res7.qualityScore! >= 65 && res7.verdict === "PASS", 
    `7. Friction > 25 blocks CONSIDER -> PASS (Got verdict=${res7.verdict})`);

  // 8. Easy Trap overrides an otherwise qualifying PURSUE (Quality=85, CV=45, SP=85, Friction=5 -> CONSIDER)
  const res8 = DecisionPolicyEngine.evaluate(
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
  assert(res8.verdict === "CONSIDER" && res8.triggeredRuleIds.includes("R-CONSIDER-CAREER-VALUE-PROTECTION"), 
    `8. Easy Trap overrides PURSUE -> CONSIDER (Got verdict=${res8.verdict})`);

  // 9. Hard veto overrides quality and SP (Identity Distance 0.85 -> PASS, vetoed=true)
  const res9 = DecisionPolicyEngine.evaluate(
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
  assert(res9.verdict === "PASS" && res9.vetoed && res9.vetoReason === "G-EXECUTIVE-IDENTITY-MISMATCH", 
    `9. Hard veto overrides quality and SP (Got verdict=${res9.verdict}, vetoReason=${res9.vetoReason})`);

  // 10. SPARSE_SPEC remains N/A (qualityScore=null)
  const res10 = DecisionPolicyEngine.evaluate(
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
  assert(res10.verdict === "SPARSE_SPEC" && res10.qualityScore === null, 
    `10. SPARSE_SPEC remains N/A (Got verdict=${res10.verdict}, qualityScore=${res10.qualityScore})`);

  // 11. NOT_EVALUABLE remains N/A (qualityScore=null)
  const res11 = DecisionPolicyEngine.evaluate(
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
  assert(res11.verdict === "NOT_EVALUABLE" && res11.qualityScore === null, 
    `11. NOT_EVALUABLE remains N/A (Got verdict=${res11.verdict}, qualityScore=${res11.qualityScore})`);

  // 12. High quality + high friction retains high qualityScore while becoming CONSIDER/PASS
  const res12 = DecisionPolicyEngine.evaluate(
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
  assert(res12.qualityScore === 86 && res12.verdict === "PASS", 
    `12. High quality + high friction retains qualityScore=86 while verdict=${res12.verdict}`);

  // 13. qualityScore remains unchanged by Decision
  assert(res6.qualityScore === 86 && res7.qualityScore === 86 && res1.qualityScore === 65, 
    "13. qualityScore remains unchanged across different decision outcomes");

  // 14. Decision remains the only changed policy output
  assert(res12.rawScore === 86 && res12.priorityScore === 86, 
    "14. Decision remains the only changed policy output (rawScore and priorityScore equal qualityScore)");

  console.log(`\nPolicy D Boundary Tests Summary: ${passed} Passed, ${failed} Failed\n`);
  return { passed, failed, errors };
}

const result = runPolicyDBoundaryTests();
if (result.failed > 0) {
  process.exit(1);
}
