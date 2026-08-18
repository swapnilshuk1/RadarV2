import { EditorialContextBuilder } from "../src/lib/intelligence/editorial/EditorialContext";
import { QualityScoreCalculator } from "../src/lib/intelligence/policy/QualityScoreCalculator";
import { DecisionPolicyEngine } from "../src/lib/intelligence/policy/DecisionPolicyEngine";

console.log("============================================================");
console.log("   RADAR V4 PHASE 4 — CONFIDENCE & PROVENANCE INTEGRITY HARNESS");
console.log("============================================================\n");

let passed = true;

// ------------------------------------------------------------------
// TEST A: High Score Confidence, No Structured P&L Evidence
// ------------------------------------------------------------------
console.log("Test A: High Score Confidence with No Structured P&L Evidence...");
const testAOpp: any = {
  role: "Director of Marketing",
  company: "Brand Co",
  primaryDriver: "Brand equity acceleration across channels.",
  dimensions: []
};

const ctxA = EditorialContextBuilder.build(testAOpp);

if (ctxA.pnlProvenance === "ENGINE_VERIFIED") {
  console.error("  ❌ FAIL: pnlProvenance claimed ENGINE_VERIFIED without structured dimension evidence!");
  passed = false;
} else if (ctxA.hasPnlOwnership === true) {
  console.error("  ❌ FAIL: hasPnlOwnership was set to true without structured dimension or C-suite role!");
  passed = false;
} else {
  console.log(`  ✅ PASS: Score confidence / title distinct from P&L provenance (P&L: ${ctxA.hasPnlOwnership}, Prov: ${ctxA.pnlProvenance})`);
}

// ------------------------------------------------------------------
// TEST B: Structured P&L Evidence Present with Low Score Confidence
// ------------------------------------------------------------------
console.log("\nTest B: Structured P&L Evidence Present with Low Score Confidence...");
const qualityResB = QualityScoreCalculator.calculate({
  identityDistance: 0.1,
  capability: { overallFit: null, sufficiency: "INSUFFICIENT" } as any,
  career: { careerScore: 60 } as any,
  opportunity: { evidenceState: "UNAVAILABLE" } as any, // fallback used -> LOW confidence
  isSparseSpec: true,
  criticalFailed: false
});

const testBOpp: any = {
  role: "Support Lead",
  company: "Cloud Corp",
  dimensions: [
    { key: "commercialAccountability", jdEvidence: { value: true } }
  ]
};

const ctxB = EditorialContextBuilder.build(testBOpp);

if (qualityResB.opportunityScoreConfidence !== "LOW" || qualityResB.opportunityScoreSource !== "FALLBACK") {
  console.error(`  ❌ FAIL: Expected LOW confidence and FALLBACK source, got Conf: ${qualityResB.opportunityScoreConfidence}, Src: ${qualityResB.opportunityScoreSource}`);
  passed = false;
} else if (ctxB.pnlProvenance !== "ENGINE_VERIFIED" || ctxB.hasPnlOwnership !== true) {
  console.error(`  ❌ FAIL: Expected ENGINE_VERIFIED P&L ownership, got Prov: ${ctxB.pnlProvenance}, P&L: ${ctxB.hasPnlOwnership}`);
  passed = false;
} else {
  console.log(`  ✅ PASS: Independent dimensions verified (Score Conf: ${qualityResB.opportunityScoreConfidence}, P&L Prov: ${ctxB.pnlProvenance}, P&L: ${ctxB.hasPnlOwnership})`);
}

// ------------------------------------------------------------------
// TEST C: Generated Narrative Contains "P&L", Evidence Absent
// ------------------------------------------------------------------
console.log("\nTest C: Generated Narrative Contains 'P&L', Evidence Absent (Epistemic Self-Inference Test)...");
const testCOpp: any = {
  role: "Senior Growth Manager",
  company: "Fintech Startup",
  primaryDriver: "Direct P&L ownership and revenue expansion precedents.",
  primaryConcern: "P&L targets require rapid scaling.",
  dimensions: []
};

const ctxC = EditorialContextBuilder.build(testCOpp);

if (ctxC.hasPnlOwnership === true) {
  console.error("  ❌ FAIL: Epistemic self-inference detected! EditorialContext inferred hasPnlOwnership=true from generated primaryDriver!");
  passed = false;
} else {
  console.log(`  ✅ PASS: Epistemic self-inference blocked. Narrative 'P&L' string ignored (P&L: ${ctxC.hasPnlOwnership}, Prov: ${ctxC.pnlProvenance})`);
}

