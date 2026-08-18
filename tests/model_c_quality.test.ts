import { QualityScoreCalculator } from "../src/lib/intelligence/policy/QualityScoreCalculator";
import { DecisionPolicyEngine } from "../src/lib/intelligence/policy/DecisionPolicyEngine";
import type { 
  IdentityAssessment, 
  CapabilityAssessment, 
  OpportunityAssessment, 
  CareerAssessment, 
  LifestyleAssessment 
} from "../src/domain/semantic";

// Helper dummy assessments
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
  overallFit: 0.80, // 80%
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

export function runModelCQualityTests(): { passed: number; failed: number; errors: string[] } {
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

  console.log("\n--- Running Model C Quality Architecture Tests ---\n");

  // Test 1: Identity-ineligible (distance >= 0.80) produces qualityScore = null
  const res1 = QualityScoreCalculator.calculate({
    identityDistance: 0.85,
    identity: dummyIdentity,
    capability: dummyCapability,
    career: dummyCareer,
    opportunity: dummyOpportunity,
    isSparseSpec: false,
    criticalFailed: false
  });
  assert(res1.qualityScore === null, "Test 1: Identity-ineligible (distance >= 0.80) -> qualityScore = null");

  // Test 2: Eligible opportunity produces numeric qualityScore
  const res2 = QualityScoreCalculator.calculate({
    identityDistance: 0.10,
    identity: dummyIdentity,
    capability: dummyCapability,
    career: dummyCareer,
    opportunity: dummyOpportunity,
    isSparseSpec: false,
    criticalFailed: false
  });
  assert(typeof res2.qualityScore === "number" && res2.qualityScore >= 0 && res2.qualityScore <= 100, 
    "Test 2: Eligible opportunity produces numeric qualityScore [0-100]");

  // Test 3 & 4: Formula verify weights (Career 6/13, Capability 3/13, Opportunity 4/13)
  // Career=90, Cap=80, Opp=85
  // Expected: (6/13)*90 + (3/13)*80 + (4/13)*85 = 41.538 + 18.4615 + 26.1538 = 86.1538 -> 86
  const expectedQuality = Math.round((6/13)*90 + (3/13)*80 + (4/13)*85);
  assert(res2.qualityScore === expectedQuality, 
    `Test 3: Formula exact calculation check (Expected ${expectedQuality}, got ${res2.qualityScore})`);

  // Test 4: Identity score contributes 0% to qualityScore
  const dummyIdentityLowCoverage: IdentityAssessment = { ...dummyIdentity, coverage: 0.20 };
  const res4 = QualityScoreCalculator.calculate({
    identityDistance: 0.10,
    identity: dummyIdentityLowCoverage,
    capability: dummyCapability,
    career: dummyCareer,
    opportunity: dummyOpportunity,
    isSparseSpec: false,
    criticalFailed: false
  });
  assert(res4.qualityScore === res2.qualityScore, "Test 4: Identity score contributes 0% to qualityScore");

  // Test 5: Pursuit friction contributes 0% to qualityScore
  const engineRes5a = DecisionPolicyEngine.evaluate(
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

  const engineRes5b = DecisionPolicyEngine.evaluate(
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
  assert(engineRes5a.qualityScore === engineRes5b.qualityScore, "Test 5: Pursuit friction contributes 0% to qualityScore");

  // Test 6: Decision does not mutate qualityScore
  assert(engineRes5a.qualityScore === expectedQuality, "Test 6: Decision does not mutate qualityScore");

  // Test 7: PASS opportunity can retain numeric qualityScore
  const lowCareer: CareerAssessment = { ...dummyCareer, careerScore: 30 };
  const engineRes7 = DecisionPolicyEngine.evaluate(
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
  assert(engineRes7.verdict === "PASS" && typeof engineRes7.qualityScore === "number", 
    `Test 7: PASS opportunity retains numeric qualityScore (verdict=${engineRes7.verdict}, score=${engineRes7.qualityScore})`);

  // Test 8: SPARSE_SPEC produces qualityScore = null
  const engineRes8 = DecisionPolicyEngine.evaluate(
    dummyIdentity,
    dummyCapability,
    dummyOpportunity,
    dummyCareer,
    dummyLifestyle,
    "Commercial Leadership",
    "Commercial Leadership",
    "Short text", // < 25 words
    false
  );
  assert(engineRes8.verdict === "SPARSE_SPEC" && engineRes8.qualityScore === null, 
    "Test 8: SPARSE_SPEC -> qualityScore = null");

  // Test 9: Sub-tier mandate veto retains numeric qualityScore
  const subTierOpportunity: OpportunityAssessment = { ...dummyOpportunity, mandateSeniority: "SUB_TIER" };
  const engineRes9 = DecisionPolicyEngine.evaluate(
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
  assert(engineRes9.vetoed && engineRes9.vetoReason === "G-SUB-TIER-MANDATE-VETO" && typeof engineRes9.qualityScore === "number",
    `Test 9: Sub-tier veto retains numeric qualityScore (vetoReason=${engineRes9.vetoReason}, score=${engineRes9.qualityScore})`);

  // Test 10: qualityScore consistent across DecisionPolicyResult fields
  assert(engineRes5a.qualityScore === engineRes5a.rawScore && engineRes5a.qualityScore === engineRes5a.priorityScore,
    "Test 10: qualityScore consistent across rawScore and priorityScore");

  // Test 11: Exactly one authoritative quality calculator
  const calcDirect = QualityScoreCalculator.calculate({
    identityDistance: 0.10,
    identity: dummyIdentity,
    capability: dummyCapability,
    career: dummyCareer,
    opportunity: dummyOpportunity,
    isSparseSpec: false,
    criticalFailed: false
  });
  assert(calcDirect.qualityScore === engineRes5a.qualityScore, 
    "Test 11: Single authoritative QualityScoreCalculator matches DecisionPolicyEngine output");

  // Test 12: priorityScore is not an independent scoring source
  assert(engineRes5a.priorityScore === engineRes5a.qualityScore,
    "Test 12: priorityScore equals qualityScore (not independent)");

  // Test 13: NULL remains NULL in SPARSE_SPEC
  assert(engineRes8.qualityScore === null && engineRes8.rawScore === null && engineRes8.priorityScore === null,
    "Test 13: NULL remains NULL throughout canonical policy result");

  // Test 14: Existing P0-P3 behavior outside score migration preserved (e.g. Easy Trap downscaling)
  // Easy trap: CV < 50, SP >= 80, Friction < 10, initially PURSUE
  const easyTrapCareer: CareerAssessment = { ...dummyCareer, careerScore: 40 }; // CV < 50
  const engineRes14 = DecisionPolicyEngine.evaluate(
    dummyIdentity,
    { ...dummyCapability, overallFit: 0.95 },
    { ...dummyOpportunity, opportunityScore: 95 },
    easyTrapCareer,
    { locationFrictionPenalty: 2 }, // Friction < 10
    "Commercial Leadership",
    "Commercial Leadership",
    sampleJD,
    true,
    undefined,
    undefined,
    85 // shortlistingPotential = 85 (>= 80)
  );
  assert(engineRes14.verdict === "CONSIDER" && engineRes14.triggeredRuleIds.includes("R-CONSIDER-CAREER-VALUE-PROTECTION"),
    `Test 14: Easy Trap career value protection preserved (verdict=${engineRes14.verdict})`);

  console.log(`\nModel C Quality Tests Summary: ${passed} Passed, ${failed} Failed\n`);
  return { passed, failed, errors };
}

const result = runModelCQualityTests();
if (result.failed > 0) {
  process.exit(1);
}
