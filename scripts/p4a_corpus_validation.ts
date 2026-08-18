import { runEngine } from "../src/lib/intelligence/engine";
import { candidateProfile } from "../src/data/candidate-profile";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";

async function runCorpusValidation() {
  console.log("\n=======================================================");
  console.log("P4-A.5 MODEL C FULL-CORPUS VALIDATION (1,514 OPPORTUNITIES)");
  console.log("=======================================================\n");

  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);

  const { records } = runEngine(projection);
  const total = records.length;

  console.log(`Evaluated ${total} opportunities through RADAR engine.\n`);

  const nullScoreOpps = records.filter(r => r.qualityScore === null);
  const nonNullScoreOpps = records.filter(r => r.qualityScore !== null);
  
  // N/A Breakdown
  const sparseSpecCount = records.filter(r => r.verb === "SPARSE_SPEC" || r.vetoReason === "EVIDENCE_INTEGRITY_FAILED").length;
  const identityMismatchCount = nullScoreOpps.length - sparseSpecCount;

  // Numeric Stats
  const scores = nonNullScoreOpps.map(r => r.qualityScore as number).sort((a, b) => a - b);
  const sum = scores.reduce((acc, val) => acc + val, 0);
  const mean = scores.length > 0 ? (sum / scores.length).toFixed(2) : "N/A";
  
  const percentile = (p: number) => {
    if (scores.length === 0) return 0;
    const idx = Math.floor((p / 100) * (scores.length - 1));
    return scores[idx];
  };

  const median = percentile(50);
  const p10 = percentile(10);
  const p25 = percentile(25);
  const p75 = percentile(75);
  const p90 = percentile(90);
  const min = scores.length > 0 ? scores[0] : 0;
  const max = scores.length > 0 ? scores[scores.length - 1] : 0;

  // Buckets
  const buckets: Record<string, number> = {
    "0-9": 0, "10-19": 0, "20-29": 0, "30-39": 0, "40-49": 0,
    "50-59": 0, "60-69": 0, "70-79": 0, "80-89": 0, "90-100": 0
  };

  for (const s of scores) {
    if (s < 10) buckets["0-9"]++;
    else if (s < 20) buckets["10-19"]++;
    else if (s < 30) buckets["20-29"]++;
    else if (s < 40) buckets["30-39"]++;
    else if (s < 50) buckets["40-49"]++;
    else if (s < 60) buckets["50-59"]++;
    else if (s < 70) buckets["60-69"]++;
    else if (s < 80) buckets["70-79"]++;
    else if (s < 90) buckets["80-89"]++;
    else buckets["90-100"]++;
  }

  // Score Bands
  const scoreUnder60 = scores.filter(s => s < 60).length;
  const score60to69 = scores.filter(s => s >= 60 && s < 70).length;
  const score70to79 = scores.filter(s => s >= 70 && s < 80).length;
  const score80plus = scores.filter(s => s >= 80).length;

  // Verbs Breakdown
  const pursueOpps = records.filter(r => r.verb === "PURSUE");
  const considerOpps = records.filter(r => r.verb === "CONSIDER");
  const passOpps = records.filter(r => r.verb === "PASS");
  const sparseOpps = records.filter(r => r.verb === "SPARSE_SPEC");

  // PASS Breakdown
  const passVetoed = passOpps.filter(r => r.vetoed || (r.qualityScore !== null && r.qualityScore >= 60));
  const passLowScore = passOpps.filter(r => !r.vetoed && r.qualityScore !== null && r.qualityScore < 60);

  // Easy Trap
  const easyTrapCount = records.filter(r => {
    if (!r.trace?.pipeline) return false;
    return (r.trace.pipeline as any[]).some((p: any) => p.ruleId === "R-CONSIDER-CAREER-VALUE-PROTECTION");
  }).length;

  console.log("-------------------------------------------------------");
  console.log("A. Total Evaluated Count:", total);
  console.log("-------------------------------------------------------");
  console.log(`B. N/A (Null) Opportunities: ${nullScoreOpps.length} (${((nullScoreOpps.length / total) * 100).toFixed(2)}%)`);
  console.log(`   - SPARSE_SPEC / Insufficient Text: ${sparseSpecCount}`);
  console.log(`   - IDENTITY_MISMATCH (distance >= 0.80): ${identityMismatchCount}`);
  console.log("-------------------------------------------------------");
  console.log("C. Quality Score Summary (Non-Null N=" + scores.length + "):");
  console.log(`   - Mean:   ${mean}`);
  console.log(`   - Median: ${median}`);
  console.log(`   - Min:    ${min}`);
  console.log(`   - Max:    ${max}`);
  console.log(`   - P10:    ${p10}`);
  console.log(`   - P25:    ${p25}`);
  console.log(`   - P75:    ${p75}`);
  console.log(`   - P90:    ${p90}`);
  console.log("-------------------------------------------------------");
  console.log("D. Quality Score Distribution (10-Point Buckets):");
  for (const [b, count] of Object.entries(buckets)) {
    const pct = ((count / scores.length) * 100).toFixed(2);
    const bar = "█".repeat(Math.round(count / 15));
    console.log(`   - ${b.padEnd(7)}: ${count.toString().padStart(4)} (${pct.padStart(5)}%) ${bar}`);
  }
  console.log("-------------------------------------------------------");
  console.log("E-H. Quality Score Bands (Non-Null N=" + scores.length + "):");
  console.log(`   E. < 60 (Below Threshold):   ${scoreUnder60} (${((scoreUnder60 / scores.length) * 100).toFixed(2)}%)`);
  console.log(`   F. 60-69 (CONSIDER Band):    ${score60to69} (${((score60to69 / scores.length) * 100).toFixed(2)}%)`);
  console.log(`   G. 70-79 (PURSUE Band):      ${score70to79} (${((score70to79 / scores.length) * 100).toFixed(2)}%)`);
  console.log(`   H. >= 80 (High Alignment):   ${score80plus} (${((score80plus / scores.length) * 100).toFixed(2)}%)`);
  console.log("-------------------------------------------------------");
  console.log("I. Final Decision Breakdown:");
  console.log(`   - PURSUE:      ${pursueOpps.length.toString().padStart(4)} (${((pursueOpps.length / total) * 100).toFixed(2)}%)`);
  console.log(`   - CONSIDER:    ${considerOpps.length.toString().padStart(4)} (${((considerOpps.length / total) * 100).toFixed(2)}%)`);
  console.log(`   - PASS:        ${passOpps.length.toString().padStart(4)} (${((passOpps.length / total) * 100).toFixed(2)}%)`);
  console.log(`   - SPARSE_SPEC: ${sparseOpps.length.toString().padStart(4)} (${((sparseOpps.length / total) * 100).toFixed(2)}%)`);
  console.log("-------------------------------------------------------");
  console.log("J. PASS Opportunity Sub-Breakdown:");
  console.log(`   J1. Hard Veto / Policy Gate (Retaining Quality Score): ${passVetoed.length}`);
  console.log(`   J2. Low Quality Score (< 60):                         ${passLowScore.length}`);
  console.log("-------------------------------------------------------");
  console.log("K. CONSIDER Opportunities:");
  console.log(`   - Count: ${considerOpps.length}`);
  if (considerOpps.length > 0) {
    const cScores = considerOpps.map(r => r.qualityScore).filter(s => s !== null) as number[];
    const cMean = cScores.length > 0 ? (cScores.reduce((a, b) => a + b, 0) / cScores.length).toFixed(2) : "0";
    console.log(`   - Quality Score Range: ${Math.min(...cScores)} - ${Math.max(...cScores)} (Mean: ${cMean})`);
  }
  console.log("-------------------------------------------------------");
  console.log("L. PURSUE Opportunities:");
  console.log(`   - Count: ${pursueOpps.length}`);
  if (pursueOpps.length > 0) {
    const pScores = pursueOpps.map(r => r.qualityScore).filter(s => s !== null) as number[];
    const pMean = pScores.length > 0 ? (pScores.reduce((a, b) => a + b, 0) / pScores.length).toFixed(2) : "0";
    console.log(`   - Quality Score Range: ${Math.min(...pScores)} - ${Math.max(...pScores)} (Mean: ${pMean})`);
  }
  console.log("-------------------------------------------------------");
  console.log(`M. Easy Trap Protection (Career Value Protection): ${easyTrapCount} (${((easyTrapCount / total) * 100).toFixed(2)}%)`);
  console.log("=======================================================\n");
}

runCorpusValidation().catch(console.error);
