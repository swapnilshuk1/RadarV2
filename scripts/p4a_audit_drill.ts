import fs from "fs";
import path from "path";
import type { RecommendationRecord } from "../src/lib/intelligence/record";

function loadRecords(): RecommendationRecord[] {
  const p = path.resolve(process.cwd(), "scratch/audit_records.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function investigate() {
  const records = loadRecords();
  
  // 1. Check rawScore vs priorityScore
  console.log(`\n=== SCORE CLAMPING (Non-Veto Pass) ===`);
  const nonVetoPasses = records.filter(r => r.verb === "PASS" && r.vetoReason === null && r.priority === 0);
  console.log(`Found ${nonVetoPasses.length} cases where priority=0 but vetoReason=null.`);
  if (nonVetoPasses.length > 0) {
    console.log(`Sample Raw Scores for these clamped items:`);
    console.log(nonVetoPasses.slice(0, 10).map(r => r.rawScore).join(", "));
  }

  // 2. Check Easy Trap conditions
  console.log(`\n=== EASY TRAP CHECK ===`);
  const trapCandidates = records.filter(r => {
    const cv = r.trace?.factors?.careerValue ?? 0;
    const sp = r.trace?.factors?.shortlistingPotential ?? 0;
    const fric = r.trace?.factors?.pursuitFriction ?? 0;
    return cv < 50 && sp >= 80 && fric < 10;
  });
  console.log(`Cases matching CV < 50 AND SP >= 80 AND Friction < 10: ${trapCandidates.length}`);
  
  for (const c of trapCandidates.slice(0, 3)) {
    console.log(`Job: ${c.jobHash}, CV: ${c.trace?.factors?.careerValue}, SP: ${c.trace?.factors?.shortlistingPotential}, Fric: ${c.trace?.factors?.pursuitFriction}, Score: ${c.priority}, RawScore: ${c.rawScore}, Verb: ${c.verb}`);
  }

  // 3. Check Identity Score Distribution
  console.log(`\n=== IDENTITY SCORE DISTRIBUTION (Non-Zero) ===`);
  const idScores = records.map(r => {
    if (r.priority === 0) return -1;
    const pl = (r.trace as any)?.pipeline || [];
    const id = pl.find((p: any) => p.stage === "Identity");
    return id ? id.score : -1;
  }).filter(s => s >= 0);
  
  const idMin = Math.min(...idScores);
  const idMax = Math.max(...idScores);
  const idAvg = idScores.reduce((a, b) => a + b, 0) / idScores.length;
  console.log(`Min: ${idMin}, Max: ${idMax}, Avg: ${idAvg.toFixed(2)}, Sample sizes: ${idScores.length}`);
  
  let idExactly100 = idScores.filter(s => s === 100).length;
  console.log(`Identity scores exactly 100: ${idExactly100} / ${idScores.length}`);
}

investigate();
