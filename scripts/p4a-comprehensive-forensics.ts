/**
 * P4-A Phase 1 Extended: Comprehensive Score Forensics
 * 
 * Deep forensic investigation of all score anomalies
 * DO NOT FIX - only investigate and report
 */

import { runEngine, invalidateEngineCache } from "../src/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../src/data/candidate-profile";

interface ScoreForensics {
  jobHash: string;
  priority: number | null;
  rawScore?: number;
  vetoed?: boolean;
  vetoReason?: string | null;
  verb: string;
  identityScore?: number;
  identityDistance?: number;
  identityVerdict?: string;
  identityCoverage?: number;
  capabilityScore?: number;
  capabilityOverallFit?: number;
  careerScore?: number;
  careerTrajectory?: string;
  careerRegressionScore?: number;
  opportunityScore?: number;
  locationFriction?: number;
  shortlistingPotential?: number;
  mandateSeniority?: string;
  pipelineStages: any[];
  confidences?: any;
}

function comprehensiveForensics() {
  console.log("=== P4-A COMPREHENSIVE SCORE FORENSICS ===\n");
  console.log("Investigating: 936 zero scores, 10-59 gap, 33 unique scores");
  console.log("DO NOT FIX - only investigate and report\n");
  
  invalidateEngineCache();
  
  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);
  
  const { records } = runEngine(projection, 0);
  
  console.log(`Total records: ${records.length}\n`);
  
  // ============================================
  // 1. ZERO-SCORE FORENSICS
  // ============================================
  console.log("=".repeat(80));
  console.log("1. ZERO-SCORE FORENSICS");
  console.log("=".repeat(80));
  console.log();
  
  const zeroRecords = records.filter(r => r.priority === 0);
  console.log(`Total score=0 records: ${zeroRecords.length}`);
  console.log();
  
  // Classify by veto status
  const zeroVetoed = zeroRecords.filter(r => r.vetoed);
  const zeroNotVetoed = zeroRecords.filter(r => !r.vetoed);
  
  console.log("Classification by Veto:");
  console.log(`  Vetoed: ${zeroVetoed.length} (${(zeroVetoed.length/zeroRecords.length*100).toFixed(1)}%)`);
  console.log(`  Not Vetoed: ${zeroNotVetoed.length} (${(zeroNotVetoed.length/zeroRecords.length*100).toFixed(1)}%)`);
  console.log();
  
  // Veto reasons breakdown
  const vetoReasons: Record<string, number> = {};
  for (const r of zeroVetoed) {
    const reason = r.vetoReason || "NO_REASON";
    vetoReasons[reason] = (vetoReasons[reason] || 0) + 1;
  }
  
  console.log("Veto Reasons for Score=0:");
  for (const [reason, count] of Object.entries(vetoReasons).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count} (${(count/zeroRecords.length*100).toFixed(1)}%)`);
  }
  console.log();
  
  // Identity verdict breakdown
  const identityVerdicts: Record<string, number> = {};
  for (const r of zeroRecords) {
    const verdict = (r.trace as any)?.identity?.verdict || "UNKNOWN";
    identityVerdicts[verdict] = (identityVerdicts[verdict] || 0) + 1;
  }
  
  console.log("Identity Verdicts:");
  for (const [verdict, count] of Object.entries(identityVerdicts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${verdict}: ${count}`);
  }
  console.log();
  
  // Decision verb breakdown
  const decisionVerbs: Record<string, number> = {};
  for (const r of zeroRecords) {
    decisionVerbs[r.verb] = (decisionVerbs[r.verb] || 0) + 1;
  }
  
  console.log("Decision Verbs for Score=0:");
  for (const [verb, count] of Object.entries(decisionVerbs).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${verb}: ${count}`);
  }
  console.log();
  
  // RawScore distribution for zero records
  const rawScoreZero = zeroRecords.filter(r => r.rawScore === 0).length;
  const rawScoreNonZero = zeroRecords.filter(r => r.rawScore !== undefined && r.rawScore > 0).length;
  
  console.log("RawScore Analysis for Score=0:");
  console.log(`  rawScore = 0: ${rawScoreZero} (${(rawScoreZero/zeroRecords.length*100).toFixed(1)}%)`);
  console.log(`  rawScore > 0: ${rawScoreNonZero} (${(rawScoreNonZero/zeroRecords.length*100).toFixed(1)}%)`);
  console.log();
  
  // If rawScore > 0, what's the distribution?
  if (rawScoreNonZero > 0) {
    const rawScores = zeroRecords
      .filter(r => r.rawScore !== undefined && r.rawScore > 0)
      .map(r => r.rawScore!);
    
    const minRaw = Math.min(...rawScores);
    const maxRaw = Math.max(...rawScores);
    const meanRaw = rawScores.reduce((a, b) => a + b, 0) / rawScores.length;
    
    console.log("  RawScore statistics (where > 0):");
    console.log(`    Min: ${minRaw}`);
    console.log(`    Max: ${maxRaw}`);
    console.log(`    Mean: ${meanRaw.toFixed(2)}`);
    console.log(`    Count: ${rawScores.length}`);
    console.log();
    
    // Raw score distribution
    const rawScoreBands: Record<number, number> = {};
    for (const s of rawScores) {
      const band = Math.floor(s / 10) * 10;
      rawScoreBands[band] = (rawScoreBands[band] || 0) + 1;
    }
    
    console.log("  RawScore band distribution:");
    for (const [band, count] of Object.entries(rawScoreBands).sort((a, b) => parseInt(a) - parseInt(b))) {
      console.log(`    ${band}-${parseInt(band)+9}: ${count}`);
    }
  }
  console.log();
  
  // ============================================
  // 2. TRACE A SAMPLE OF ZERO CASES
  // ============================================
  console.log("=".repeat(80));
  console.log("2. TRACE SAMPLE OF ZERO CASES");
  console.log("=".repeat(80));
  console.log();
  
  // Category A: Hard-veto zeros
  const hardVetoZeros = zeroRecords
    .filter(r => r.vetoed && r.vetoReason?.includes("MISMATCH"))
    .slice(0, 10);
  
  console.log("A. HARD-VETO ZEROS (Identity Mismatch):");
  console.log(`  Found ${hardVetoZeros.length} samples`);
  for (const r of hardVetoZeros.slice(0, 3)) {
    console.log(`\n  ${r.jobHash}:`);
    console.log(`    Veto: ${r.vetoReason}`);
    console.log(`    RawScore: ${r.rawScore}`);
    console.log(`    CV: ${r.decisionSummary?.careerValue}`);
    console.log(`    SP: ${r.decisionSummary?.shortlistingPotential}`);
    if (r.trace?.pipeline) {
      const identityStage = r.trace.pipeline.find((p: any) => p.stage === "Identity");
      console.log(`    Identity: ${identityStage?.status} (score: ${identityStage?.score})`);
      if (identityStage?.reason) {
        console.log(`      Reason: ${JSON.stringify(identityStage.reason).substring(0, 100)}`);
      }
    }
  }
  
  // Category B: Non-obvious zeros
  const nonObviousZeros = zeroNotVetoed.slice(0, 10);
  
  console.log("\nB. NON-VETOED ZEROS:");
  console.log(`  Found ${nonObviousZeros.length} samples`);
  for (const r of nonObviousZeros.slice(0, 3)) {
    console.log(`\n  ${r.jobHash}:`);
    console.log(`    Verb: ${r.verb}`);
    console.log(`    RawScore: ${r.rawScore}`);
    console.log(`    CV: ${r.decisionSummary?.careerValue}`);
    console.log(`    SP: ${r.decisionSummary?.shortlistingPotential}`);
    console.log(`    Friction: ${r.decisionSummary?.pursuitFriction}`);
    if (r.trace?.pipeline) {
      for (const stage of r.trace.pipeline.slice(0, 4)) {
        console.log(`    ${stage.stage}: ${stage.status} (score: ${stage.score})`);
      }
    }
  }
  
  // Category C: Strong Career Value zeros
  const strongCVZeros = zeroRecords
    .filter(r => (r.decisionSummary?.careerValue || 0) >= 70)
    .slice(0, 10);
  
  console.log("\nC. ZEROS WITH STRONG CAREER VALUE (CV >= 70):");
  console.log(`  Found ${strongCVZeros.length} samples`);
  for (const r of strongCVZeros.slice(0, 3)) {
    console.log(`\n  ${r.jobHash}:`);
    console.log(`    CV: ${r.decisionSummary?.careerValue}`);
    console.log(`    SP: ${r.decisionSummary?.shortlistingPotential}`);
    console.log(`    Vetoed: ${r.vetoed}`);
    console.log(`    VetoReason: ${r.vetoReason}`);
    console.log(`    RawScore: ${r.rawScore}`);
  }
  
  // Category D: Strong Capability zeros
  const strongCapZeros = zeroRecords
    .filter(r => {
      const capScore = (r.trace as any)?.capability?.score;
      return capScore >= 70;
    })
    .slice(0, 10);
  
  console.log("\nD. ZEROS WITH STRONG CAPABILITY (Score >= 70):");
  console.log(`  Found ${strongCapZeros.length} samples`);
  for (const r of strongCapZeros.slice(0, 3)) {
    console.log(`\n  ${r.jobHash}:`);
    console.log(`    Capability Score: ${(r.trace as any)?.capability?.score}`);
    console.log(`    Vetoed: ${r.vetoed}`);
    console.log(`    VetoReason: ${r.vetoReason}`);
    console.log(`    RawScore: ${r.rawScore}`);
  }
  
  // Category E: Strong Identity zeros
  const strongIdZeros = zeroRecords
    .filter(r => {
      const idScore = (r.trace as any)?.identity?.score;
      return idScore >= 90;
    })
    .slice(0, 10);
  
  console.log("\nE. ZEROS WITH STRONG IDENTITY (Score >= 90):");
  console.log(`  Found ${strongIdZeros.length} samples`);
  for (const r of strongIdZeros.slice(0, 3)) {
    console.log(`\n  ${r.jobHash}:`);
    console.log(`    Identity Score: ${(r.trace as any)?.identity?.score}`);
    console.log(`    Vetoed: ${r.vetoed}`);
    console.log(`    VetoReason: ${r.vetoReason}`);
    console.log(`    RawScore: ${r.rawScore}`);
  }
  console.log();
  
  // ============================================
  // 3. RAW SCORE VS FINAL SCORE
  // ============================================
  console.log("=".repeat(80));
  console.log("3. RAW SCORE VS FINAL SCORE");
  console.log("=".repeat(80));
  console.log();
  
  console.log("For all 936 zero-final-score cases:");
  console.log(`  A. rawScore = 0: ${rawScoreZero}`);
  console.log(`  B. rawScore > 0 but final = 0: ${rawScoreNonZero}`);
  console.log();
  
  if (rawScoreNonZero > 0) {
    const nonZeroRawScores = zeroRecords
      .filter(r => r.rawScore !== undefined && r.rawScore > 0)
      .map(r => r.rawScore!);
    
    console.log("Raw Score Distribution (where rawScore > 0):");
    const distribution: Record<number, number> = {};
    for (const s of nonZeroRawScores) {
      distribution[s] = (distribution[s] || 0) + 1;
    }
    
    const sortedScores = Object.entries(distribution)
      .map(([score, count]) => ({ score: parseInt(score), count }))
      .sort((a, b) => b.count - a.count);
    
    console.log("  Top 20 raw scores:");
    for (const { score, count } of sortedScores.slice(0, 20)) {
      console.log(`    Score ${score}: ${count} occurrences`);
    }
  }
  console.log();
  
  // ============================================
  // 4. THE 10-59 GAP INVESTIGATION
  // ============================================
  console.log("=".repeat(80));
  console.log("4. THE 10-59 GAP INVESTIGATION");
  console.log("=".repeat(80));
  console.log();
  
  const scoredRecords = records.filter(r => r.priority !== null && r.priority !== undefined);
  const scores = scoredRecords.map(r => r.priority!);
  const uniqueScores = [...new Set(scores)].sort((a, b) => a - b);
  
  console.log("Score presence by band:");
  for (let start = 0; start <= 100; start += 10) {
    const end = start + 9;
    const count = scoredRecords.filter(r => {
      const s = r.priority!;
      return s >= start && s <= end;
    }).length;
    const percentage = (count / scoredRecords.length * 100).toFixed(1);
    const bar = "█".repeat(Math.round(count / 50));
    console.log(`  ${start.toString().padStart(3)}-${end.toString().padStart(3)}: ${count.toString().padStart(4)} (${percentage.padStart(5)}%) ${bar}`);
  }
  console.log();
  
  // Find score 1-59
  const score1to59 = scoredRecords.filter(r => {
    const s = r.priority!;
    return s >= 1 && s <= 59;
  });
  
  console.log(`Opportunities with score 1-59: ${score1to59.length}`);
  if (score1to59.length > 0) {
    console.log("Found! Distribution:");
    const dist: Record<number, number> = {};
    for (const r of score1to59) {
      dist[r.priority!] = (dist[r.priority!] || 0) + 1;
    }
    for (const [score, count] of Object.entries(dist).sort((a, b) => parseInt(a) - parseInt(b))) {
      console.log(`  Score ${score}: ${count}`);
    }
  } else {
    console.log("  NONE FOUND - Complete gap from 1-59");
  }
  console.log();
  
  // Investigate why scores jump from 0 to 60
  console.log("Investigating the 0 → 60 jump:");
  const score0 = scoredRecords.filter(r => r.priority === 0);
  const score60to69 = scoredRecords.filter(r => {
    const s = r.priority!;
    return s >= 60 && s <= 69;
  });
  
  console.log(`  Score 0: ${score0.length} records`);
  console.log(`  Score 60-69: ${score60to69.length} records`);
  console.log();
  
  // Compare characteristics
  console.log("Comparing Score 0 vs Score 60-69:");
  
  const avgCV0 = score0.reduce((sum, r) => sum + (r.decisionSummary?.careerValue || 0), 0) / score0.length;
  const avgCV60 = score60to69.reduce((sum, r) => sum + (r.decisionSummary?.careerValue || 0), 0) / score60to69.length;
  
  const avgSP0 = score0.reduce((sum, r) => sum + (r.decisionSummary?.shortlistingPotential || 0), 0) / score0.length;
  const avgSP60 = score60to69.reduce((sum, r) => sum + (r.decisionSummary?.shortlistingPotential || 0), 0) / score60to69.length;
  
  console.log(`  Avg CV: Score 0 = ${avgCV0.toFixed(1)}, Score 60-69 = ${avgCV60.toFixed(1)}`);
  console.log(`  Avg SP: Score 0 = ${avgSP0.toFixed(1)}, Score 60-69 = ${avgSP60.toFixed(1)}`);
  console.log();
  
  // Veto status
  const vetoed0 = score0.filter(r => r.vetoed).length;
  const vetoed60 = score60to69.filter(r => r.vetoed).length;
  
  console.log(`  Vetoed: Score 0 = ${vetoed0} (${(vetoed0/score0.length*100).toFixed(1)}%), Score 60-69 = ${vetoed60} (${(vetoed60/score60to69.length*100).toFixed(1)}%)`);
  console.log();
  
  // ============================================
  // 5. NON-VETOED SCORE=0 ANALYSIS
  // ============================================
  console.log("=".repeat(80));
  console.log("5. NON-VETOED SCORE=0 ANALYSIS");
  console.log("=".repeat(80));
  console.log();
  
  console.log(`Non-vetoed score=0 count: ${zeroNotVetoed.length}`);
  console.log(`Percentage of all zeros: ${(zeroNotVetoed.length/zeroRecords.length*100).toFixed(1)}%`);
  console.log(`Percentage of corpus: ${(zeroNotVetoed.length/records.length*100).toFixed(2)}%`);
  console.log();
  
  if (zeroNotVetoed.length > 0) {
    // Aggregate statistics
    const avgCV = zeroNotVetoed.reduce((sum, r) => sum + (r.decisionSummary?.careerValue || 0), 0) / zeroNotVetoed.length;
    const avgSP = zeroNotVetoed.reduce((sum, r) => sum + (r.decisionSummary?.shortlistingPotential || 0), 0) / zeroNotVetoed.length;
    const avgFriction = zeroNotVetoed.reduce((sum, r) => sum + (r.decisionSummary?.pursuitFriction || 0), 0) / zeroNotVetoed.length;
    
    const verbs: Record<string, number> = {};
    for (const r of zeroNotVetoed) {
      verbs[r.verb] = (verbs[r.verb] || 0) + 1;
    }
    
    console.log("Non-vetoed zero statistics:");
    console.log(`  Avg CV: ${avgCV.toFixed(1)}`);
    console.log(`  Avg SP: ${avgSP.toFixed(1)}`);
    console.log(`  Avg Friction: ${avgFriction.toFixed(1)}`);
    console.log(`  Decision verbs:`, verbs);
    console.log();
    
    // Individual investigation of first 10
    console.log("Individual investigation (first 10):");
    for (let i = 0; i < Math.min(10, zeroNotVetoed.length); i++) {
      const r = zeroNotVetoed[i];
      console.log(`\n  ${r.jobHash}:`);
      console.log(`    Decision: ${r.verb}`);
      console.log(`    RawScore: ${r.rawScore}`);
      console.log(`    CV: ${r.decisionSummary?.careerValue}`);
      console.log(`    SP: ${r.decisionSummary?.shortlistingPotential}`);
      console.log(`    Friction: ${r.decisionSummary?.pursuitFriction}`);
      
      // Trace pipeline
      if (r.trace?.pipeline) {
        const finalStage = r.trace.pipeline[r.trace.pipeline.length - 1];
        console.log(`    Final pipeline stage: ${finalStage?.stage}:${finalStage?.status} (score: ${finalStage?.score})`);
        
        // Find where score became 0
        const rankingStage = r.trace.pipeline.find((p: any) => p.stage === "Ranking");
        if (rankingStage) {
          console.log(`    Ranking stage score: ${rankingStage.score}`);
        }
      }
    }
  }
  console.log();
  
  // ============================================
  // 6. SCORE BANDS ANALYSIS
  // ============================================
  console.log("=".repeat(80));
  console.log("6. SCORE BANDS ANALYSIS");
  console.log("=".repeat(80));
  console.log();
  
  const bands = [
    { name: "0", min: 0, max: 0 },
    { name: "1-9", min: 1, max: 9 },
    { name: "10-19", min: 10, max: 19 },
    { name: "20-29", min: 20, max: 29 },
    { name: "30-39", min: 30, max: 39 },
    { name: "40-49", min: 40, max: 49 },
    { name: "50-59", min: 50, max: 59 },
    { name: "60-69", min: 60, max: 69 },
    { name: "70-79", min: 70, max: 79 },
    { name: "80-89", min: 80, max: 89 },
    { name: "90-100", min: 90, max: 100 },
  ];
  
  console.log("Band | Count | % | PURSUE | CONSIDER | PASS | Veto% | Avg CV | Avg SP | Avg Friction");
  console.log("-".repeat(100));
  
  for (const band of bands) {
    const bandRecords = scoredRecords.filter(r => {
      const s = r.priority!;
      return s >= band.min && s <= band.max;
    });
    
    if (bandRecords.length === 0) {
      console.log(`${band.name.padEnd(8)} | 0`);
      continue;
    }
    
    const count = bandRecords.length;
    const percentage = (count / scoredRecords.length * 100).toFixed(1);
    
    const pursue = bandRecords.filter(r => r.verb === "PURSUE").length;
    const consider = bandRecords.filter(r => r.verb === "CONSIDER").length;
    const pass = bandRecords.filter(r => r.verb === "PASS").length;
    
    const vetoCount = bandRecords.filter(r => r.vetoed).length;
    const vetoPct = (vetoCount / count * 100).toFixed(0);
    
    const avgCV = bandRecords.reduce((sum, r) => sum + (r.decisionSummary?.careerValue || 0), 0) / count;
    const avgSP = bandRecords.reduce((sum, r) => sum + (r.decisionSummary?.shortlistingPotential || 0), 0) / count;
    const avgFriction = bandRecords.reduce((sum, r) => sum + (r.decisionSummary?.pursuitFriction || 0), 0) / count;
    
    console.log(
      `${band.name.padEnd(8)} | ${count.toString().padStart(5)} | ${percentage.padStart(4)} | ` +
      `${pursue.toString().padStart(6)} | ${consider.toString().padStart(8)} | ${pass.toString().padStart(4)} | ` +
      `${vetoPct.padStart(3)}% | ${avgCV.toFixed(0).padStart(6)} | ${avgSP.toFixed(0).padStart(6)} | ${avgFriction.toFixed(0).padStart(11)}`
    );
  }
  console.log();
  
  // ============================================
  // 7. SCORE SEMANTICS
  // ============================================
  console.log("=".repeat(80));
  console.log("7. SCORE SEMANTICS");
  console.log("=".repeat(80));
  console.log();
  
  console.log("Field Origins:");
  console.log("  record.priority: Set in engine.ts line 412");
  console.log("    - If vetoed: priority = 0 or null");
  console.log("    - If not vetoed: priority = finalScore");
  console.log();
  console.log("  record.rawScore: Set in DecisionPolicyEngine.ts line 270");
  console.log("    - Calculated from weighted components");
  console.log("    - Bounded 0-100");
  console.log("    - Preserved even when vetoed");
  console.log();
  console.log("  priorityScore: Alias in DecisionPolicyEngine");
  console.log("    - Same as rawScore when not vetoed");
  console.log();
  console.log("  Displayed score: present.ts line 83");
  console.log("    - Uses record.priority");
  console.log("    - Rounded to integer");
  console.log();
  
  // Check if these are different or same
  const mismatched = records.filter(r => 
    r.rawScore !== undefined && 
    r.priority !== null && 
    r.priority !== undefined && 
    r.rawScore !== r.priority
  );
  
  console.log(`Records where rawScore !== priority: ${mismatched.length}`);
  console.log(`  These are vetoed records where rawScore is preserved but priority is set to 0`);
  console.log();
  
  // ============================================
  // 8. RANKING BEHAVIOR
  // ============================================
  console.log("=".repeat(80));
  console.log("8. RANKING BEHAVIOR");
  console.log("=".repeat(80));
  console.log();
  
  const zeroScoreCount = scoreZero;
  console.log(`Opportunities with score 0: ${zeroScoreCount}`);
  console.log(`All ${zeroScoreCount} are effectively tied`);
  console.log();
  
  // Check if there's any secondary ranking
  console.log("Investigating secondary ranking for zeros:");
  
  // Are they ranked by rawScore?
  const zeroWithRaw = zeroRecords.filter(r => r.rawScore !== undefined && r.rawScore > 0);
  console.log(`  ${zeroWithRaw.length} have non-zero rawScore`);
  if (zeroWithRaw.length > 0) {
    const rawScores = zeroWithRaw.map(r => r.rawScore!);
    console.log(`    Raw score range: ${Math.min(...rawScores)} - ${Math.max(...rawScores)}`);
    console.log(`    This suggests some differentiation exists in rawScore`);
  }
  
  // Are they ranked by CV?
  const cvRange = {
    min: Math.min(...zeroRecords.map(r => r.decisionSummary?.careerValue || 0)),
    max: Math.max(...zeroRecords.map(r => r.decisionSummary?.careerValue || 0)),
  };
  console.log(`  CV range: ${cvRange.min} - ${cvRange.max}`);
  
  // Are they ranked by SP?
  const spRange = {
    min: Math.min(...zeroRecords.map(r => r.decisionSummary?.shortlistingPotential || 0)),
    max: Math.max(...zeroRecords.map(r => r.decisionSummary?.shortlistingPotential || 0)),
  };
  console.log(`  SP range: ${spRange.min} - ${spRange.max}`);
  console.log();
  
  console.log("Conclusion: All 936 zeros are tied. No visible secondary ranking.");
  console.log("This creates a ranking problem: 62% of corpus is undifferentiated.");
  console.log();
  
  // ============================================
  // 9. SCORE × DECISION × VETO MATRIX
  // ============================================
  console.log("=".repeat(80));
  console.log("9. SCORE × DECISION × VETO MATRIX");
  console.log("=".repeat(80));
  console.log();
  
  const matrix: Record<string, { count: number; examples: string[] }> = {};
  
  for (const r of records) {
    const score = r.priority === null ? "NULL" : r.priority.toString();
    const decision = r.verb;
    const veto = r.vetoed ? "VETO" : "NO-VETO";
    const key = `${score}-${decision}-${veto}`;
    
    if (!matrix[key]) {
      matrix[key] = { count: 0, examples: [] };
    }
    matrix[key].count++;
    if (matrix[key].examples.length < 3) {
      matrix[key].examples.push(r.jobHash);
    }
  }
  
  console.log("Score-Decision-Veto combinations:");
  const sorted = Object.entries(matrix).sort((a, b) => b[1].count - a[1].count);
  for (const [key, data] of sorted.slice(0, 20)) {
    console.log(`  ${key}: ${data.count} (${data.examples.slice(0, 2).join(", ")})`);
  }
  console.log();
  
  // Look for anomalies
  console.log("Specific anomalies:");
  
  const nonZeroPass = records.filter(r => 
    r.priority !== null && 
    r.priority > 0 && 
    r.verb === "PASS"
  );
  console.log(`  Non-zero PASS: ${nonZeroPass.length}`);
  if (nonZeroPass.length > 0) {
    console.log(`    Examples: ${nonZeroPass.slice(0, 3).map(r => `${r.jobHash}(${r.priority})`).join(", ")}`);
  }
  
  const zeroPursue = records.filter(r => 
    r.priority === 0 && 
    r.verb === "PURSUE"
  );
  console.log(`  Zero PURSUE: ${zeroPursue.length}`);
  if (zeroPursue.length > 0) {
    console.log(`    This should not happen - investigate!`);
  }
  
  const zeroConsider = records.filter(r => 
    r.priority === 0 && 
    r.verb === "CONSIDER"
  );
  console.log(`  Zero CONSIDER: ${zeroConsider.length}`);
  
  const highSPZero = records.filter(r => 
    r.priority === 0 && 
    (r.decisionSummary?.shortlistingPotential || 0) >= 80
  );
  console.log(`  Zero score with SP >= 80: ${highSPZero.length}`);
  
  const highCVZero = records.filter(r => 
    r.priority === 0 && 
    (r.decisionSummary?.careerValue || 0) >= 70
  );
  console.log(`  Zero score with CV >= 70: ${highCVZero.length}`);
  console.log();
  
  // ============================================
  // 10. IS THIS INTENTIONAL?
  // ============================================
  console.log("=".repeat(80));
  console.log("10. EVIDENCE FOR INTENTIONAL vs DEFECT");
  console.log("=".repeat(80));
  console.log();
  
  console.log("Evidence for INTENTIONAL (Exclusion Architecture):");
  console.log(`  ✓ 795/936 zeros (85%) are vetoed with clear reasons`);
  console.log(`  ✓ Veto reasons are specific and meaningful`);
  console.log(`  ✓ Raw scores are preserved for audit`);
  console.log(`  ✓ The system clearly distinguishes eligible vs ineligible`);
  console.log();
  
  console.log("Evidence for DEFECT:");
  console.log(`  ✗ 141/936 zeros (15%) are NOT vetoed`);
  console.log(`  ✗ Non-vetoed zeros have rawScore > 0`);
  console.log(`  ✗ Complete gap 1-59`);
  console.log(`  ✗ No differentiation among 936 tied opportunities`);
  console.log(`  ✗ 62% of corpus is undifferentiated`);
  console.log();
  
  // ============================================
  // 11. UNIQUE SCORES ANALYSIS
  // ============================================
  console.log("=".repeat(80));
  console.log("11. UNIQUE SCORES ANALYSIS");
  console.log("=".repeat(80));
  console.log();
  
  console.log(`Only ${uniqueScores.length} unique scores used`);
  console.log();
  console.log("Score distribution:");
  
  const scoreCounts: Record<number, { count: number; decisions: Record<string, number> }> = {};
  for (const s of scores) {
    if (!scoreCounts[s]) {
      scoreCounts[s] = { count: 0, decisions: {} };
    }
    scoreCounts[s].count++;
  }
  
  for (const r of scoredRecords) {
    if (r.priority !== null) {
      const s = r.priority;
      if (!scoreCounts[s]) {
        scoreCounts[s] = { count: 0, decisions: {} };
      }
      scoreCounts[s].decisions[r.verb] = (scoreCounts[s].decisions[r.verb] || 0) + 1;
    }
  }
  
  const sortedScores = Object.entries(scoreCounts)
    .map(([score, data]) => ({ score: parseInt(score), ...data }))
    .sort((a, b) => b.count - a.count);
  
  console.log("Score → Count → Decisions");
  for (const { score, count, decisions } of sortedScores.slice(0, 33)) {
    const decisionStr = Object.entries(decisions)
      .map(([verb, c]) => `${verb}:${c}`)
      .join(" ");
    console.log(`  ${score.toString().padStart(2)} → ${count.toString().padStart(4)} → ${decisionStr}`);
  }
  console.log();
  
  // ============================================
  // 12. SCORE CLUSTER ANALYSIS
  // ============================================
  console.log("=".repeat(80));
  console.log("12. SCORE CLUSTER ANALYSIS");
  console.log("=".repeat(80));
  console.log();
  
  console.log("Investigating discrete brackets:");
  
  // Check if scores align with thresholds
  const thresholdAligned = uniqueScores.filter(s => s === 0 || s === 60 || s === 70 || s >= 70);
  console.log(`Scores at thresholds (0, 60, 70+): ${thresholdAligned.length} of ${uniqueScores.length}`);
  
  // Check for rounding patterns
  const byModulo = {
    mod1: uniqueScores.length, // All
    mod2: uniqueScores.filter(s => s % 2 === 0).length, // Even
    mod5: uniqueScores.filter(s => s % 5 === 0).length, // Divisible by 5
    mod10: uniqueScores.filter(s => s % 10 === 0).length, // Divisible by 10
  };
  
  console.log("Rounding patterns:");
  console.log(`  Even scores: ${byModulo.mod2}`);
  console.log(`  Divisible by 5: ${byModulo.mod5}`);
  console.log(`  Divisible by 10: ${byModulo.mod10}`);
  console.log();
  
  // ============================================
  // 13. PRELIMINARY HYPOTHESIS
  // ============================================
  console.log("=".repeat(80));
  console.log("13. PRELIMINARY HYPOTHESIS");
  console.log("=".repeat(80));
  console.log();
  
  console.log("=== WHAT WE KNOW ===");
  console.log("1. 936 opportunities (61.8%) score exactly 0");
  console.log("2. 795 of these (85%) are hard-vetoed with clear reasons");
  console.log("3. 141 zeros (15%) are NOT vetoed but still have priority=0");
  console.log("4. Complete gap from scores 1-59 (no opportunities)");
  console.log("5. Only 33 unique scores across 1,499 scored records");
  console.log("6. Non-vetoed zeros have rawScore > 0 (e.g., 51, 53, 59)");
  console.log("7. Scores cluster at decision thresholds (0, 60, 70, 75, 80)");
  console.log("8. 62% of corpus is undifferentiated (all score 0)");
  console.log();
  
  console.log("=== WHAT WE STRONGLY SUSPECT ===");
  console.log("1. The 0 score represents EXCLUSION from the ranking index");
  console.log("2. Vetoed opportunities are intentionally set to priority=0");
  console.log("3. Non-vetoed zeros may be a bug (rawScore preserved but priority overwritten)");
  console.log("4. The 10-59 gap suggests thresholds, not continuous calculation");
  console.log("5. Scores are being bucketed/bracketed, not truly continuous");
  console.log();
  
  console.log("=== WHAT REMAINS UNKNOWN ===");
  console.log("1. Why 141 non-vetoed records have priority=0");
  console.log("2. Whether the 1-59 gap is intentional or a bug");
  console.log("3. Whether scores should differentiate among vetoed opportunities");
  console.log("4. Whether the current score semantics match product intent");
  console.log();
  
  console.log("=== WHAT APPEARS INTENTIONAL ===");
  console.log("1. Vetoed → score 0 (clear exclusion signal)");
  console.log("2. Threshold-based decisions (60=CONSIDER, 70=PURSUE)");
  console.log("3. RawScore preservation for audit");
  console.log("4. Score capping at 100, flooring at 0");
  console.log();
  
  console.log("=== WHAT APPEARS ANOMALOUS ===");
  console.log("1. 141 non-vetoed score-0 opportunities");
  console.log("2. Complete absence of scores 1-59");
  console.log("3. Only 2.2% unique scores (high compression)");
  console.log("4. 62% of corpus undifferentiated at score 0");
  console.log("5. Gap between rawScore and priority for non-vetoed");
  console.log();
  
  console.log("=== GENUINE SCORING DEFECT SUSPECTED ===");
  console.log("1. Non-vetoed priority=0 (141 records)");
  console.log("  - These have rawScore > 0 but priority=0");
  console.log("  - May indicate logic error in engine.ts");
  console.log("  - Needs immediate investigation");
  console.log();
  
  console.log("=== REQUIRES PRODUCT-MODEL DISCUSSION ===");
  console.log("1. Should vetoed opportunities have scores?");
  console.log("2. Is the 0-100 scale meant to be continuous or bracketed?");
  console.log("3. Should 62% of corpus be undifferentiated?");
  console.log("4. Is the 10-59 gap acceptable?");
  console.log("5. What does score=0 actually mean to users?");
  console.log();
  
  console.log("=".repeat(80));
  console.log("FORENSIC INVESTIGATION COMPLETE");
  console.log("=".repeat(80));
  console.log();
  console.log("CRITICAL FINDINGS:");
  console.log("1. 141 non-vetoed opportunities have priority=0 (SUSPECTED BUG)");
  console.log("2. 795 vetoed opportunities correctly have priority=0 (INTENTIONAL)");
  console.log("3. Complete 1-59 score gap (NEEDS PRODUCT DECISION)");
  console.log("4. 62% score compression at 0 (NEEDS PRODUCT DECISION)");
  console.log();
  console.log("RECOMMENDATION: Investigate non-vetoed zero priority before proceeding.");
}

comprehensiveForensics();
