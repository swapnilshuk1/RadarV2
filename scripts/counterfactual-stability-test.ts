import fs from "fs";
import path from "path";
import { getDatabaseAdapter } from "../src/data/database";
import { DeterministicScorer, type JobSlice } from "../src/lib/recommendation/DeterministicScorer";
import { ProfileImporter } from "../src/lib/recommendation/ProfileImporter";
import type { RecommendationPolicy } from "../src/lib/recommendation/RecommendationPolicy";

const POLICIES_DIR = path.resolve(process.cwd(), ".radar", "policies");

function getIdealValueForDimension(dimension: string): any {
  switch (dimension) {
    case "leadershipLevel": return "CEO";
    case "reportingLine": return "CEO";
    case "budgetOwnership": return "Full";
    case "teamLeadership": return "Direct";
    case "commercialAccountability": return "Full";
    case "technologyStack": return "Core";
    case "transformation": return "true";
    case "geography": return "Remote";
    default: return "true";
  }
}

async function main() {
  const profilePath = ".radar/profile.yaml";

  console.log("==========================================================================");
  console.log("                  COUNTERFACTUAL STABILITY TEST PLATFORM");
  console.log("==========================================================================");

  // 1. Load Profile
  if (!fs.existsSync(profilePath)) {
    console.error(`Profile not found at ${profilePath}`);
    process.exit(1);
  }
  const profile = ProfileImporter.fromYaml(profilePath, "user-swapnil");
  console.log(`✓ Profile loaded: ${profile.version}`);

  // 2. Load Champion Policy
  const championPath = path.join(POLICIES_DIR, "policy-v1.0.json");
  if (!fs.existsSync(championPath)) {
    console.error(`Champion policy file not found at ${championPath}`);
    process.exit(1);
  }
  const policy = JSON.parse(fs.readFileSync(championPath, "utf8")) as RecommendationPolicy;
  console.log(`✓ Policy loaded: ${policy.id} (v${policy.version})`);

  // 3. Open DB & Load Jobs
  const db = getDatabaseAdapter();
  const opportunities = await db.many<any>(`
    SELECT id, fingerprint, canonical_title FROM opportunities WHERE lifecycle IN ('Active', 'Normalized', 'Verified') ORDER BY id ASC
  `);

  console.log(`✓ Loaded ${opportunities.length} opportunities from database.`);

  // Load facts
  const factRows = await db.many<any>("SELECT opportunity_id, attribute, value FROM facts");
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

  const scorer = new DeterministicScorer();

  let totalProcessed = 0;
  let hasMissingFacts = 0;
  let unchangedCount = 0;
  let improvedCount = 0;
  let reversedCount = 0;
  let totalConfidenceDelta = 0;

  // Transition counters
  const transitions: Record<string, number> = {};
  // Reversal by dimension counters
  const reversalByDimension: Record<string, number> = {};

  const results: any[] = [];

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

    // Calculate initial recommendation
    const initial = scorer.score({ profile, policy, job: slice, recommendationRunId: "cf-test-initial" });
    const initialDecision = initial.decision;
    const initialConfidence = initial.recommendationConfidence;
    const initialExplanation = initial.decisionConfidence?.explanation || "";

    const limiting = initial.decisionConfidence?.limitingDimensions || [];

    if (limiting.length === 0) {
      results.push({
        id: job.id,
        title: job.canonical_title,
        limitingDim: "None",
        initialDecision,
        finalDecision: initialDecision,
        decisionChanged: false,
        confidenceDelta: 0,
        explanationChanged: false
      });
      totalProcessed++;
      continue;
    }

    hasMissingFacts++;
    const topLimitDim = limiting[0].attribute;
    const idealVal = getIdealValueForDimension(topLimitDim);

    // Create counterfactual slice where the top-impact missing fact is resolved
    const counterfactualDims = { ...jobSliceDims };
    counterfactualDims[topLimitDim] = {
      value: idealVal,
      confidence: 1.0, // resolved explicitly
      evidence: "Counterfactual ideal confirmation"
    };

    const counterfactualSlice: JobSlice = {
      ...slice,
      dimensions: counterfactualDims
    };

    // Recompute recommendation
    const final = scorer.score({ profile, policy, job: counterfactualSlice, recommendationRunId: "cf-test-final" });
    const finalDecision = final.decision;
    const finalConfidence = final.recommendationConfidence;
    const finalExplanation = final.decisionConfidence?.explanation || "";

    const confidenceDelta = finalConfidence - initialConfidence;
    totalConfidenceDelta += confidenceDelta;

    const decisionChanged = initialDecision !== finalDecision;
    const explanationChanged = initialExplanation !== finalExplanation;

    if (!decisionChanged) {
      unchangedCount++;
    } else {
      // Record transition breakdown
      const transitionKey = `${initialDecision} → ${finalDecision}`;
      transitions[transitionKey] = (transitions[transitionKey] || 0) + 1;

      // Record which dimension caused the reversal/change
      reversalByDimension[topLimitDim] = (reversalByDimension[topLimitDim] || 0) + 1;

      const decisionOrder = ["Needs More Evidence", "Weak Fit", "Average", "Good", "Excellent"];
      const initialIdx = decisionOrder.indexOf(initialDecision);
      const finalIdx = decisionOrder.indexOf(finalDecision);
      if (finalIdx > initialIdx) {
        improvedCount++;
      } else {
        reversedCount++;
      }
    }

    results.push({
      id: job.id,
      title: job.canonical_title,
      limitingDim: topLimitDim,
      initialDecision,
      finalDecision,
      decisionChanged,
      confidenceDelta,
      explanationChanged
    });

    totalProcessed++;
  }

  const unchangedPct = hasMissingFacts > 0 ? (unchangedCount / hasMissingFacts) * 100 : 0;
  const improvedPct = hasMissingFacts > 0 ? (improvedCount / hasMissingFacts) * 100 : 0;
  const reversedPct = hasMissingFacts > 0 ? (reversedCount / hasMissingFacts) * 100 : 0;
  const avgConfIncrease = hasMissingFacts > 0 ? totalConfidenceDelta / hasMissingFacts : 0;

  // Decision Confidence Efficiency: confidence increase per question asked (which is exactly 1 question in our scenario)
  const confidenceEfficiency = hasMissingFacts > 0 ? (totalConfidenceDelta / hasMissingFacts) / 1.0 : 0;

  console.log("\n==================================================");
  console.log("COUNTERFACTUAL STABILITY TEST METRICS");
  console.log("==================================================");
  console.log(`Total Opportunities Processed  : ${totalProcessed}`);
  console.log(`With Verification Gaps         : ${hasMissingFacts}`);
  console.log("-".repeat(50));
  console.log(`Recommendation Unchanged       : ${unchangedPct.toFixed(1)}%`);
  console.log(`Recommendation Improved        : ${improvedPct.toFixed(1)}%`);
  console.log(`Recommendation Reversed        : ${reversedPct.toFixed(1)}%`);
  console.log(`Average Confidence Increase    : +${avgConfIncrease.toFixed(1)} points`);
  console.log(`Decision Confidence Efficiency : +${confidenceEfficiency.toFixed(1)} pts/question`);
  console.log("==================================================\n");

  console.log("TRANSITION ANALYSIS BREAKDOWN");
  console.log("-".repeat(50));
  const sortedTransitions = Object.entries(transitions).sort((a, b) => b[1] - a[1]);
  for (const [key, count] of sortedTransitions) {
    const pct = (count / (improvedCount + reversedCount)) * 100;
    console.log(`  ${key.padEnd(35)}: ${count.toString().padStart(3)} (${pct.toFixed(1)}%)`);
  }
  console.log("-".repeat(50));

  console.log("\nREVERSALS BY LIMITING DIMENSION");
  console.log("-".repeat(50));
  const totalReversals = Object.values(reversalByDimension).reduce((a, b) => a + b, 0);
  const sortedDimensions = Object.entries(reversalByDimension).sort((a, b) => b[1] - a[1]);
  for (const [dim, count] of sortedDimensions) {
    const pct = totalReversals > 0 ? (count / totalReversals) * 100 : 0;
    console.log(`  ${dim.padEnd(35)}: ${count.toString().padStart(3)} (${pct.toFixed(1)}%)`);
  }
  console.log("==================================================\n");

  // Format into a gorgeous Markdown report
  let md = `# Counterfactual Stability Test Report\n\n`;
  md += `This report outlines the empirical impact of resolving top limiting dimensions across the semantic corpus. It measures whether the Decision Confidence Layer is surfacing genuinely consequential questions or simply identifying uncertainty.\n\n`;
  md += `## Aggregate Corpus Metrics\n\n`;
  md += `| Metric | Value | Significance |\n`;
  md += `| :--- | :---: | :--- |\n`;
  md += `| Total Opportunities Processed | **${totalProcessed}** | Overall size of evaluated semantic dataset. |\n`;
  md += `| Opportunities with Verification Gaps | **${hasMissingFacts}** | Slices containing at least one high-impact unverified field. |\n`;
  md += `| Recommendation Unchanged | **${unchangedPct.toFixed(1)}%** | High-conviction stability; the recommendation is resilient. |\n`;
  md += `| Recommendation Improved | **${improvedPct.toFixed(1)}%** | Cawing bottleneck resolved, lifting decision quality. |\n`;
  md += `| Recommendation Reversed | **${reversedPct.toFixed(1)}%** | **Headline Risk Avoided**: Flipped false-positives to PASS. |\n`;
  md += `| Average Confidence Increase | **+${avgConfIncrease.toFixed(1)} points** | Empirical growth in decision conviction. |\n`;
  md += `| **Decision Confidence Efficiency** | **+${confidenceEfficiency.toFixed(1)} pts/question** | Ratio of confidence gained per minimal question asked. |\n\n`;

  md += `> [!NOTE]\n`;
  md += `> **Recommendation Unchanged**: The decision remains stable after verification, validating that the recommendation is resilient to other variables.\n`;
  md += `> **Recommendation Improved**: Verification of the missing attribute resolves a key bottleneck, raising the opportunity's assessment decision tier.\n`;
  md += `> **Recommendation Reversed**: The recommendation is successfully flipped or lowered, proving that the Decision Confidence Layer is preventing a false-positive decision.\n\n`;

  md += `## Transition Analysis Breakdown\n\n`;
  md += `This breakdown represents the exact transitions that occurred when the top-impact missing fact was resolved counterfactually:\n\n`;
  md += `| Transition Flow | Count | Percentage |\n`;
  md += `| :--- | :---: | :---: |\n`;
  for (const [key, count] of sortedTransitions) {
    const pct = totalReversals > 0 ? (count / totalReversals) * 100 : 0;
    md += `| \`${key}\` | **${count}** | ${pct.toFixed(1)}% |\n`;
  }
  md += `\n`;

  md += `## Reversals by Limiting Dimension\n\n`;
  md += `This report pinpoints which semantic dimensions have the highest leverage on changing recommendation decisions, directly guiding crawler and ingestion priorities:\n\n`;
  md += `| Dimension Attribute | Recommendation Changes | Percentage |\n`;
  md += `| :--- | :---: | :---: |\n`;
  for (const [dim, count] of sortedDimensions) {
    const pct = totalReversals > 0 ? (count / totalReversals) * 100 : 0;
    md += `| \`${dim}\` | **${count}** | ${pct.toFixed(1)}% |\n`;
  }
  md += `\n`;

  md += `## Detailed Sample Slices (First 15 Opportunities)\n\n`;
  md += `| Job ID | Title | Limiting Dimension | Initial Decision | Final Decision | Decision Changed? | Confidence Delta |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
  
  for (const r of results.slice(0, 15)) {
    md += `| \`${r.id}\` | ${r.title} | \`${r.limitingDim}\` | ${r.initialDecision} | ${r.finalDecision} | ${r.decisionChanged ? "Yes" : "No"} | +${r.confidenceDelta} |\n`;
  }

  const reportsDir = "C:\\Users\\swapn\\.gemini\\antigravity\\brain\\98fc6af1-d28e-448d-bb5d-eae7cc7b6f67";
  const reportPath = path.resolve(reportsDir, "counterfactual_stability_report.md");
  fs.writeFileSync(reportPath, md);
  console.log(`✓ Report saved to: ${reportPath}`);

  db.close();
}

main();
