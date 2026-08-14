/**
 * Debug script for case j-cc222b05ee62
 * 
 * This script runs the engine and extracts detailed values for the specific case
 * to understand why the Career-Value Protection Rule isn't triggering.
 */

import { runEngine, invalidateEngineCache } from "../src/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../src/data/candidate-profile";

async function debugCase() {
  console.log("=".repeat(80));
  console.log("DEBUG: Case j-cc222b05ee62 Analysis");
  console.log("=".repeat(80));

  // Clear cache to ensure fresh run
  invalidateEngineCache();

  // Build candidate projection
  const builder = new CandidateProjectionBuilderImpl();
  const candidateProjection = builder.fromProfile(candidateProfile);

  // Run the engine
  const { records } = runEngine(candidateProjection, 0);

  // Find the target case
  const targetCase = records.find(r => r.jobHash === "j-cc222b05ee62");

  if (!targetCase) {
    console.error("\n❌ ERROR: Case j-cc222b05ee62 not found in the records!");
    console.log(`\nTotal records: ${records.length}`);
    return;
  }

  console.log("\n📋 CASE FOUND: j-cc222b05ee62");
  console.log("-".repeat(80));

  // Extract key values
  const cv = targetCase.decisionSummary?.careerValue ?? 0;
  const sp = targetCase.decisionSummary?.shortlistingPotential ?? 0;
  const friction = targetCase.decisionSummary?.pursuitFriction ?? 0;
  const careerScore = targetCase.trace?.factors?.careerValue ?? 0;
  
  // Get trajectory from trace or career assessment
  const trajectory = targetCase.trace?.careerValueBreakdown?.trajectory || 
                     (targetCase.trace as any)?.careerValueBreakdown?.titleProgression?.status ||
                     "UNKNOWN";

  const finalVerb = targetCase.verb;
  const vetoed = targetCase.vetoed;
  const vetoReason = targetCase.vetoReason;
  const rawScore = targetCase.rawScore;

  // Log all values
  console.log("\n🔍 EXTRACTED VALUES:");
  console.log("-".repeat(80));
  console.log(`  decisionSummary.careerValue:      ${cv}`);
  console.log(`  decisionSummary.shortlistingPotential: ${sp}`);
  console.log(`  decisionSummary.pursuitFriction:  ${friction}`);
  console.log(`  trace.factors.careerValue:        ${careerScore}`);
  console.log(`  trajectory (from trace):          ${trajectory}`);
  console.log(`  Final decision (verb):            ${finalVerb}`);
  console.log(`  Vetoed:                           ${vetoed}`);
  console.log(`  Veto Reason:                      ${vetoReason || "N/A"}`);
  console.log(`  Raw Score:                        ${rawScore}`);

  // Check ESI (overallFit)
  const esi = targetCase.esi ?? 0;
  console.log(`  ESI (capability.overallFit):      ${esi} (${(esi * 100).toFixed(1)}%)`);

  // Log careerValueBreakdown if available
  const cvb = targetCase.trace?.careerValueBreakdown;
  if (cvb) {
    console.log("\n📊 CAREER VALUE BREAKDOWN:");
    console.log("-".repeat(80));
    console.log(JSON.stringify(cvb, null, 2));
  }

  // Log pipeline stages
  const pipeline = targetCase.trace?.pipeline || [];
  console.log("\n🔄 PIPELINE STAGES:");
  console.log("-".repeat(80));
  for (const stage of pipeline) {
    console.log(`  ${stage.stage}: ${stage.status}${stage.score !== undefined ? ` (score: ${stage.score})` : ""}`);
    if (stage.reason) {
      const reasonStr = typeof stage.reason === "string" ? stage.reason : JSON.stringify(stage.reason);
      console.log(`    Reason: ${reasonStr}`);
    }
  }

  // Check triggered rules
  const triggeredRules = (targetCase as any).triggeredRuleIds || [];
  console.log("\n⚡ TRIGGERED RULES:");
  console.log("-".repeat(80));
  if (triggeredRules.length > 0) {
    for (const rule of triggeredRules) {
      console.log(`  - ${rule}`);
    }
  } else {
    console.log("  (No rules triggered)");
  }

  // Now evaluate the Career-Value Protection Rule conditions
  console.log("\n" + "=".repeat(80));
  console.log("🔬 CAREER-VALUE PROTECTION RULE ANALYSIS");
  console.log("=".repeat(80));

  console.log("\nRule conditions:");
  console.log("  1. SP >= 80 (capability.overallFit >= 0.80)");
  console.log("  2. Friction <= 10");
  console.log("  3. career.trajectory === 'BACKWARD'");
  console.log("  4. careerScore <= 50");
  console.log("  5. rawScore >= PURSUE threshold AND identityScore >= identityPursueCutoff");

  // Check if trajectory is in the pipeline
  const careerStage = pipeline.find((p: any) => p.stage === "Career");
  const trajectoryFromPipeline = careerStage?.reason?.toString() || trajectory;
  
  // Extract trajectory value from "Trajectory: LATERAL" format
  const trajectoryMatch = trajectoryFromPipeline.match(/Trajectory:\s*(\w+)/);
  const actualTrajectory = trajectoryMatch ? trajectoryMatch[1] : trajectory;
  
  // Reconstruct the values used by the rule
  const spHigh = sp >= 80;
  const frictionLow = friction <= 10;
  const careerBackward = actualTrajectory === "BACKWARD";
  const careerValueLow = careerScore <= 50 || cv <= 50;

  console.log("\n📋 ACTUAL VALUES CHECK:");
  console.log("-".repeat(80));
  console.log(`  SP >= 80?                       ${spHigh} (SP = ${sp})`);
  console.log(`  Friction <= 10?                 ${frictionLow} (Friction = ${friction})`);
  console.log(`  Trajectory BACKWARD?            ${careerBackward} (Actual Trajectory = ${actualTrajectory})`);
  console.log(`  Career Score <= 50?             ${careerValueLow} (Career Score = ${careerScore}, CV = ${cv})`);

  const allConditionsMet = spHigh && frictionLow && careerBackward && careerValueLow;
  console.log(`\n  All rule conditions met?        ${allConditionsMet}`);

  // Check if PURSUE threshold was even reached
  console.log("\n🎯 PURSUE THRESHOLD CHECK:");
  console.log("-".repeat(80));
  
  // Get thresholds from policy
  const PURSUE_THRESHOLD = 65; // From decision_policy.json
  const IDENTITY_PURSU_CUTOFF = 65; // identityPursueCutoff
  
  // Get identity score from pipeline
  const identityStage = pipeline.find((p: any) => p.stage === "Identity");
  const identityScore = identityStage?.score ?? 0;
  
  const wouldBePursue = rawScore >= PURSUE_THRESHOLD && identityScore >= IDENTITY_PURSU_CUTOFF;
  
  console.log(`  PURSUE threshold:                ${PURSUE_THRESHOLD}`);
  console.log(`  Identity PURSUE cutoff:          ${IDENTITY_PURSU_CUTOFF}`);
  console.log(`  Raw score:                       ${rawScore}`);
  console.log(`  Identity score:                  ${identityScore}`);
  console.log(`  Would be PURSUE?                  ${wouldBePursue}`);
  console.log(`\n  Final decision:                  ${finalVerb}`);

  if (!wouldBePursue) {
    console.log("\n⚠️  REASON: Case didn't reach PURSUE threshold, so protection rule never triggered.");
  } else if (!allConditionsMet) {
    console.log("\n⚠️  REASON: Case reached PURSUE but didn't meet all protection rule conditions:");
    if (!spHigh) console.log("     - SP < 80 (high shortlisting not detected)");
    if (!frictionLow) console.log("     - Friction > 10 (not low friction)");
    if (!careerBackward) console.log(`     - Trajectory is '${actualTrajectory}', not BACKWARD`);
    if (!careerValueLow) console.log("     - Career Score > 50 (not low career value)");
  } else {
    console.log("\n✅ Rule should have triggered! This is unexpected.");
    console.log("   All conditions met and would be PURSUE, but rule didn't downgrade to CONSIDER.");
  }

  // Additional debug info
  console.log("\n" + "=".repeat(80));
  console.log("📄 FULL RECORD DUMP");
  console.log("=".repeat(80));
  
  const minimalRecord = {
    jobHash: targetCase.jobHash,
    verb: targetCase.verb,
    rawScore: targetCase.rawScore,
    priority: targetCase.priority,
    vetoed: targetCase.vetoed,
    vetoReason: targetCase.vetoReason,
    decisionSummary: targetCase.decisionSummary,
    esi: targetCase.esi,
    trace: {
      factors: targetCase.trace?.factors,
      careerValueBreakdown: targetCase.trace?.careerValueBreakdown,
      pipeline: targetCase.trace?.pipeline?.map((p: any) => ({ 
        stage: p.stage, 
        status: p.status, 
        score: p.score 
      })),
    }
  };
  
  console.log(JSON.stringify(minimalRecord, null, 2));
}

debugCase().catch(err => {
  console.error("Error running debug script:", err);
  process.exit(1);
});
