import { rawOpportunities } from "../src/data/opportunity-fixtures";
import { EditorialContextBuilder } from "../src/lib/intelligence/editorial/EditorialContext";
import { EditorialPatternSelector } from "../src/lib/intelligence/editorial/EditorialPatternSelector";
import { NarrativeComposer } from "../src/lib/intelligence/editorial/NarrativeComposer";
import { BriefCompositionEngine } from "../src/lib/intelligence/editorial/BriefCompositionEngine";
import { QualityScoreCalculator } from "../src/lib/intelligence/policy/QualityScoreCalculator";
import { DecisionPolicyEngine } from "../src/lib/intelligence/policy/DecisionPolicyEngine";

console.log("============================================================");
console.log("   RADAR AUDIT-COMPLIANT REMEDIATION & INVARIANT TEST SUITE ");
console.log("============================================================\n");

let passed = true;

// ------------------------------------------------------------------
// A. POLICY IMMUTABILITY VERIFICATION
// ------------------------------------------------------------------
console.log("A. Verifying Decision Policy Engine Immutability...");
const validJdText = "Executive Chief Marketing Officer role leading global digital marketing, growth strategy, and commercial P&L across international markets. Direct responsibility for brand transformation and performance marketing operations.";

const policyEval = DecisionPolicyEngine.evaluate(
  { status: "EVALUATED", coverage: 0.9, verdict: "MATCH", evidenceCount: 5 } as any,
  { overallFit: 0.85, sufficiency: "SUFFICIENT", evidenceCount: 5, matchedCapabilities: ["Marketing Strategy"], missingCapabilities: [] } as any,
  { opportunityScore: 90 } as any,
  { careerScore: 80, regressionScore: 0, status: "EVALUATED", trajectory: "FORWARD" } as any,
  { locationFrictionPenalty: 0 } as any,
  "Commercial Leadership",
  "Commercial Leadership",
  validJdText,
  true,
  undefined,
  undefined,
  85 // shortlistingPotentialScore >= 65
);

if (policyEval.recommendation !== "PURSUE") {
  console.error(`  ❌ FAIL: DecisionPolicyEngine returned ${policyEval.recommendation}, expected PURSUE`);
  passed = false;
} else {
  console.log(`  ✅ PASS: DecisionPolicyEngine policy evaluation immutable (Recommendation: ${policyEval.recommendation})`);
}

// ------------------------------------------------------------------
// B. EDITORIAL CONTEXT BUILDER PRECEDENCE TEST (STRUCTURED OVER HEURISTIC)
// ------------------------------------------------------------------
console.log("\nB. Testing EditorialContextBuilder Structured Precedence...");

// Test Case 1: Title says "VP of Growth" (would match regex), but structured dimension says commercialAccountability = false
const fakeOpp1: any = {
  role: "VP of Growth",
  company: "Acme Analytics",
  dimensions: [
    { key: "commercialAccountability", jdEvidence: { value: false } }
  ]
};

const ctx1 = EditorialContextBuilder.build(fakeOpp1);
if (ctx1.hasPnlOwnership !== false || ctx1.pnlProvenance !== "ENGINE_VERIFIED") {
  console.error(`  ❌ FAIL: Structured dimension false did not override title regex! Got P&L: ${ctx1.hasPnlOwnership}, Prov: ${ctx1.pnlProvenance}`);
  passed = false;
} else {
  console.log(`  ✅ PASS: Structured false strictly overrides title regex (P&L: ${ctx1.hasPnlOwnership}, Prov: ${ctx1.pnlProvenance})`);
}

// Test Case 2: Title says "Head of Support" (no P&L in regex), but structured dimension says commercialAccountability = true
const fakeOpp2: any = {
  role: "Head of Customer Support",
  company: "SaaS Corp",
  dimensions: [
    { key: "commercialAccountability", jdEvidence: { value: true } }
  ]
};

const ctx2 = EditorialContextBuilder.build(fakeOpp2);
if (ctx2.hasPnlOwnership !== true || ctx2.pnlProvenance !== "ENGINE_VERIFIED") {
  console.error(`  ❌ FAIL: Structured dimension true did not override title regex! Got P&L: ${ctx2.hasPnlOwnership}, Prov: ${ctx2.pnlProvenance}`);
  passed = false;
} else {
  console.log(`  ✅ PASS: Structured true strictly overrides title regex (P&L: ${ctx2.hasPnlOwnership}, Prov: ${ctx2.pnlProvenance})`);
}

// ------------------------------------------------------------------
// C. EASY TRAP PROVENANCE & NO DUPLICATE POLICY LOGIC IN NARRATIVE COMPOSER
// ------------------------------------------------------------------
console.log("\nC. Testing Easy Trap Provenance in NarrativeComposer...");

