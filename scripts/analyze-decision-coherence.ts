/**
 * P3-B: Decision/Signal Coherence Analysis
 *
 * Examines whether final recommendation is coherent with the three independent signals:
 * - Career Value (CV)
 * - Shortlisting Potential (SP)
 * - Pursuit Friction
 *
 * Focus areas per MASTER EXECUTION INSTRUCTION:
 * - Low CV + high SP + low friction
 * - High CV + low SP
 * - High CV + high friction
 * - Low CV + low SP
 * - Medium CV + high SP + low friction
 * - Career regression + PURSUE
 * - Principal Risk contradicting recommendation
 * - Strategic Advantage contradicting Principal Risk
 */

import { runEngine, invalidateEngineCache } from "../src/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../src/data/candidate-profile";
import type { RecommendationRecord } from "../src/lib/intelligence/record";

interface CoherenceAnalysis {
  totalRecords: number;
  // Decision distribution by signal patterns
  lowCvHighSp: {
    count: number;
    pursue: number;
    consider: number;
    pass: number;
    easyTrapCandidates: number;
    cases: Array<{
      jobHash: string;
      verb: string;
      cv: number;
      sp: number;
      friction: number;
      rawScore: number;
      trajectory?: string;
      vetoed?: boolean;
      vetoReason?: string | null;
    }>;
  };
  highCvLowSp: {
    count: number;
    pursue: number;
    consider: number;
    pass: number;
    cases: Array<{
      jobHash: string;
      verb: string;
      cv: number;
      sp: number;
      friction: number;
      rawScore: number;
    }>;
  };
  highCvHighFriction: {
    count: number;
    pursue: number;
    consider: number;
    pass: number;
    cases: Array<{
      jobHash: string;
      verb: string;
      cv: number;
      sp: number;
      friction: number;
      rawScore: number;
    }>;
  };
  lowCvLowSp: {
    count: number;
    pursue: number;
    consider: number;
    pass: number;
    cases: Array<{
      jobHash: string;
      verb: string;
      cv: number;
      sp: number;
      friction: number;
    }>;
  };
  mediumCvHighSp: {
    count: number;
    pursue: number;
    consider: number;
    pass: number;
    cases: Array<{
      jobHash: string;
      verb: string;
      cv: number;
      sp: number;
      friction: number;
      rawScore: number;
    }>;
  };
  careerRegressionPursue: {
    count: number;
    cases: Array<{
      jobHash: string;
      verb: string;
      cv: number;
      sp: number;
      friction: number;
      rawScore: number;
      trajectory?: string;
      regressionScore?: number;
    }>;
  };
  // Contradiction patterns
  potentialContradictions: {
    highSpPass: number;
    lowSpPursue: number;
    highCvPass: number;
    lowCvPursue: number;
  };
}

