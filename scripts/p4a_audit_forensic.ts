import fs from "fs";
import path from "path";
import type { RecommendationRecord } from "../src/lib/intelligence/record";

function loadRecords(): RecommendationRecord[] {
  const p = path.resolve(process.cwd(), "scratch/audit_records.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function analyze() {
  const records = loadRecords();

  console.log("=========================================");
  console.log("A. RECONCILE THE SCORE DISTRIBUTION");
  console.log("=========================================\n");

  const rawScoreDist = new Array(11).fill(0);
  const priorityScoreDist = new Array(11).fill(0);
  let zerosRaw = 0;
  let zerosPriority = 0;
  let raw10to59Count = 0;

  for (const r of records) {
    // rawScore
    const rs = r.rawScore || 0;
    if (rs === 0) zerosRaw++;
    if (rs >= 10 && rs <= 59) raw10to59Count++;
    let rBucket = Math.floor(rs / 10);
    if (rBucket > 10) rBucket = 10;
    if (rs === 100) rBucket = 10;
    rawScoreDist[rBucket]++;

    // priorityScore
    const ps = r.priority ?? 0;
    if (ps === 0) zerosPriority++;
    let pBucket = Math.floor(ps / 10);
    if (pBucket > 10) pBucket = 10;
    if (ps === 100) pBucket = 10;
    priorityScoreDist[pBucket]++;
  }

  console.log(`zerosRaw: ${zerosRaw}`);
  console.log(`zerosPriority: ${zerosPriority}`);
  console.log(`rawScore in 10-59 band: ${raw10to59Count}`);
  
  console.log("\nRawScore Histogram:");
  for (let i = 0; i < 11; i++) {
    const label = i === 10 ? "100" : `${i * 10}-${i * 10 + 9}`;
    console.log(`  ${label.padEnd(7)}: ${rawScoreDist[i]}`);
  }

  console.log("\nPriorityScore Histogram:");
  for (let i = 0; i < 11; i++) {
    const label = i === 10 ? "100" : `${i * 10}-${i * 10 + 9}`;
    console.log(`  ${label.padEnd(7)}: ${priorityScoreDist[i]}`);
  }

  const clamped = records.filter(r => r.rawScore && r.rawScore >= 10 && r.rawScore <= 59 && (r.priority ?? 0) === 0);
  console.log(`\nNumber of records clamped from 10-59 down to 0: ${clamped.length}`);

  console.log("\n=========================================");
  console.log("B. VERIFY THE IDENTITY SATURATION CLAIM");
  console.log("=========================================\n");

  let idDistances: number[] = [];
  let idCoverages: number[] = [];
  let idScores: number[] = [];
  let idScoresPreVeto: number[] = [];
  let distinctIdentityValues = new Set<number>();
  let countIdentity100NonVetoed = 0;
  let nonVetoedTotal = 0;

  for (const r of records) {
    const trace = r.trace as any;
    const pl = trace?.pipeline || [];
    const idStage = pl.find((p: any) => p.stage === "Identity");

    if (idStage) {
      // Reason usually looks like: { vectorSimilarity: '100%', distance: '0.00' }
      // Or in earlier gates, reason might be a string.
      let distance = -1;
      let score = idStage.score;
      if (typeof idStage.reason === 'object' && idStage.reason !== null) {
         distance = parseFloat(idStage.reason.distance);
      } else if (typeof idStage.reason === 'string') {
         const match = idStage.reason.match(/Semantic Distance: ([0-9.]+)/);
         if (match) distance = parseFloat(match[1]);
      }
      
      if (distance !== -1) idDistances.push(distance);
      if (score !== undefined && score !== null) {
         idScoresPreVeto.push(score);
         idCoverages.push(score / 100.0);
         
         // Only non-vetoed
         if (r.vetoed === false) {
           nonVetoedTotal++;
           idScores.push(score);
           distinctIdentityValues.add(score);
           if (score === 100) countIdentity100NonVetoed++;
         }
      }
    }
  }

  console.log(`Pre-veto Identity Distances sample: ${idDistances.slice(0,10).join(', ')}`);
  console.log(`Pre-veto Identity Scores sample: ${idScoresPreVeto.slice(0,10).join(', ')}`);
  console.log(`Non-vetoed total: ${nonVetoedTotal}`);
  console.log(`Non-vetoed Identity 100 count: ${countIdentity100NonVetoed} (${(countIdentity100NonVetoed/nonVetoedTotal*100).toFixed(2)}%)`);
  console.log(`Distinct Identity Scores (Non-Vetoed):`, Array.from(distinctIdentityValues).sort((a,b)=>a-b));

  console.log("\n=========================================");
  console.log("D. TEST THE EXTREME CASES");
  console.log("=========================================\n");

  const getExample = (filterFn: (r: RecommendationRecord) => boolean, label: string) => {
    const ex = records.find(filterFn);
    if (!ex) {
      console.log(`[${label}]: No example found`);
      return;
    }
    const trace = ex.trace as any;
    console.log(`[${label}]: ${ex.jobHash}`);
    console.log(`  Verdict: ${ex.verb}`);
    console.log(`  RawScore: ${ex.rawScore}`);
    console.log(`  PriorityScore: ${ex.priority}`);
    console.log(`  Vetoed: ${ex.vetoed} (${ex.vetoReason || 'none'})`);
    console.log(`  Identity: ${trace.pipeline?.find((p:any)=>p.stage==="Identity")?.score}`);
    console.log(`  Capability: ${trace.pipeline?.find((p:any)=>p.stage==="Capability")?.score}`);
    console.log(`  Career: ${trace.pipeline?.find((p:any)=>p.stage==="Career")?.score}`);
    console.log(`  Friction: ${100 - (trace.pipeline?.find((p:any)=>p.stage==="Lifestyle")?.score || 100)}`);
  };

  getExample(r => r.verb === "PASS" && r.priority === 0 && r.rawScore !== undefined && r.rawScore > 0 && r.rawScore < 60, "Apparent 0-score PASS (Clamped)");
  getExample(r => r.verb === "PASS" && r.rawScore === 59, "Near-threshold PASS (59)");
  getExample(r => r.verb === "CONSIDER" && r.rawScore !== undefined && r.rawScore >= 60 && r.rawScore <= 62, "CONSIDER around 60");
  getExample(r => r.verb === "PURSUE" && r.rawScore !== undefined && r.rawScore >= 70 && r.rawScore <= 72, "PURSUE around 70");
  getExample(r => r.verb === "PURSUE" && r.rawScore !== undefined && r.rawScore >= 85, "High PURSUE around 85-90");

}

analyze();
