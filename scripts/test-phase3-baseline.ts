import { BriefCompositionEngine } from "../src/lib/intelligence/editorial/BriefCompositionEngine";
import type { Opportunity } from "../src/data/opportunity-fixtures";

function buildOpportunity(
  role: string,
  company: string,
  verdict: "PURSUE" | "CONSIDER" | "PASS",
  score: number,
  ruleIds: string[],
  trajectoryUpside?: string,
  relativeDifferentiator?: string
): Opportunity {
  return {
    jobHash: "test-hash-" + role.toLowerCase().replace(/\s+/g, "-"),
    role,
    company,
    location: "Bengaluru",
    postedRelative: "2d ago",
    scrapedFrom: "LinkedIn",
    decision: verdict,
    recommendation: "Test recommendation",
    primaryConcern: null,
    positioning: [],
    headspace: [],
    dimensions: [],
    hiringRisk: "None",
    recommendationResult: {
      score,
      decision: verdict,
      policyId: ruleIds[0] || "TEST",
      policyVersion: "1.0",
      explanation: "Test evaluation",
      capabilities: []
    },
    engineRecommendation: {
      jobHash: "test-hash-" + role.toLowerCase().replace(/\s+/g, "-"),
      evaluationFingerprint: "fp",
      engineVerdict: verdict,
      vetoed: false,
      vetoReason: null,
      qualityScore: score,
      parsingConfidence: 0.9,
      evaluatedAt: new Date().toISOString(),
      triggeredRuleIds: ruleIds,
      trajectoryUpside: trajectoryUpside || "Standard Growth",
      relativeDifferentiator: relativeDifferentiator || "Solid mandate alignment",
      decisionDrivers: [
        { factor: "High Shortlisting Potential", impact: "positive", strength: "high", evidence: "85% SP" }
      ],
      decisionRisks: ruleIds.includes("R-CONSIDER-CAREER-VALUE-PROTECTION")
        ? [{ factor: "Low Career Value", impact: "negative", strength: "high", evidence: "CV: 42" }]
        : []
    }
  };
}

async function run() {
  console.log("=== PHASE 3 AUTOMATED TESTS (A - E) ===");

  // Test A: CVP active -> warning/explanation visible
  const oppA = buildOpportunity("Senior Manager", "Acme", "CONSIDER", 72, [
    "R-CONSIDER-CAREER-VALUE-PROTECTION", "R-PURSUE-INTERACTIVE-SCORE"
  ], "Limited Career Upside", "High accessibility but material career regression detected.");
  const briefA = BriefCompositionEngine.compose(oppA, { bypassHistory: true });
  console.log("\n[Test A] CVP Active:");
  console.log("  Verdict:", briefA.memory.decision);
  console.log("  Tradeoff:", briefA.memory.tradeoff);
  console.log("  Bottom Line:", briefA.oneMinuteTLDR.bottomLine);
  console.log("  Career Capital Rating:", briefA.qualitativeReasoningChain.find(r => r.layer === "Career Capital Value")?.ratingLabel);
  if (briefA.oneMinuteTLDR.watchFor.some(w => w.includes("Career Trajectory Risk")) && briefA.memory.decision === "CONSIDER") {
    console.log("  ✅ Test A Passed");
  } else {
    console.error("  ❌ Test A Failed");
  }

  // Test B: CVP inactive -> warning absent
  const oppB = buildOpportunity("VP Growth", "Beta Corp", "CONSIDER", 68, ["POL-D-CONSIDER-REACH-ROLE"]);
  const briefB = BriefCompositionEngine.compose(oppB, { bypassHistory: true });
  console.log("\n[Test B] CVP Inactive:");
  console.log("  Verdict:", briefB.memory.decision);
  console.log("  Bottom Line:", briefB.oneMinuteTLDR.bottomLine);
  console.log("  Career Capital Rating:", briefB.qualitativeReasoningChain.find(r => r.layer === "Career Capital Value")?.ratingLabel);
  if (!briefB.oneMinuteTLDR.watchFor.some(w => w.includes("Career Trajectory Risk")) && briefB.memory.decision === "CONSIDER") {
    console.log("  ✅ Test B Passed");
  } else {
    console.error("  ❌ Test B Failed");
  }

  // Test C: CVP + strong capability -> trade-off remains visible
  const oppC = buildOpportunity("Chief Marketing Officer", "Gamma", "CONSIDER", 76, [
    "R-CONSIDER-CAREER-VALUE-PROTECTION"
  ], "Limited Career Upside", "Strong profile match but limited step-up.");
  const briefC = BriefCompositionEngine.compose(oppC, { bypassHistory: true });
  console.log("\n[Test C] CVP + Strong Capability:");
  console.log("  Tradeoff:", briefC.memory.tradeoff);
  console.log("  Headline Upside:", briefC.strategicUpside.headline);
  if (briefC.strategicUpside.headline === "Career Value Protection Notice") {
    console.log("  ✅ Test C Passed");
  } else {
    console.error("  ❌ Test C Failed");
  }

  // Test D: CVP + High Score -> High score cannot suppress warning
  const oppD = buildOpportunity("Director Marketing", "Delta", "CONSIDER", 88, [
    "R-CONSIDER-CAREER-VALUE-PROTECTION"
  ], "Limited Career Upside", "High score easy trap.");
  const briefD = BriefCompositionEngine.compose(oppD, { bypassHistory: true });
  console.log("\n[Test D] CVP + High Score (88):");
  console.log("  Career Capital Rating:", briefD.qualitativeReasoningChain.find(r => r.layer === "Career Capital Value")?.ratingLabel);
  if (briefD.qualitativeReasoningChain.find(r => r.layer === "Career Capital Value")?.ratingLabel === "Limited Upside") {
    console.log("  ✅ Test D Passed");
  } else {
    console.error("  ❌ Test D Failed");
  }

  // Test E: CVP rendering does not change policy verdict
  const oppE = buildOpportunity("VP Product", "Epsilon", "CONSIDER", 75, [
    "R-CONSIDER-CAREER-VALUE-PROTECTION"
  ]);
  const briefE = BriefCompositionEngine.compose(oppE, { bypassHistory: true });
  console.log("\n[Test E] Verdict Preservation:");
  console.log("  Input Verdict: CONSIDER, Rendered Brief Decision:", briefE.memory.decision);
  if (briefE.memory.decision === "CONSIDER") {
    console.log("  ✅ Test E Passed");
  } else {
    console.error("  ❌ Test E Failed");
  }
}

run().catch(console.error);