function analyzeCoherence(records: RecommendationRecord[]): CoherenceAnalysis {
  const analysis: CoherenceAnalysis = {
    totalRecords: records.length,
    lowCvHighSp: { count: 0, pursue: 0, consider: 0, pass: 0, easyTrapCandidates: 0, cases: [] },
    highCvLowSp: { count: 0, pursue: 0, consider: 0, pass: 0, cases: [] },
    highCvHighFriction: { count: 0, pursue: 0, consider: 0, pass: 0, cases: [] },
    lowCvLowSp: { count: 0, pursue: 0, consider: 0, pass: 0, cases: [] },
    mediumCvHighSp: { count: 0, pursue: 0, consider: 0, pass: 0, cases: [] },
    careerRegressionPursue: { count: 0, cases: [] },
    potentialContradictions: {
      highSpPass: 0,
      lowSpPursue: 0,
      highCvPass: 0,
      lowCvPursue: 0
    }
  };

  for (const r of records) {
    const cv = r.decisionSummary?.careerValue ?? 0;
    const sp = r.decisionSummary?.shortlistingPotential ?? 0;
    const friction = r.decisionSummary?.pursuitFriction ?? 0;
    const verb = r.verb;
    const rawScore = r.rawScore ?? 0;
    const trajectory = (r.trace?.careerValueBreakdown as any)?.trajectory;
    const regressionScore = (r.trace?.careerValueBreakdown as any)?.regressionScore;

    // P3-B Pattern Analysis

    // 1. Low CV + High SP + Low Friction (Easy Trap zone)
    if (cv < 50 && sp >= 80 && friction < 10) {
      analysis.lowCvHighSp.count++;
      analysis.lowCvHighSp.cases.push({
        jobHash: r.jobHash,
        verb,
        cv,
        sp,
        friction,
        rawScore,
        trajectory,
        vetoed: r.vetoed,
        vetoReason: r.vetoReason
      });
      if (verb === "PURSUE") {
        analysis.lowCvHighSp.pursue++;
      } else if (verb === "CONSIDER") {
        analysis.lowCvHighSp.consider++;
        // Check if this was an Easy Trap downgrade
        const pipeline = r.trace?.pipeline || [];
        const hasEasyTrap = pipeline.some((p: any) => p.stage === "CareerValueProtection");
        if (hasEasyTrap) {
          analysis.lowCvHighSp.easyTrapCandidates++;
        }
      } else if (verb === "PASS") {
        analysis.lowCvHighSp.pass++;
      }
    }

    // 2. High CV + Low SP
    if (cv >= 70 && sp < 30) {
      analysis.highCvLowSp.count++;
      analysis.highCvLowSp.cases.push({ jobHash: r.jobHash, verb, cv, sp, friction, rawScore });
      if (verb === "PURSUE") analysis.highCvLowSp.pursue++;
      else if (verb === "CONSIDER") analysis.highCvLowSp.consider++;
      else if (verb === "PASS") analysis.highCvLowSp.pass++;
    }

    // 3. High CV + High Friction
    if (cv >= 70 && friction >= 25) {
      analysis.highCvHighFriction.count++;
      analysis.highCvHighFriction.cases.push({ jobHash: r.jobHash, verb, cv, sp, friction, rawScore });
      if (verb === "PURSUE") analysis.highCvHighFriction.pursue++;
      else if (verb === "CONSIDER") analysis.highCvHighFriction.consider++;
      else if (verb === "PASS") analysis.highCvHighFriction.pass++;
    }

    // 4. Low CV + Low SP
    if (cv < 50 && sp < 50) {
      analysis.lowCvLowSp.count++;
      analysis.lowCvLowSp.cases.push({ jobHash: r.jobHash, verb, cv, sp, friction });
      if (verb === "PURSUE") analysis.lowCvLowSp.pursue++;
      else if (verb === "CONSIDER") analysis.lowCvLowSp.consider++;
      else if (verb === "PASS") analysis.lowCvLowSp.pass++;
    }

    // 5. Medium CV + High SP + Low Friction
    if (cv >= 50 && cv < 70 && sp >= 80 && friction < 10) {
      analysis.mediumCvHighSp.count++;
      analysis.mediumCvHighSp.cases.push({ jobHash: r.jobHash, verb, cv, sp, friction, rawScore });
      if (verb === "PURSUE") analysis.mediumCvHighSp.pursue++;
      else if (verb === "CONSIDER") analysis.mediumCvHighSp.consider++;
      else if (verb === "PASS") analysis.mediumCvHighSp.pass++;
    }

    // 6. Career Regression + PURSUE
    if ((trajectory === "BACKWARD" || regressionScore >= 50) && verb === "PURSUE") {
      analysis.careerRegressionPursue.count++;
      analysis.careerRegressionPursue.cases.push({
        jobHash: r.jobHash,
        verb,
        cv,
        sp,
        friction,
        rawScore,
        trajectory,
        regressionScore
      });
    }

    // 7. Potential Contradictions
    if (sp >= 80 && verb === "PASS") analysis.potentialContradictions.highSpPass++;
    if (sp < 30 && verb === "PURSUE") analysis.potentialContradictions.lowSpPursue++;
    if (cv >= 80 && verb === "PASS") analysis.potentialContradictions.highCvPass++;
    if (cv < 40 && verb === "PURSUE") analysis.potentialContradictions.lowCvPursue++;
  }

  return analysis;
}