// ------------------------------------------------------------------
// TEST D: Generated Narrative Contains "Turnaround", Evidence Absent
// ------------------------------------------------------------------
console.log("\nTest D: Generated Narrative Contains 'Turnaround', Evidence Absent...");
const testDOpp: any = {
  role: "Strategy Lead",
  company: "Retail Inc",
  primaryDriver: "Turnaround mandate and digital restructuring required.",
  dimensions: []
};

const ctxD = EditorialContextBuilder.build(testDOpp);

if (ctxD.transformationStage !== "none") {
  console.error(`  ❌ FAIL: transformationStage inferred from primaryDriver narrative string! Got: ${ctxD.transformationStage}`);
  passed = false;
} else {
  console.log(`  ✅ PASS: Epistemic self-inference blocked for mandate (Stage: ${ctxD.transformationStage}, Prov: ${ctxD.mandateProvenance})`);
}

// ------------------------------------------------------------------
// TEST E: Explicit Structured P&L Evidence
// ------------------------------------------------------------------
console.log("\nTest E: Explicit Structured P&L Evidence...");
const testEOpp: any = {
  role: "Commercial Director",
  company: "SaaS Inc",
  dimensions: [
    { key: "commercialAccountability", jdEvidence: { value: true } }
  ]
};

const ctxE = EditorialContextBuilder.build(testEOpp);

if (ctxE.pnlProvenance !== "ENGINE_VERIFIED" || ctxE.hasPnlOwnership !== true) {
  console.error(`  ❌ FAIL: Explicit P&L evidence not recognized! Prov: ${ctxE.pnlProvenance}, P&L: ${ctxE.hasPnlOwnership}`);
  passed = false;
} else {
  console.log(`  ✅ PASS: Explicit structured P&L evidence correctly verified (Prov: ${ctxE.pnlProvenance}, P&L: ${ctxE.hasPnlOwnership})`);
}

// ------------------------------------------------------------------
// TEST F: Explicit Structured Mandate Evidence
// ------------------------------------------------------------------
console.log("\nTest F: Explicit Structured Mandate Evidence...");
const testFOpp: any = {
  role: "VP Operations",
  company: "Logistics Global",
  dimensions: [
    { key: "mandate", jdEvidence: { status: "Explicit", value: "Turnaround and operational restructuring" } }
  ]
};

const ctxF = EditorialContextBuilder.build(testFOpp);

if (ctxF.mandateProvenance !== "ENGINE_VERIFIED" || ctxF.transformationStage !== "turnaround") {
  console.error(`  ❌ FAIL: Explicit Mandate evidence not recognized! Prov: ${ctxF.mandateProvenance}, Stage: ${ctxF.transformationStage}`);
  passed = false;
} else {
  console.log(`  ✅ PASS: Explicit structured mandate evidence correctly verified (Prov: ${ctxF.mandateProvenance}, Stage: ${ctxF.transformationStage})`);
}

// ------------------------------------------------------------------
// TEST G: Score Confidence Independence and Preservation
// ------------------------------------------------------------------
console.log("\nTest G: Score Confidence Independence and Preservation...");
const qualityResG = QualityScoreCalculator.calculate({
  identityDistance: 0.05,
  capability: { overallFit: 0.9, sufficiency: "SUFFICIENT" } as any,
  career: { careerScore: 85 } as any,
  opportunity: { evidenceState: "EXPLICIT", opportunityScore: 90 } as any,
  isSparseSpec: false,
  criticalFailed: false
});

if (qualityResG.opportunityScoreConfidence !== "HIGH" || qualityResG.opportunityScoreSource !== "EXPLICIT") {
  console.error(`  ❌ FAIL: Expected HIGH/EXPLICIT score confidence metadata, got Conf: ${qualityResG.opportunityScoreConfidence}, Src: ${qualityResG.opportunityScoreSource}`);
  passed = false;
} else {
  console.log(`  ✅ PASS: Score confidence metadata preserved (Conf: ${qualityResG.opportunityScoreConfidence}, Src: ${qualityResG.opportunityScoreSource})`);
}

console.log("\n============================================================");
if (passed) {
  console.log("   🟢 ALL PHASE 4 ADVOCACY & PROVENANCE TESTS PASSED CLEANLY!");
} else {
  console.log("   🔴 PHASE 4 TEST SUITE FAILED");
  process.exit(1);
}
console.log("============================================================\n");
