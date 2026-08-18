import fs from "fs";
import path from "path";

async function main() {
  const p = path.resolve(process.cwd(), "scratch/model_c_records.json");
  const records = JSON.parse(fs.readFileSync(p, "utf-8"));
  
  const getStats = (arr: number[]) => {
    if (arr.length === 0) return { min: 0, max: 0, mean: 0, median: 0, stddev: 0, unique: 0, bands: new Array(10).fill(0) };
    const sorted = [...arr].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const variance = sorted.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / sorted.length;
    const stddev = Math.sqrt(variance);
    const median = sorted[Math.floor(sorted.length / 2)];
    const unique = new Set(arr.map(x => Number(x.toFixed(4)))).size;
    
    const bands = new Array(10).fill(0);
    for (const v of sorted) {
      let b = Math.floor(v / 10);
      if (b > 9) b = 9;
      if (b < 0) b = 0;
      bands[b]++;
    }
    
    return { min, max, mean, median, stddev, unique, bands };
  };
  
  const allEligible = records.filter((r: any) => !r.isIdentityIneligible);
  const allIneligible = records.filter((r: any) => r.isIdentityIneligible);
  
  console.log("==================================================");
  console.log("3. FULL DISTRIBUTION ANALYSIS");
  console.log("==================================================");
  console.log(`Total corpus: ${records.length}`);
  console.log(`Identity-eligible: ${allEligible.length}`);
  console.log(`Identity-ineligible: ${allIneligible.length}`);
  
  const allScores = allEligible.map((r: any) => r.modelC_qualityScore);
  const statsC = getStats(allScores);
  
  console.log("\nModel C Distribution (Eligible Only)");
  console.log(`Min: ${statsC.min.toFixed(2)}, Max: ${statsC.max.toFixed(2)}`);
  console.log(`Mean: ${statsC.mean.toFixed(2)}, Median: ${statsC.median.toFixed(2)}, StdDev: ${statsC.stddev.toFixed(2)}`);
  console.log(`Unique Scores: ${statsC.unique}`);
  console.log(`Bands (0-9 to 90-100):`, statsC.bands.join(", "));
  
  console.log("\n==================================================");
  console.log("4. RANKING COMPARISON");
  console.log("==================================================");
  
  const eligibleOriginal = [...allEligible];
  eligibleOriginal.sort((a, b) => b.currentRawScore - a.currentRawScore);
  const rankOrig = eligibleOriginal.map(r => r.jobHash);
  
  const eligibleModelC = [...allEligible];
  eligibleModelC.sort((a, b) => b.modelC_qualityScore - a.modelC_qualityScore);
  const rankC = eligibleModelC.map(r => r.jobHash);
  
  const getOverlap = (n: number) => {
    const setOrig = new Set(rankOrig.slice(0, n));
    const setC = new Set(rankC.slice(0, n));
    let overlap = 0;
    for (const x of setOrig) if (setC.has(x)) overlap++;
    return overlap;
  };
  
  console.log(`Top 20 Overlap: ${getOverlap(20)}`);
  console.log(`Top 50 Overlap: ${getOverlap(50)}`);
  console.log(`Top 100 Overlap: ${getOverlap(100)}`);
  
  let inversions = [];
  for (let i = 0; i < rankOrig.length; i++) {
    const hash = rankOrig[i];
    const rC = rankC.indexOf(hash);
    const diff = i - rC;
    inversions.push({ hash, diff, rankOrig: i, rankC: rC });
  }
  inversions.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)); // Largest absolute changes
  
  console.log(`\nTop 10 Largest Rank Changes:`);
  for (let i = 0; i < 10; i++) {
    const inv = inversions[i];
    const r = allEligible.find((x: any) => x.jobHash === inv.hash);
    console.log(`\nJob: ${r.jobHash} | Role: ${r.role} | Decision: ${r.decision}`);
    console.log(`Rank: ${inv.rankOrig} -> ${inv.rankC} (Change: ${inv.diff > 0 ? '+' : ''}${inv.diff})`);
    console.log(`Score: Orig ${r.currentRawScore.toFixed(2)} -> ModelC ${r.modelC_qualityScore.toFixed(2)}`);
    console.log(`Car: ${r.careerValue}, Cap: ${r.capabilityFit}, Opp: ${r.opportunityScore}, SP: ${r.shortlistingPotential}, Fric: ${r.pursuitFriction}`);
  }
  
  console.log("\n==================================================");
  console.log("5. EXECUTIVE QUALITY VALIDATION / 6. QUALITY VS DECISION");
  console.log("==================================================");
  
  const printCase = (label: string, fn: (r: any) => boolean) => {
    const res = allEligible.filter(fn);
    if (res.length > 0) {
      const r = res[0];
      console.log(`\n[${label}]`);
      console.log(`Job: ${r.jobHash} | Decision: ${r.decision} (Veto: ${r.vetoed} - ${r.vetoReason})`);
      console.log(`OrigRaw: ${r.currentRawScore.toFixed(2)} | Priority: ${r.currentPriorityScore} | Model C: ${r.modelC_qualityScore.toFixed(2)}`);
      console.log(`Car: ${r.careerValue}, Cap: ${r.capabilityFit}, Opp: ${r.opportunityScore}, SP: ${r.shortlistingPotential}, Fric: ${r.pursuitFriction}`);
    } else {
      console.log(`\n[${label}] -> NO RECORDS FOUND`);
    }
  };
  
  printCase("A. High Quality + high friction", r => r.pursuitFriction > 15 && r.careerValue > 75 && r.opportunityScore > 75);
  printCase("B. High Quality + low SP", r => r.careerValue > 75 && r.shortlistingPotential < 50);
  printCase("C. Medium Quality + high SP", r => r.careerValue >= 50 && r.careerValue <= 70 && r.shortlistingPotential > 80);
  printCase("D. Low Quality + high SP", r => r.careerValue < 50 && r.shortlistingPotential > 80);
  printCase("E. High Quality + PASS", r => r.decision === "PASS" && r.careerValue > 75 && !r.vetoed);
  printCase("F. Medium Quality + PURSUE", r => r.decision === "PURSUE" && r.careerValue >= 50 && r.careerValue <= 70);
  printCase("G. Low Quality + PASS", r => r.decision === "PASS" && r.careerValue < 50 && r.opportunityScore < 60);

  console.log("\n==================================================");
  console.log("7. SENSITIVITY TESTING");
  console.log("==================================================");
  
  if (allEligible.length > 0) {
    const baselineRec = allEligible[0];
    
    const weightCareer = 0.30;
    const weightOpp = 0.20;
    const weightCap = 0.15;
    const sumWeights = weightCareer + weightOpp + weightCap;
    const normCareer = weightCareer / sumWeights;
    const normOpp = weightOpp / sumWeights;
    const normCap = weightCap / sumWeights;

    const simulateA = (car: number, cap: number, opp: number, fric: number) => {
      return (baselineRec.identityScore * 0.35) + (car * 0.30) + (opp * 0.20) + (cap * 0.15) - fric;
    };
    const simulateC = (car: number, cap: number, opp: number) => {
      return (normCareer * car) + (normCap * cap) + (normOpp * opp);
    };
    
    const testSens = (label: string, dCar: number, dCap: number, dOpp: number, dFric: number) => {
      const sA = simulateA(baselineRec.careerValue + dCar, baselineRec.capabilityFit + dCap, baselineRec.opportunityScore + dOpp, baselineRec.pursuitFriction + dFric);
      const sC = simulateC(baselineRec.careerValue + dCar, baselineRec.capabilityFit + dCap, baselineRec.opportunityScore + dOpp);
      console.log(`${label.padEnd(20)} | OrigDelta: ${(sA - baselineRec.currentRawScore).toFixed(2)} | ModelC Delta: ${(sC - baselineRec.modelC_qualityScore).toFixed(2)}`);
    }
    
    console.log(`Baseline Job: ${baselineRec.jobHash} | Orig: ${baselineRec.currentRawScore.toFixed(2)} | ModelC: ${baselineRec.modelC_qualityScore.toFixed(2)}`);
    testSens("Career +10", 10, 0, 0, 0);
    testSens("Career -10", -10, 0, 0, 0);
    testSens("Capability +10", 0, 10, 0, 0);
    testSens("Capability -10", 0, -10, 0, 0);
    testSens("Opportunity +10", 0, 0, 10, 0);
    testSens("Opportunity -10", 0, 0, -10, 0);
  }
}
main();
