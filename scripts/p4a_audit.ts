import fs from "fs";
import path from "path";
import { runEngine, injectFixtureRecords } from "../src/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../src/data/candidate-profile";
import type { OpportunitySource } from "../src/data/opportunity-fixtures";

async function main() {
  console.log("Loading live-scraped.json...");
  const dataPath = path.resolve(process.cwd(), "src/data/live-scraped.json");
  const jobs = JSON.parse(fs.readFileSync(dataPath, "utf-8")) as OpportunitySource[];
  console.log(`Loaded ${jobs.length} jobs.`);

  console.log("Building candidate projection...");
  const candBuilder = new CandidateProjectionBuilderImpl();
  const candProj = candBuilder.fromProfile(candidateProfile);

  console.log("Running engine over all jobs...");
  injectFixtureRecords(jobs);

  const start = Date.now();
  const { records } = runEngine(candProj, 0);
  const duration = Date.now() - start;
  console.log(`Engine run complete in ${duration}ms. Produced ${records.length} records.`);

  // Phase 2: Distribution
  const scoreDistribution = new Array(11).fill(0); // 0-9, 10-19, ..., 90-99, 100
  const decisionDist = { PURSUE: 0, CONSIDER: 0, PASS: 0, SPARSE_SPEC: 0, NOT_EVALUABLE: 0 };
  let min = 100, max = 0, sum = 0;

  for (const r of records) {
    const s = r.priority ?? 0;
    if (s < min) min = s;
    if (s > max) max = s;
    sum += s;
    
    let bucket = Math.floor(s / 10);
    if (bucket > 10) bucket = 10;
    if (s === 100) bucket = 10;
    scoreDistribution[bucket]++;
    
    decisionDist[r.verb as keyof typeof decisionDist] = (decisionDist[r.verb as keyof typeof decisionDist] || 0) + 1;
  }
  const mean = sum / records.length;
  
  // Sort for percentiles
  const sortedScores = records.map(r => r.priority ?? 0).sort((a, b) => a - b);
  const p25 = sortedScores[Math.floor(records.length * 0.25)];
  const p50 = sortedScores[Math.floor(records.length * 0.5)];
  const p75 = sortedScores[Math.floor(records.length * 0.75)];
  const p90 = sortedScores[Math.floor(records.length * 0.90)];
  const p99 = sortedScores[Math.floor(records.length * 0.99)];

  console.log("=== SCORE DISTRIBUTION ===");
  console.log(`Min: ${min}, Max: ${max}, Mean: ${mean.toFixed(2)}, Median: ${p50}`);
  console.log(`Percentiles: P25=${p25}, P50=${p50}, P75=${p75}, P90=${p90}, P99=${p99}`);
  console.log("Hist:");
  for (let i = 0; i < 11; i++) {
    const label = i === 10 ? "100" : `${i * 10}-${i * 10 + 9}`;
    console.log(`  ${label.padEnd(7)}: ${scoreDistribution[i]}`);
  }
  console.log("Decisions:", decisionDist);

  // Output all records to a file for analysis
  const outPath = path.resolve(process.cwd(), "scratch/audit_records.json");
  if (!fs.existsSync(path.dirname(outPath))) fs.mkdirSync(path.dirname(outPath));
  fs.writeFileSync(outPath, JSON.stringify(records, null, 2));
  console.log(`Dumped full records to ${outPath}`);
}

main().catch(console.error);