function printCoherenceReport(analysis: CoherenceAnalysis) {
  console.log("\n" + "=".repeat(80));
  console.log("P3-B: DECISION/SIGNAL COHERENCE ANALYSIS");
  console.log("=".repeat(80));

  console.log(`\n📊 Total Records Analyzed: ${analysis.totalRecords}`);

  // Low CV + High SP
  console.log("\n" + "-".repeat(80));
  console.log("1. LOW CV (< 50) + HIGH SP (≥ 80) + LOW FRICTION (< 10)");
  console.log("-".repeat(80));
  console.log(`   Total Cases: ${analysis.lowCvHighSp.count}`);
  console.log(`   Easy Trap Downgrades (CONSIDER): ${analysis.lowCvHighSp.easyTrapCandidates}`);
  console.log(`   Still PURSUE (potential issue): ${analysis.lowCvHighSp.pursue}`);
  console.log(`   PASS (expected for vetoed): ${analysis.lowCvHighSp.pass}`);
  if (analysis.lowCvHighSp.pursue > 0) {
    console.log("\n   ⚠️ WARNING: Cases that should be CONSIDER but are PURSUE:");
    analysis.lowCvHighSp.cases
      .filter(c => c.verb === "PURSUE")
      .forEach(c => {
        console.log(`      - ${c.jobHash}: CV=${c.cv}, SP=${c.sp}, Friction=${c.friction}, Score=${c.rawScore}`);
      });
  }
  if (analysis.lowCvHighSp.easyTrapCandidates > 0) {
    console.log(`\n   ✅ Easy Trap correctly applied: ${analysis.lowCvHighSp.easyTrapCandidates} cases`);
  }

  // High CV + Low SP
  console.log("\n" + "-".repeat(80));
  console.log("2. HIGH CV (≥ 70) + LOW SP (< 30)");
  console.log("-".repeat(80));
  console.log(`   Total Cases: ${analysis.highCvLowSp.count}`);
  console.log(`   PURSUE (potential contradiction): ${analysis.highCvLowSp.pursue}`);
  console.log(`   CONSIDER: ${analysis.highCvLowSp.consider}`);
  console.log(`   PASS (expected): ${analysis.highCvLowSp.pass}`);
  if (analysis.highCvLowSp.pursue > 0) {
    console.log("\n   Cases with PURSUE (may indicate capability override):");
    analysis.highCvLowSp.cases
      .filter(c => c.verb === "PURSUE")
      .slice(0, 5)
      .forEach(c => {
        console.log(`      - ${c.jobHash}: CV=${c.cv}, SP=${c.sp}, Score=${c.rawScore}`);
      });
  }

  // High CV + High Friction
  console.log("\n" + "-".repeat(80));
  console.log("3. HIGH CV (≥ 70) + HIGH FRICTION (≥ 25)");
  console.log("-".repeat(80));
  console.log(`   Total Cases: ${analysis.highCvHighFriction.count}`);
  console.log(`   PURSUE: ${analysis.highCvHighFriction.pursue}`);
  console.log(`   CONSIDER: ${analysis.highCvHighFriction.consider}`);
  console.log(`   PASS: ${analysis.highCvHighFriction.pass}`);
  if (analysis.highCvHighFriction.pursue > analysis.highCvHighFriction.count * 0.5) {
    console.log("   ⚠️ NOTE: More than 50% are PURSUE - friction may not be penalizing enough");
  }

  // Low CV + Low SP
  console.log("\n" + "-".repeat(80));
  console.log("4. LOW CV (< 50) + LOW SP (< 50)");
  console.log("-".repeat(80));
  console.log(`   Total Cases: ${analysis.lowCvLowSp.count}`);
  console.log(`   PURSUE (should be rare): ${analysis.lowCvLowSp.pursue}`);
  console.log(`   CONSIDER: ${analysis.lowCvLowSp.consider}`);
  console.log(`   PASS (expected): ${analysis.lowCvLowSp.pass}`);
  if (analysis.lowCvLowSp.pursue > 0) {
    console.log("   ⚠️ WARNING: Low CV + Low SP should not be PURSUE:");
    analysis.lowCvLowSp.cases
      .filter(c => c.verb === "PURSUE")
      .forEach(c => {
        console.log(`      - ${c.jobHash}: CV=${c.cv}, SP=${c.sp}`);
      });
  }

  // Medium CV + High SP
  console.log("\n" + "-".repeat(80));
  console.log("5. MEDIUM CV (50-70) + HIGH SP (≥ 80) + LOW FRICTION (< 10)");
  console.log("-".repeat(80));
  console.log(`   Total Cases: ${analysis.mediumCvHighSp.count}`);
  console.log(`   PURSUE: ${analysis.mediumCvHighSp.pursue}`);
  console.log(`   CONSIDER: ${analysis.mediumCvHighSp.consider}`);
  console.log(`   PASS: ${analysis.mediumCvHighSp.pass}`);
  if (analysis.mediumCvHighSp.count > 0) {
    const pursueRate = analysis.mediumCvHighSp.pursue / analysis.mediumCvHighSp.count;
    console.log(`   PURSUE Rate: ${(pursueRate * 100).toFixed(1)}%`);
    if (pursueRate < 0.3) {
      console.log("   ⚠️ NOTE: Low pursue rate for medium CV + high SP - may be over-downgrading");
    }
  }

  // Career Regression + PURSUE
  console.log("\n" + "-".repeat(80));
  console.log("6. CAREER REGRESSION + PURSUE");
  console.log("-".repeat(80));
  console.log(`   Total Cases: ${analysis.careerRegressionPursue.count}`);
  if (analysis.careerRegressionPursue.count > 0) {
    console.log("   ⚠️ WARNING: Career regression should not result in PURSUE:");
    analysis.careerRegressionPursue.cases.forEach(c => {
      console.log(`      - ${c.jobHash}: trajectory=${c.trajectory}, regressionScore=${c.regressionScore}, CV=${c.cv}`);
    });
  } else {
    console.log("   ✅ No career regression cases with PURSUE");
  }

  // Potential Contradictions Summary
  console.log("\n" + "-".repeat(80));
  console.log("7. POTENTIAL CONTRADICTIONS SUMMARY");
  console.log("-".repeat(80));
  console.log(`   High SP (≥80) + PASS: ${analysis.potentialContradictions.highSpPass}`);
  console.log(`   Low SP (<30) + PURSUE: ${analysis.potentialContradictions.lowSpPursue}`);
  console.log(`   High CV (≥80) + PASS: ${analysis.potentialContradictions.highCvPass}`);
  console.log(`   Low CV (<40) + PURSUE: ${analysis.potentialContradictions.lowCvPursue}`);

  const totalContradictions =
    analysis.potentialContradictions.highSpPass +
    analysis.potentialContradictions.lowSpPursue +
    analysis.potentialContradictions.highCvPass +
    analysis.potentialContradictions.lowCvPursue;

  console.log(`\n   Total Potential Contradictions: ${totalContradictions}`);
  if (totalContradictions === 0) {
    console.log("   ✅ No obvious contradictions detected");
  } else if (totalContradictions < 20) {
    console.log("   ⚠️ Minor contradictions - may be edge cases");
  } else {
    console.log("   ❌ Significant contradictions - requires investigation");
  }

  console.log("\n" + "=".repeat(80));
  console.log("END OF P3-B ANALYSIS");
  console.log("=".repeat(80));
}

async function main() {
  console.log("P3-B: Running Decision/Signal Coherence Analysis...");

  invalidateEngineCache();

  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);

  const { records } = runEngine(projection, 0);

  const analysis = analyzeCoherence(records);
  printCoherenceReport(analysis);
}

main().catch(console.error);
