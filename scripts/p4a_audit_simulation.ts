import fs from "fs";
import path from "path";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../src/data/candidate-profile";
import type { OpportunitySource } from "../src/data/opportunity-fixtures";
import { JobProjectionBuilder } from "../src/lib/intelligence/builders/JobProjectionBuilder";
import { OpportunityAssessmentEngine } from "../src/lib/intelligence/engines/OpportunityAssessmentEngine";
import { IdentityAssessmentEngine } from "../src/lib/intelligence/engines/IdentityAssessmentEngine";
import { CareerAssessmentEngine } from "../src/lib/intelligence/engines/CareerAssessmentEngine";
import { CapabilityAssessmentEngine } from "../src/lib/intelligence/engines/CapabilityAssessmentEngine";
import { LifestyleAssessmentEngine } from "../src/lib/intelligence/engines/LifestyleAssessmentEngine";
import { DecisionPolicyEngine } from "../src/lib/intelligence/policy/DecisionPolicyEngine";

async function main() {
  const dataPath = path.resolve(process.cwd(), "src/data/live-scraped.json");
  const jobs = JSON.parse(fs.readFileSync(dataPath, "utf-8")) as OpportunitySource[];
  const candBuilder = new CandidateProjectionBuilderImpl();
  const candProj = candBuilder.fromProfile(candidateProfile);
  
  const records: any[] = [];
  
  const weightCareer = 0.30;
  const weightOpp = 0.20;
  const weightCap = 0.15;
  const sumWeights = weightCareer + weightOpp + weightCap; // 0.65
  const normCareer = weightCareer / sumWeights;
  const normOpp = weightOpp / sumWeights;
  const normCap = weightCap / sumWeights;
  
  let idSaturatedCount = 0;
  let nonVetoedCount = 0;

  for (const jobSrc of jobs) {
    const jobProj = JobProjectionBuilder.build(jobSrc, candProj);
    const idAssessment = IdentityAssessmentEngine.evaluate(candProj, jobProj);
    const capAssessment = CapabilityAssessmentEngine.evaluate(candProj, jobProj);
    const oppAssessment = OpportunityAssessmentEngine.evaluate(candProj, jobProj);
    const carAssessment = CareerAssessmentEngine.evaluate(candProj, jobProj, oppAssessment);
    const lifeAssessment = LifestyleAssessmentEngine.evaluate(candProj, jobProj);
    
    // Original production evaluation
    const dpe = DecisionPolicyEngine.evaluate(
      idAssessment, capAssessment, oppAssessment, carAssessment, lifeAssessment,
      jobProj.executiveIdentity?.value, candProj.executiveThemes?.[0],
      (jobProj.role || "") + " " + (jobProj.originalOpportunity?.description || ""),
      false, undefined, undefined, 80
    );
    
    const idScore = Math.round(idAssessment.coverage * 100);
    const capScore = (capAssessment as any).evidenceState === "UNAVAILABLE" || capAssessment.sufficiency === "INSUFFICIENT" || capAssessment.overallFit === null ? 50 : Math.round((capAssessment.overallFit || 0) * 100);
    const oppScore = (oppAssessment as any).opportunityScore !== undefined ? (oppAssessment as any).opportunityScore : 80;
    const carScore = (carAssessment as any).careerScore || Math.max(0, 80 - (carAssessment.regressionScore || 0));
    const fricScore = (lifeAssessment as any).locationFrictionPenalty || 0;
    const spScore = (dpe as any).shortlistingPotential || 0;
    
    // We want to rank ONLY ELIGIBLE opportunities. So we filter out vetoed ones.
    const eligible = !dpe.vetoed;
    if (eligible) {
      nonVetoedCount++;
      if (idScore === 100) idSaturatedCount++;
    }

    // Model A: Existing raw score (unclamped)
    const scoreA = dpe.rawScore;
    
    // Model B: Identity as gate (so only calculate for eligible). Quality score without Friction.
    // Wait, the prompt says "Do NOT subtract Pursuit Friction from the quality score." for Model B.
    // Wait, "Do NOT subtract Pursuit Friction from the quality score." Actually Model B says:
    // QUALITY_B = norm(Car)*Car + norm(Cap)*Cap + norm(Opp)*Opp
    const qualityScore = (normCareer * carScore) + (normCap * capScore) + (normOpp * oppScore);
    const scoreB = qualityScore;
    
    // Model C: Same as Model B for the score itself (QUALITY_C = QUALITY_B).
    // The difference is conceptual: Model C reports Friction separately for the Decision.
    const scoreC = qualityScore;

    records.push({
      jobHash: jobSrc.jobHash,
      role: jobProj.role,
      company: jobProj.company?.name || "Unknown",
      decision: dpe.verb,
      vetoed: dpe.vetoed,
      vetoReason: dpe.vetoReason,
      currentRawScore: dpe.rawScore,
      currentPriorityScore: dpe.priorityScore,
      careerValue: carScore,
      capabilityFit: capScore,
      opportunityScore: oppScore,
      identityScore: idScore,
      pursuitFriction: fricScore,
      shortlistingPotential: spScore,
      scoreA,
      scoreB,
      scoreC
    });
  }
  
  const eligibleRecords = records.filter(r => !r.vetoed);
  
  // Stats function
  const getStats = (arr: number[]) => {
    if (arr.length === 0) return { min: 0, max: 0, mean: 0, median: 0, stddev: 0, unique: 0, bands: [] };
    const sorted = [...arr].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const variance = sorted.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / sorted.length;
    const stddev = Math.sqrt(variance);
    const median = sorted[Math.floor(sorted.length / 2)];
    const unique = new Set(arr).size;
    
    const bands = new Array(10).fill(0);
    for (const v of sorted) {
      let b = Math.floor(v / 10);
      if (b > 9) b = 9;
      if (b < 0) b = 0;
      bands[b]++;
    }
    
    return { min, max, mean, median, stddev, unique, bands };
  };
  
  const statsA = getStats(eligibleRecords.map(r => r.scoreA));
  const statsB = getStats(eligibleRecords.map(r => r.scoreB));
  const statsC = getStats(eligibleRecords.map(r => r.scoreC));
  
  console.log("==================================================");
  console.log("DISTRIBUTION ANALYSIS");
  console.log("==================================================");
  console.log(`Total records: ${records.length}, Eligible: ${eligibleRecords.length}`);
  console.log(`Identity 100% saturation for eligible: ${idSaturatedCount} (${(idSaturatedCount/nonVetoedCount*100).toFixed(2)}%)`);
  
  const printStats = (name: string, s: any) => {
    console.log(`\n--- ${name} ---`);
    console.log(`Min: ${s.min.toFixed(2)}, Max: ${s.max.toFixed(2)}, Mean: ${s.mean.toFixed(2)}, Median: ${s.median.toFixed(2)}, StdDev: ${s.stddev.toFixed(2)}, Unique: ${s.unique}`);
    console.log(`Bands (0-9 to 90-100):`, s.bands.join(", "));
  };
  
  printStats("MODEL A (rawScore)", statsA);
  printStats("MODEL B & C (Quality Score w/o Friction)", statsB);
  
  // Ranking
  eligibleRecords.sort((a, b) => b.scoreA - a.scoreA);
  const rankA = eligibleRecords.map(r => r.jobHash);
  
  eligibleRecords.sort((a, b) => b.scoreB - a.scoreB);
  const rankB = eligibleRecords.map(r => r.jobHash);
  
  // Count overlap in top N
  const getOverlap = (n: number) => {
    const setA = new Set(rankA.slice(0, n));
    const setB = new Set(rankB.slice(0, n));
    let overlap = 0;
    for (const x of setA) if (setB.has(x)) overlap++;
    return overlap;
  };
  
  console.log("\n==================================================");
  console.log("RANKING ANALYSIS");
  console.log("==================================================");
  console.log(`Top 20 Overlap (A vs B/C): ${getOverlap(20)}`);
  console.log(`Top 50 Overlap (A vs B/C): ${getOverlap(50)}`);
  console.log(`Top 100 Overlap (A vs B/C): ${getOverlap(100)}`);
  
  // Find major inversions
  // A job that dropped heavily in B/C vs A, and a job that rose heavily
  let inversions = [];
  for (let i = 0; i < rankA.length; i++) {
    const hash = rankA[i];
    const rankInB = rankB.indexOf(hash);
    const diff = i - rankInB; // positive means it moved UP in B (lower index)
    inversions.push({ hash, diff, rankA: i, rankB: rankInB });
  }
  inversions.sort((a, b) => b.diff - a.diff); // Biggest risers in B first
  
  const getRec = (hash: string) => eligibleRecords.find(r => r.jobHash === hash);
  
  console.log("\nBiggest Risers in Model B/C (Rank improved):");
  for (let i = 0; i < 3; i++) {
    const inv = inversions[i];
    const r = getRec(inv.hash)!;
    console.log(`Riser: ${r.jobHash} | RankA: ${inv.rankA}, RankB: ${inv.rankB} (Diff: +${inv.diff}) | ScoreA: ${r.scoreA.toFixed(2)}, ScoreB: ${r.scoreB.toFixed(2)} | Car: ${r.careerValue}, Cap: ${r.capabilityFit}, Opp: ${r.opportunityScore}, Fric: ${r.pursuitFriction}`);
  }
  
  console.log("\nBiggest Fallers in Model B/C (Rank dropped):");
  for (let i = inversions.length - 1; i >= inversions.length - 3; i--) {
    const inv = inversions[i];
    const r = getRec(inv.hash)!;
    console.log(`Faller: ${r.jobHash} | RankA: ${inv.rankA}, RankB: ${inv.rankB} (Diff: ${inv.diff}) | ScoreA: ${r.scoreA.toFixed(2)}, ScoreB: ${r.scoreB.toFixed(2)} | Car: ${r.careerValue}, Cap: ${r.capabilityFit}, Opp: ${r.opportunityScore}, Fric: ${r.pursuitFriction}`);
  }
  
  console.log("\n==================================================");
  console.log("ADVERSARIAL & EXTREME CASES");
  console.log("==================================================");
  
  const printCase = (label: string, fn: (r: any) => boolean) => {
    const res = records.filter(fn);
    if (res.length > 0) {
      const r = res[0];
      console.log(`\nCase: ${label}`);
      console.log(`Job: ${r.jobHash} | Decision: ${r.decision} (Veto: ${r.vetoed} - ${r.vetoReason})`);
      console.log(`ScoreA (Raw): ${r.scoreA.toFixed(2)} | Priority: ${r.currentPriorityScore} | Score B/C (Quality): ${r.scoreB.toFixed(2)}`);
      console.log(`Car: ${r.careerValue}, Cap: ${r.capabilityFit}, Opp: ${r.opportunityScore}, SP: ${r.shortlistingPotential}, Fric: ${r.pursuitFriction}`);
    } else {
      console.log(`\nCase: ${label} -> NO RECORDS FOUND`);
    }
  };
  
  printCase("High Quality / High Friction", r => !r.vetoed && r.pursuitFriction > 15 && r.careerValue > 75 && r.opportunityScore > 75);
  printCase("High CV / Low SP", r => !r.vetoed && r.careerValue > 80 && r.shortlistingPotential < 50);
  printCase("Low CV / High SP", r => !r.vetoed && r.careerValue < 50 && r.shortlistingPotential > 80);
  printCase("High CV + PASS", r => r.decision === "PASS" && r.careerValue > 80 && !r.vetoed);
  printCase("Identity Mismatch", r => r.vetoed && r.vetoReason && r.vetoReason.includes("Domain"));
  printCase("Sub-tier Veto", r => r.vetoed && r.vetoReason && r.vetoReason.includes("SUB-TIER"));
  printCase("Near-Miss PASS (Clamped)", r => !r.vetoed && r.decision === "PASS" && r.currentRawScore >= 50 && r.currentRawScore < 60);

  console.log("\n==================================================");
  console.log("SENSITIVITY TESTS");
  console.log("==================================================");
  const baselineRec = eligibleRecords[0];
  console.log(`Baseline Job: ${baselineRec.jobHash} | ScoreA: ${baselineRec.scoreA.toFixed(2)} | ScoreB: ${baselineRec.scoreB.toFixed(2)}`);
  
  const simulateA = (car: number, cap: number, opp: number, fric: number) => {
    return (100 * 0.35) + (car * 0.30) + (opp * 0.20) + (cap * 0.15) - fric;
  };
  const simulateB = (car: number, cap: number, opp: number) => {
    return (normCareer * car) + (normCap * cap) + (normOpp * opp);
  };
  
  const testSens = (label: string, dCar: number, dCap: number, dOpp: number, dFric: number) => {
    const sA = simulateA(baselineRec.careerValue + dCar, baselineRec.capabilityFit + dCap, baselineRec.opportunityScore + dOpp, baselineRec.pursuitFriction + dFric);
    const sB = simulateB(baselineRec.careerValue + dCar, baselineRec.capabilityFit + dCap, baselineRec.opportunityScore + dOpp);
    console.log(`${label.padEnd(20)} | ScoreA: ${sA.toFixed(2)} (Diff: ${(sA - baselineRec.scoreA).toFixed(2)}) | ScoreB: ${sB.toFixed(2)} (Diff: ${(sB - baselineRec.scoreB).toFixed(2)})`);
  }
  
  testSens("+10 Career Value", 10, 0, 0, 0);
  testSens("-10 Career Value", -10, 0, 0, 0);
  testSens("+10 Capability", 0, 10, 0, 0);
  testSens("-10 Capability", 0, -10, 0, 0);
  testSens("+10 Opportunity", 0, 0, 10, 0);
  testSens("-10 Opportunity", 0, 0, -10, 0);
  testSens("+10 Friction", 0, 0, 0, 10);
  
}
main();
