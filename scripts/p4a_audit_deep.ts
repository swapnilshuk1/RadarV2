import fs from "fs";
import path from "path";
import type { RecommendationRecord } from "../src/lib/intelligence/record";

function loadRecords(): RecommendationRecord[] {
  const p = path.resolve(process.cwd(), "scratch/audit_records.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function analyze() {
  const records = loadRecords();
  
  // 1. Analyze 0s
  const zeroScores = records.filter(r => r.priority === 0 || r.priority === null);
  console.log(`\n=== 0 SCORE ANALYSIS ===`);
  console.log(`Total zeros/nulls: ${zeroScores.length}`);
  
  const vetoReasons = new Map<string, number>();
  for (const r of zeroScores) {
    if (r.vetoReason) {
      vetoReasons.set(r.vetoReason, (vetoReasons.get(r.vetoReason) || 0) + 1);
    } else {
      // It was passed but not vetoed. This means it just fell below CONSIDER threshold
      const rId = r.trace?.triggeredRuleIds?.[0] || "No Rule";
      vetoReasons.set(`Non-Veto Pass (${rId})`, (vetoReasons.get(`Non-Veto Pass (${rId})`) || 0) + 1);
    }
  }
  for (const [k, v] of vetoReasons.entries()) {
    console.log(`  ${k}: ${v}`);
  }

  // 2. Component relationships (only for scores > 0 to see the scale)
  const nonZero = records.filter(r => r.priority && r.priority > 0);
  console.log(`\n=== COMPONENT RELATIONSHIPS (Non-Zero Scores: ${nonZero.length}) ===`);
  
  let totalIdentity = 0, totalCap = 0, totalCareer = 0, totalOpp = 0, totalFriction = 0;
  for (const r of nonZero) {
    const trace = r.trace as any;
    const pl = trace.pipeline || [];
    
    const idStage = pl.find((p:any) => p.stage === "Identity");
    const capStage = pl.find((p:any) => p.stage === "Capability");
    const careerStage = pl.find((p:any) => p.stage === "Career");
    const lifeStage = pl.find((p:any) => p.stage === "Lifestyle");
    
    if (idStage) totalIdentity += idStage.score || 0;
    if (capStage) totalCap += capStage.score || 0;
    if (careerStage) totalCareer += careerStage.score || 0;
    if (lifeStage) totalFriction += (100 - (lifeStage.score || 100)); // friction is 100 - score
  }
  
  const n = nonZero.length;
  if (n > 0) {
    console.log(`Average Identity Score: ${(totalIdentity/n).toFixed(2)}`);
    console.log(`Average Capability Score: ${(totalCap/n).toFixed(2)}`);
    console.log(`Average Career Score: ${(totalCareer/n).toFixed(2)}`);
    console.log(`Average Friction: ${(totalFriction/n).toFixed(2)}`);
  }

  // 3. Signal Conflict Matrix
  console.log(`\n=== SIGNAL CONFLICT MATRIX (All Records) ===`);
  const matrix: Record<string, { count: number, decisions: Record<string, number>, avgScore: number }> = {};
  
  for (const r of records) {
    const trace = r.trace as any;
    const cv = trace.factors?.careerValue || 0;
    const sp = trace.factors?.shortlistingPotential || 0;
    const friction = trace.factors?.pursuitFriction || 0;
    
    const cvBand = cv >= 70 ? "High CV" : (cv >= 40 ? "Med CV" : "Low CV");
    const spBand = sp >= 70 ? "High SP" : (sp >= 40 ? "Med SP" : "Low SP");
    const fricBand = friction > 10 ? "High Fric" : "Low Fric";
    
    const key = `${cvBand} | ${spBand} | ${fricBand}`;
    if (!matrix[key]) matrix[key] = { count: 0, decisions: {}, avgScore: 0 };
    
    matrix[key].count++;
    matrix[key].decisions[r.verb] = (matrix[key].decisions[r.verb] || 0) + 1;
    matrix[key].avgScore += (r.priority || 0);
  }
  
  for (const [k, v] of Object.entries(matrix)) {
    console.log(`[${k}]: ${v.count} cases, Avg Score: ${(v.avgScore / v.count).toFixed(2)}, Decisions: ${JSON.stringify(v.decisions)}`);
  }

  // 4. Easy Trap / CV Protection
  console.log(`\n=== EASY TRAP CHECK ===`);
  const easyTraps = records.filter(r => r.trace?.triggeredRuleIds?.includes("R-CONSIDER-CAREER-VALUE-PROTECTION"));
  console.log(`Found ${easyTraps.length} Easy Trap cases.`);
  for (const t of easyTraps.slice(0, 3)) {
     console.log(`  Job: ${t.jobHash}, CV: ${t.trace?.factors?.careerValue}, SP: ${t.trace?.factors?.shortlistingPotential}, Fric: ${t.trace?.factors?.pursuitFriction}, Score: ${t.priority}, Verb: ${t.verb}`);
  }
}

analyze();
