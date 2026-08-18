/**
 * P4-A Phase 2 Deep Dive: Score Anomaly Forensic Analysis
 * 
 * Investigate why 936 opportunities score exactly 0
 * and why there's a 60-point gap
 */

import { runEngine, invalidateEngineCache } from "../src/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../src/data/candidate-profile";

interface AnomalyRecord {
  jobHash: string;
  priority: number | null;
  rawScore?: number;
  vetoed?: boolean;
  vetoReason?: string | null;
  verb: string;
  decisionSummary: {
    careerValue: number;
    shortlistingPotential: number;
    pursuitFriction: number;
  };
  trace?: any;
}

function deepAnomalyAnalysis() {
  console.log("=== P4-A Deep Dive: Score Anomaly Forensic Analysis ===\n");
  
  invalidateEngineCache();
  
  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);
  
  const { records } = runEngine(projection, 0);
  
  // Categorize by score patterns
  const scoreZero = records.filter(r => r.priority === 0);
  const scoreNull = records.filter(r => r.priority === null);
  const scoreNonZero = records.filter(r => r.priority !== null && r.priority !== undefined && r.priority > 0);
  
  console.log(`Total records: ${records.length}`);
  console.log(`Score = 0: ${scoreZero.length}`);
  console.log(`Score = null: ${scoreNull.length}`);
  console.log(`Score > 0: ${scoreNonZero.length}`);
  console.log(`\n`);
  
  // Analyze score 0 records
  console.log("=== ANALYZING SCORE = 0 RECORDS ===\n");
  
  const zeroVetoed = scoreZero.filter(r => r.vetoed);
  const zeroNotVetoed = scoreZero.filter(r => !r.vetoed);
  
  console.log(`Score 0 - Vetoed: ${zeroVetoed.length}`);
  console.log(`Score 0 - Not vetoed: ${zeroNotVetoed.length}`);
  console.log(`\n`);
  
  // Veto reasons for score 0
  const vetoReasons: Record<string, number> = {};
  for (const r of zeroVetoed) {
    const reason = r.vetoReason || "NO_REASON";
    vetoReasons[reason] = (vetoReasons[reason] || 0) + 1;
  }
  
  console.log("Veto reasons for score=0:");
  for (const [reason, count] of Object.entries(vetoReasons).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count}`);
  }
  console.log(`\n`);
  
  // Analyze non-vetoed score 0
  console.log("=== NON-VETOED SCORE 0 ANALYSIS ===\n");
  
  if (zeroNotVetoed.length > 0) {
    console.log(`Found ${zeroNotVetoed.length} records with score=0 but NOT vetoed`);
    console.log("Sample records:");
    
    for (let i = 0; i < Math.min(5, zeroNotVetoed.length); i++) {
      const r = zeroNotVetoed[i];
      console.log(`\n${r.jobHash}:`);
      console.log(`  Verb: ${r.verb}`);
      console.log(`  RawScore: ${r.rawScore}`);
      console.log(`  Priority: ${r.priority}`);
      console.log(`  CV: ${r.decisionSummary?.careerValue}`);
      console.log(`  SP: ${r.decisionSummary?.shortlistingPotential}`);
      console.log(`  Friction: ${r.decisionSummary?.pursuitFriction}`);
      console.log(`  Trace pipeline:`, r.trace?.pipeline?.map((p: any) => `${p.stage}:${p.status}:${p.score}`).join(" → "));
    }
  }
  
  // Analyze vetoed score 0
  console.log("\n=== VETOED SCORE 0 ANALYSIS ===\n");
  
  console.log(`Found ${zeroVetoed.length} records with score=0 AND vetoed`);
  console.log("Sample records:");
  
  for (let i = 0; i < Math.min(5, zeroVetoed.length); i++) {
    const r = zeroVetoed[i];
    console.log(`\n${r.jobHash}:`);
    console.log(`  Verb: ${r.verb}`);
    console.log(`  RawScore: ${r.rawScore}`);
    console.log(`  Priority: ${r.priority}`);
    console.log(`  Vetoed: ${r.vetoed}`);
    console.log(`  VetoReason: ${r.vetoReason}`);
    console.log(`  CV: ${r.decisionSummary?.careerValue}`);
    console.log(`  SP: ${r.decisionSummary?.shortlistingPotential}`);
    console.log(`  Friction: ${r.decisionSummary?.pursuitFriction}`);
  }
  
  // Analyze score null
  console.log("\n=== SCORE NULL ANALYSIS ===\n");
  
  const nullVetoed = scoreNull.filter(r => r.vetoed);
  const nullNotVetoed = scoreNull.filter(r => !r.vetoed);
  
  console.log(`Score null - Vetoed: ${nullVetoed.length}`);
  console.log(`Score null - Not vetoed: ${nullNotVetoed.length}`);
  
  if (nullNotVetoed.length > 0) {
    console.log(`\n⚠️ WARNING: ${nullNotVetoed.length} records have null priority but are NOT vetoed`);
    console.log("Samples:");
    for (let i = 0; i < Math.min(3, nullNotVetoed.length); i++) {
      const r = nullNotVetoed[i];
      console.log(`  ${r.jobHash}: verb=${r.verb}, rawScore=${r.rawScore}`);
    }
  }
  
  // Trace pipeline for score 0
  console.log("\n=== PIPELINE TRACE FOR SCORE 0 ===\n");
  
  for (let i = 0; i < Math.min(3, scoreZero.length); i++) {
    const r = scoreZero[i];
    console.log(`\n${r.jobHash}:`);
    console.log(`  Final: priority=${r.priority}, verb=${r.verb}, vetoed=${r.vetoed}`);
    
    if (r.trace?.pipeline) {
      console.log("  Pipeline:");
      for (const stage of r.trace.pipeline) {
        console.log(`    ${stage.stage}: ${stage.status} (score: ${stage.score})`);
        if (stage.reason) {
          const reasonStr = typeof stage.reason === 'object' 
            ? JSON.stringify(stage.reason).substring(0, 80)
            : String(stage.reason).substring(0, 80);
          console.log(`      Reason: ${reasonStr}`);
        }
      }
    }
  }
  
  // Analyze score gaps
  console.log("\n=== SCORE GAP ANALYSIS ===\n");
  
  const allScores = records
    .filter(r => r.priority !== null && r.priority !== undefined)
    .map(r => r.priority!)
    .sort((a, b) => a - b);
  
  const uniqueScores = [...new Set(allScores)].sort((a, b) => a - b);
  
  console.log("Score presence check:");
  for (let score = 0; score <= 100; score += 10) {
    const hasScore = uniqueScores.includes(score);
    const nearby = uniqueScores.filter(s => s >= score && s < score + 10);
    console.log(`  ${score.toString().padStart(3)}-${(score+9).toString().padStart(3)}: ${hasScore ? '✓' : '✗'} (${nearby.length} unique scores in range)`);
  }
  
  // Find largest gaps
  console.log("\n=== LARGEST SCORE GAPS ===\n");
  
  const gaps: { from: number; to: number; size: number }[] = [];
  for (let i = 1; i < uniqueScores.length; i++) {
    const gap = uniqueScores[i] - uniqueScores[i - 1];
    if (gap > 1) {
      gaps.push({ from: uniqueScores[i - 1], to: uniqueScores[i], size: gap });
    }
  }
  
  gaps.sort((a, b) => b.size - a.size);
  
  console.log("Top 10 gaps:");
  for (const gap of gaps.slice(0, 10)) {
    console.log(`  ${gap.from} → ${gap.to}: ${gap.size} points`);
  }
  
  // Decision vs score analysis
  console.log("\n=== DECISION vs SCORE MISMATCH ===\n");
  
  const pursueLowScore = records.filter(r => r.verb === "PURSUE" && (r.priority || 0) < 70);
  const considerHighScore = records.filter(r => r.verb === "CONSIDER" && (r.priority || 0) >= 70);
  const passHighScore = records.filter(r => r.verb === "PASS" && (r.priority || 0) >= 60);
  
  console.log(`PURSUE with score < 70: ${pursueLowScore.length}`);
  if (pursueLowScore.length > 0) {
    console.log("  Samples:", pursueLowScore.slice(0, 3).map(r => `${r.jobHash}(${r.priority})`).join(", "));
  }
  
  console.log(`CONSIDER with score >= 70: ${considerHighScore.length}`);
  if (considerHighScore.length > 0) {
    console.log("  Samples:", considerHighScore.slice(0, 3).map(r => `${r.jobHash}(${r.priority})`).join(", "));
  }
  
  console.log(`PASS with score >= 60: ${passHighScore.length}`);
  if (passHighScore.length > 0) {
    console.log("  Samples:", passHighScore.slice(0, 3).map(r => `${r.jobHash}(${r.priority})`).join(", "));
  }
  
  // Trace rawScore vs priority
  console.log("\n=== RAW SCORE vs PRIORITY ===\n");
  
  const mismatches = records.filter(r => r.rawScore !== undefined && r.priority !== null && r.rawScore !== r.priority);
  console.log(`Records where rawScore !== priority: ${mismatches.length}`);
  
  if (mismatches.length > 0) {
    console.log("Samples:");
    for (let i = 0; i < Math.min(5, mismatches.length); i++) {
      const r = mismatches[i];
      console.log(`  ${r.jobHash}: rawScore=${r.rawScore}, priority=${r.priority}, vetoed=${r.vetoed}`);
    }
  }
  
  // Final summary
  console.log("\n=== ANOMALY SUMMARY ===\n");
  console.log("1. SCORE 0 ANOMALY:");
  console.log(`   - ${scoreZero.length} records score exactly 0`);
  console.log(`   - ${zeroVetoed.length} are vetoed (expected)`);
  console.log(`   - ${zeroNotVetoed.length} are NOT vetoed (investigate)`);
  console.log(`   - ${(scoreZero.length / records.length * 100).toFixed(1)}% of corpus`);
  
  console.log("\n2. SCORE NULL ANOMALY:");
  console.log(`   - ${scoreNull.length} records have null priority`);
  console.log(`   - ${nullVetoed.length} are vetoed`);
  console.log(`   - ${nullNotVetoed.length} are NOT vetoed (CRITICAL)`);
  
  console.log("\n3. GAP ANOMALY:");
  console.log(`   - Largest gap: ${gaps[0]?.size || 0} points`);
  console.log(`   - Only ${uniqueScores.length} unique scores used`);
  console.log(`   - ${(100 - uniqueScores.length)} scores unused`);
  
  console.log("\n4. DECISION THRESHOLD:");
  console.log(`   - PURSUE threshold: 70`);
  console.log(`   - CONSIDER threshold: 60`);
  console.log(`   - PASS threshold: <60`);
  console.log(`   - No opportunities between 1-59`);
}

deepAnomalyAnalysis();
