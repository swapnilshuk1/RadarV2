import fs from "fs";
import path from "path";
import crypto from "crypto";
import Database from "better-sqlite3";
import { DeterministicScorer, type JobSlice } from "../src/lib/recommendation/DeterministicScorer";
import { ProfileImporter } from "../src/lib/recommendation/ProfileImporter";
import type { RecommendationPolicy, PolicyComparison } from "../src/lib/recommendation/RecommendationPolicy";
import { CalibrationStore, type CalibrationRunMetadata } from "../src/lib/recommendation/persistence/CalibrationStore";

const POLICIES_DIR = path.resolve(process.cwd(), ".radar", "policies");
const RUNS_DIR = path.resolve(process.cwd(), ".radar", "calibration-runs");
fs.mkdirSync(POLICIES_DIR, { recursive: true });
fs.mkdirSync(RUNS_DIR, { recursive: true });

function computeHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function main() {
  const args = process.argv.slice(2);
  const profilePath = args.find(a => a.startsWith("--profile="))?.split("=")[1] ?? ".radar/profile.yaml";
  const candidateName = args.find(a => a.startsWith("--candidate="))?.split("=")[1] ?? "candidate.json";
  const dbPath = path.resolve(process.cwd(), "radar.sqlite");

  console.log("==========================================================================");
  console.log("                      RADAR POLICY CALIBRATION PLATFORM");
  console.log("==========================================================================");

  // 1. Load Profile & Generate Hash
  if (!fs.existsSync(profilePath)) {
    console.error(`Profile not found at ${profilePath}`);
    process.exit(1);
  }
  const profileContent = fs.readFileSync(profilePath, "utf8");
  const profile = ProfileImporter.fromYaml(profilePath, "user-swapnil");
  const profileHash = computeHash(profileContent + profile.version);
  console.log(`✓ Profile loaded: ${profile.version} (Hash: ${profileHash.substring(0, 12)}...)`);

  // 2. Load Technology Ontology & Generate Hash
  const ontologyPath = path.resolve(process.cwd(), "config", "technology-ontology.json");
  if (!fs.existsSync(ontologyPath)) {
    console.error(`Ontology config not found at ${ontologyPath}`);
    process.exit(1);
  }
  const ontologyContent = fs.readFileSync(ontologyPath, "utf8");
  const ontologyHash = computeHash(ontologyContent);
  console.log(`✓ Technology Ontology loaded (Hash: ${ontologyHash.substring(0, 12)}...)`);

  // 3. Load Champion Policy
  const championPath = path.join(POLICIES_DIR, "policy-v1.0.json");
  if (!fs.existsSync(championPath)) {
    console.error(`Champion policy file not found at ${championPath}`);
    process.exit(1);
  }
  const championContent = fs.readFileSync(championPath, "utf8");
  const championPolicy = JSON.parse(championContent) as RecommendationPolicy;
  const championHash = computeHash(championContent);
  console.log(`✓ Champion Policy : ${championPolicy.id} (v${championPolicy.version}, Hash: ${championHash.substring(0, 12)}...)`);

  // 4. Load Candidate Policy Config
  const candidatePath = path.join(POLICIES_DIR, candidateName);
  if (!fs.existsSync(candidatePath)) {
    console.error(`Candidate policy file not found at ${candidatePath}`);
    process.exit(1);
  }
  const candidateContent = fs.readFileSync(candidatePath, "utf8");
  const candidatePolicy = JSON.parse(candidateContent) as RecommendationPolicy;
  const candidateHash = computeHash(candidateContent);
  console.log(`✓ Candidate PolicyTemplate: ${candidatePolicy.id} (v${candidatePolicy.version})`);

  // 5. Open Database & Compute Semantic Corpus Hash
  const db = new Database(dbPath, { readonly: true });
  const opportunities = db.prepare(`
    SELECT id, fingerprint, canonical_title FROM opportunities WHERE lifecycle IN ('Normalized', 'Verified') ORDER BY id ASC
  `).all() as any[];

  const semanticData = opportunities.map(o => `${o.id}:${o.fingerprint}`).join("|");
  const corpusHash = computeHash(semanticData);
  console.log(`✓ Semantic Corpus loaded: ${opportunities.length} jobs (Hash: ${corpusHash.substring(0, 12)}...)`);

  // Load knowledge graph slices
  const factRows = db.prepare("SELECT opportunity_id, attribute, value FROM facts").all() as any[];
  const factsByJob = new Map<string, Record<string, any>>();
  for (const fact of factRows) {
    if (!factsByJob.has(fact.opportunity_id)) factsByJob.set(fact.opportunity_id, {});
    try {
      const parsed = JSON.parse(fact.value);
      factsByJob.get(fact.opportunity_id)![fact.attribute] = parsed?.value ?? parsed ?? null;
    } catch {
      factsByJob.get(fact.opportunity_id)![fact.attribute] = fact.value;
    }
  }

  // Evaluator function
  const scorer = new DeterministicScorer();
  const runEvaluation = (policy: RecommendationPolicy) => {
    const decisions = new Map<string, { decision: string; score: number; confidence: number }>();
    for (const job of opportunities) {
      const jobFacts = factsByJob.get(job.id) ?? {};
      const jobSliceDims: Record<string, any> = {};
      for (const [k, v] of Object.entries(jobFacts)) {
        jobSliceDims[k] = { value: v };
      }
      const slice: JobSlice = {
        jobId: job.id,
        jobHash: job.fingerprint,
        graphVersion: "v1",
        dimensions: jobSliceDims
      };

      const assessment = scorer.score({ profile, policy, job: slice, recommendationRunId: "calibration" });
      decisions.set(job.id, {
        decision: assessment.decision,
        score: assessment.score,
        confidence: assessment.recommendationConfidence
      });
    }
    return decisions;
  };

  console.log("\nEvaluating Champion Baseline...");
  const championResults = runEvaluation(championPolicy);

  // Compute Champion baseline stats
  let champExcellent = 0;
  let champGood = 0;
  let champAverage = 0;
  let champWeak = 0;
  let champNeedsEvidence = 0;
  let champTotalConfidence = 0;
  let champTotalScore = 0;

  for (const job of opportunities) {
    const champ = championResults.get(job.id)!;
    champTotalConfidence += champ.confidence;
    champTotalScore += champ.score;
    if (champ.decision === "Excellent Fit") champExcellent++;
    else if (champ.decision === "Good Fit") champGood++;
    else if (champ.decision === "Average Fit") champAverage++;
    else if (champ.decision === "Weak Fit") champWeak++;
    else champNeedsEvidence++;
  }
  const champAvgConfidence = champTotalConfidence / opportunities.length;
  const champAvgScore = champTotalScore / opportunities.length;

  console.log(`  Champion Metrics -> Excellent: ${champExcellent} | Good: ${champGood} | Needs Evidence: ${champNeedsEvidence} | Avg Conf: ${champAvgConfidence.toFixed(1)}%`);

  // Weight Sweep List
  const techWeightsSweep = [10, 12, 15];
  console.log(`\nStarting calibration sweep over Technology Stack weights: [${techWeightsSweep.join(", ")}]...`);

  const sweepRuns: {
    weight: number;
    results: Map<string, { decision: string; score: number; confidence: number }>;
    stabilityIndex: number;
    volatility: number;
    excellentDelta: number;
    goodDelta: number;
    averageDelta: number;
    weakDelta: number;
    needsEvidenceDelta: number;
    avgScore: number;
    avgConfidence: number;
    outcome: "REJECT" | "PASS" | "PROMOTE";
    rejectionReason: string;
  }[] = [];

  for (const weight of techWeightsSweep) {
    const tempPolicy = JSON.parse(JSON.stringify(candidatePolicy)) as RecommendationPolicy;
    tempPolicy.weights.technologyStack = weight;

    const candResults = runEvaluation(tempPolicy);

    // Calculate metrics
    let stableJobs = 0;
    let changedJobs = 0;
    let excellentDelta = 0;
    let goodDelta = 0;
    let averageDelta = 0;
    let weakDelta = 0;
    let needsEvidenceDelta = 0;
    let totalScore = 0;
    let totalConfidence = 0;

    let candExcellent = 0;
    let candGood = 0;
    let candNeedsEvidence = 0;

    for (const job of opportunities) {
      const champ = championResults.get(job.id)!;
      const cand = candResults.get(job.id)!;

      totalScore += cand.score;
      totalConfidence += cand.confidence;

      if (champ.decision === cand.decision) {
        stableJobs++;
      } else {
        changedJobs++;
      }

      if (cand.decision === "Excellent Fit") {
        candExcellent++;
        excellentDelta++;
      }
      if (champ.decision === "Excellent Fit") excellentDelta--;

      if (cand.decision === "Good Fit") {
        candGood++;
        goodDelta++;
      }
      if (champ.decision === "Good Fit") goodDelta--;

      if (cand.decision === "Average Fit") averageDelta++;
      if (champ.decision === "Average Fit") averageDelta--;

      if (cand.decision === "Weak Fit") weakDelta++;
      if (champ.decision === "Weak Fit") weakDelta--;

      if (cand.decision === "Needs More Evidence") {
        candNeedsEvidence++;
        needsEvidenceDelta++;
      }
      if (champ.decision === "Needs More Evidence") needsEvidenceDelta--;
    }

    const totalJobs = opportunities.length;
    const stabilityIndex = stableJobs / totalJobs;
    const volatility = changedJobs / totalJobs;
    const avgScore = totalScore / totalJobs;
    const avgConfidence = totalConfidence / totalJobs;

    // Promotion gate checks
    let outcome: "REJECT" | "PASS" | "PROMOTE" = "REJECT";
    let rejectionReason = "";

    // 1. Safety Checks (Must meet all to avoid REJECT)
    const isSafe = volatility < 0.15 && 
                   stabilityIndex >= 0.85 && 
                   avgConfidence >= champAvgConfidence - 0.01;

    if (!isSafe) {
      outcome = "REJECT";
      if (volatility >= 0.15) rejectionReason += "Volatility exceeds 15% limit. ";
      if (stabilityIndex < 0.85) rejectionReason += "Stability Index is below 85% limit. ";
      if (avgConfidence < champAvgConfidence - 0.01) rejectionReason += `Average confidence decreased: ${avgConfidence.toFixed(2)}% vs Champion ${champAvgConfidence.toFixed(2)}%. `;
    } else {
      // 2. Quality / Improvement Checks (Requires delta gain to PROMOTE, else PASS)
      const deltaExcGood = (excellentDelta + goodDelta);
      const isBetter = deltaExcGood > 0 || (deltaExcGood === 0 && avgScore > champAvgScore);
      
      if (isBetter) {
        outcome = "PROMOTE";
      } else {
        outcome = "PASS";
        rejectionReason = "Safe, but no measurable quality/score improvements.";
      }
    }

    console.log(`  Weight ${weight.toString().padStart(2)}: Stability: ${(stabilityIndex*100).toFixed(1)}% | Volatility: ${(volatility*100).toFixed(1)}% | Avg Conf: ${avgConfidence.toFixed(1)}% | Outcome: ${outcome}`);
    if (rejectionReason) {
      console.log(`           Notes: ${rejectionReason}`);
    }

    sweepRuns.push({
      weight,
      results: candResults,
      stabilityIndex,
      volatility,
      excellentDelta,
      goodDelta,
      averageDelta,
      weakDelta,
      needsEvidenceDelta,
      avgScore,
      avgConfidence,
      outcome,
      rejectionReason
    });
  }

  // 6. Select Best Sweep Run
  const promoteRuns = sweepRuns.filter(r => r.outcome === "PROMOTE");
  const passRuns = sweepRuns.filter(r => r.outcome === "PASS");
  let bestRun = sweepRuns[0];

  if (promoteRuns.length > 0) {
    promoteRuns.sort((a, b) => b.weight - a.weight);
    bestRun = promoteRuns[0];
  } else if (passRuns.length > 0) {
    passRuns.sort((a, b) => b.weight - a.weight);
    bestRun = passRuns[0];
  } else {
    sweepRuns.sort((a, b) => b.stabilityIndex - a.stabilityIndex);
    bestRun = sweepRuns[0];
  }

  console.log(`\nSelected configuration with Technology Stack weight: ${bestRun.weight} (Outcome: ${bestRun.outcome})`);

  // 7. Persist Metadata & Manifest
  const store = new CalibrationStore();
  const timestamp = new Date().toISOString();
  const runId = `run_${Date.now()}`;

  const promotedPolicy = JSON.parse(JSON.stringify(candidatePolicy)) as RecommendationPolicy;
  promotedPolicy.weights.technologyStack = bestRun.weight;

  const runMeta: CalibrationRunMetadata = {
    id: runId,
    timestamp,
    policyVersion: promotedPolicy.version,
    profileHash,
    corpusHash,
    volatility: bestRun.volatility,
    excellentCount: Array.from(bestRun.results.values()).filter(r => r.decision === "Excellent Fit").length,
    goodCount: Array.from(bestRun.results.values()).filter(r => r.decision === "Good Fit").length,
    averageCount: Array.from(bestRun.results.values()).filter(r => r.decision === "Average Fit").length,
    weakCount: Array.from(bestRun.results.values()).filter(r => r.decision === "Weak Fit").length,
    insufficientCount: Array.from(bestRun.results.values()).filter(r => r.decision === "Needs More Evidence").length,
    avgScore: bestRun.avgScore,
    avgConfidence: bestRun.avgConfidence
  };

  const comparison: PolicyComparison = {
    id: `comp_${Date.now()}`,
    timestamp,
    championPolicyId: championPolicy.id,
    candidatePolicyId: promotedPolicy.id,
    corpusHash,
    profileHash,
    stabilityIndex: bestRun.stabilityIndex,
    volatility: bestRun.volatility,
    excellentDelta: bestRun.excellentDelta,
    goodDelta: bestRun.goodDelta,
    averageDelta: bestRun.averageDelta,
    weakDelta: bestRun.weakDelta,
    insufficientEvidenceDelta: bestRun.needsEvidenceDelta,
    winner: bestRun.outcome === "PROMOTE" ? "CANDIDATE" : "CHAMPION"
  };

  try {
    store.saveRun(runMeta);
    store.saveComparison(comparison);
    console.log("✓ Calibration results persisted to SQLite successfully.");
  } catch (err) {
    console.error("Failed to persist run to database:", err);
  } finally {
    store.close();
  }

  // Save manifest
  const manifest = {
    runId,
    timestamp,
    champion: {
      id: championPolicy.id,
      version: championPolicy.version,
      hash: championHash
    },
    candidate: {
      id: promotedPolicy.id,
      version: promotedPolicy.version,
      hash: computeHash(JSON.stringify(promotedPolicy))
    },
    hashes: {
      profileHash,
      ontologyHash,
      corpusHash
    },
    results: runMeta,
    comparison
  };
  const manifestPath = path.join(RUNS_DIR, `run_manifest_${runId}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`✓ Calibration manifest saved to: .radar/calibration-runs/run_manifest_${runId}.json`);

  // 8. Output Executive Policy Calibration result summary box
  console.log("\n" + "==================================================");
  console.log("POLICY CALIBRATION RESULT");
  console.log("==================================================");
  console.log(`Champion:            ${championPolicy.version}`);
  console.log(`Candidate:           ${promotedPolicy.version} (Tech Weight: ${bestRun.weight})`);
  console.log(`Stability:           ${(bestRun.stabilityIndex * 100).toFixed(1)}%`);
  console.log(`Volatility:          ${(bestRun.volatility * 100).toFixed(1)}%`);
  console.log("-".repeat(50));
  console.log(`Excellent Fit:       ${bestRun.excellentDelta >= 0 ? "+" : ""}${bestRun.excellentDelta}`);
  console.log(`Good Fit:            ${bestRun.goodDelta >= 0 ? "+" : ""}${bestRun.goodDelta}`);
  console.log(`Weak Fit:            ${bestRun.weakDelta >= 0 ? "+" : ""}${bestRun.weakDelta}`);
  console.log(`Needs More Evidence: ${bestRun.needsEvidenceDelta >= 0 ? "+" : ""}${bestRun.needsEvidenceDelta}`);
  console.log(`Average Score:       ${(bestRun.avgScore - champAvgScore) >= 0 ? "+" : ""}${(bestRun.avgScore - champAvgScore).toFixed(1)}`);
  console.log(`Average Confidence:  ${(bestRun.avgConfidence - champAvgConfidence) >= 0 ? "+" : ""}${(bestRun.avgConfidence - champAvgConfidence).toFixed(1)}%`);
  console.log("-".repeat(50));
  
  let outcomeText = "❌ REJECT";
  if (bestRun.outcome === "PROMOTE") outcomeText = "✅ PROMOTE";
  else if (bestRun.outcome === "PASS") outcomeText = "🟡 PASS (No Quality Delta)";

  console.log(`Promotion Decision:  ${outcomeText}`);
  console.log("==================================================\n");

  db.close();
}

main();