// Opp with policyId = R-CONSIDER-CAREER-VALUE-PROTECTION
const easyTrapOpp: any = {
  role: "Senior Director",
  company: "Legacy Retail",
  recommendationResult: { policyId: "R-CONSIDER-CAREER-VALUE-PROTECTION" }
};

const patternForTrap = EditorialPatternSelector.select(EditorialContextBuilder.build(easyTrapOpp), "trap-hash", true);
const composedTrap = NarrativeComposer.compose(patternForTrap, easyTrapOpp);

if (!composedTrap.decisionGuidance.pauseIf.includes("High interview probability")) {
  console.error("  ❌ FAIL: Easy Trap guidance missing when policyId === 'R-CONSIDER-CAREER-VALUE-PROTECTION'");
  passed = false;
} else {
  console.log("  ✅ PASS: Easy Trap guidance correctly injected from Policy Engine output strictly.");
}

// Opp without R-CONSIDER-CAREER-VALUE-PROTECTION
const normalOpp: any = {
  role: "VP Marketing",
  company: "Growth Tech",
  recommendationResult: { policyId: "R-PURSUE-HIGH-FIT" }
};

const patternForNormal = EditorialPatternSelector.select(EditorialContextBuilder.build(normalOpp), "normal-hash", true);
const composedNormal = NarrativeComposer.compose(patternForNormal, normalOpp);

if (composedNormal.decisionGuidance.pauseIf.includes("High interview probability")) {
  console.error("  ❌ FAIL: Easy Trap guidance erroneously injected when policyId is NOT R-CONSIDER-CAREER-VALUE-PROTECTION");
  passed = false;
} else {
  console.log("  ✅ PASS: Normal policy output does not trigger Easy Trap guidance.");
}

// ------------------------------------------------------------------
// D. FALLBACK SCORE PROVENANCE PROPAGATION
// ------------------------------------------------------------------
console.log("\nD. Testing Fallback Score Provenance Propagation...");

const fallbackPolicyResult = DecisionPolicyEngine.evaluate(
  { status: "EVALUATED", coverage: 0.9, verdict: "MATCH", evidenceCount: 5 } as any,
  { overallFit: 0.85, sufficiency: "SUFFICIENT", evidenceCount: 5, matchedCapabilities: ["Marketing Strategy"], missingCapabilities: [] } as any,
  {} as any, // Missing opportunityScore -> triggers fallback 80
  { careerScore: 80, regressionScore: 0, status: "EVALUATED", trajectory: "FORWARD" } as any,
  { locationFrictionPenalty: 0 } as any,
  "Commercial Leadership",
  "Commercial Leadership",
  validJdText,
  true
);

if (fallbackPolicyResult.opportunityScoreSource !== "FALLBACK" || fallbackPolicyResult.opportunityScoreConfidence !== "LOW") {
  console.error(`  ❌ FAIL: Fallback provenance not propagated through DecisionPolicyEngine! Got Source: ${fallbackPolicyResult.opportunityScoreSource}, Conf: ${fallbackPolicyResult.opportunityScoreConfidence}`);
  passed = false;
} else {
  console.log(`  ✅ PASS: Fallback provenance correctly propagated through DecisionPolicyEngine (Source: ${fallbackPolicyResult.opportunityScoreSource}, Conf: ${fallbackPolicyResult.opportunityScoreConfidence})`);
}

// ------------------------------------------------------------------
// E. EDITORIAL FACT INTEGRITY (EVIDENCE TRACEABILITY)
// ------------------------------------------------------------------
console.log("\nE. Verifying Editorial Fact Traceability across Raw Opportunities...");

const composedBriefs = new Map<string, string>();

for (const rawOpp of rawOpportunities.slice(0, 6)) {
  const opp = rawOpp as any;
  const ctx = EditorialContextBuilder.build(opp);
  const pattern = EditorialPatternSelector.select(ctx, opp.jobHash, true);
  const composed = NarrativeComposer.compose(pattern, opp);

  console.log(`\n--- [${opp.company} - ${opp.role}] (${opp.decision || "BENCHMARK"}) ---`);
  console.log(`  Pattern ID: ${pattern.id} (Family: ${pattern.patternFamily}, Skeleton: ${pattern.skeleton})`);
  console.log(`  Headline: "${composed.headline}"`);
  console.log(`  Proceed If: "${composed.decisionGuidance.proceedIf}"`);
  console.log(`  Pause If: "${composed.decisionGuidance.pauseIf}"`);

  // Uniqueness assertion
  if (composedBriefs.has(composed.headline)) {
    console.error(`  ❌ FAIL: Duplicate headline generated for ${opp.company}`);
    passed = false;
  }
  composedBriefs.set(composed.headline, opp.jobHash);
}

console.log("\n============================================================");
console.log(passed ? "  ✅ ALL AUDIT-COMPLIANT REMEDIATION TESTS PASSED CLEANLY!" : "  ❌ SOME AUDIT TESTS FAILED");
console.log("============================================================\n");

process.exit(passed ? 0 : 1);
