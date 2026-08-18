import { BriefCompositionEngine } from "../src/lib/intelligence/editorial/BriefCompositionEngine";
import type { Opportunity } from "../src/data/opportunity-fixtures";

function buildOpp(verdict: "PURSUE" | "CONSIDER" | "PASS", score: number): Opportunity {
  return {
    jobHash: "test-hash",
    role: "Test Role",
    company: "Test Company",
    location: "Test Location",
    postedRelative: "1d ago",
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
      policyId: "TEST",
      policyVersion: "1.0",
      explanation: "Test",
      capabilities: []
    },
    engineRecommendation: {
      jobHash: "test-hash",
      evaluationFingerprint: "fp",
      engineVerdict: verdict,
      vetoed: false,
      vetoReason: null,
      qualityScore: score,
      parsingConfidence: 0.9,
      evaluatedAt: new Date().toISOString()
    }
  };
}

async function run() {
  const engine = new BriefCompositionEngine();
  
  // Test A - High score cannot promote negative policy
  const oppA = buildOpp("PASS", 80);
  const resA = BriefCompositionEngine.compose(oppA);
  console.log(`Test A (Policy=PASS, Score=80): Editorial Decision = ${resA.memory.decision}`);

  // Test C - Legitimate positive policy remains positive
  const oppC = buildOpp("PURSUE", 80);
  const resC = BriefCompositionEngine.compose(oppC);
  console.log(`Test C (Policy=PURSUE, Score=80): Editorial Decision = ${resC.memory.decision}`);

  // Test D - Normal consider remains consider
  const oppD = buildOpp("CONSIDER", 60);
  const resD = BriefCompositionEngine.compose(oppD);
  console.log(`Test D (Policy=CONSIDER, Score=60): Editorial Decision = ${resD.memory.decision}`);
}

run().catch(console.error);
