/**
 * P3-B Deep Dive: High SP + PASS Analysis
 *
 * Investigates the 191 cases where SP >= 80 but decision is PASS.
 * These could be:
 * 1. Legitimate vetoes (identity, capability, regression)
 * 2. Signal contradictions requiring investigation
 */

import { runEngine, invalidateEngineCache } from "../src/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../src/data/candidate-profile";
import type { RecommendationRecord } from "../src/lib/intelligence/record";

interface HighSpPassCase {
  jobHash: string;
  cv: number;
  sp: number;
  friction: number;
  rawScore: number;
  vetoed: boolean;
  vetoReason: string | null;
  identityScore?: number;
  capabilityScore?: number;
  careerScore?: number;
  pipeline: string[];
  triggeredRules: string[];
}

function analyzeHighSpPass(records: RecommendationRecord[]) {
  const highSpPassCases: HighSpPassCase[] = [];

  for (const r of records) {
    const sp = r.decisionSummary?.shortlistingPotential ?? 0;
    const verb = r.verb;

    if (sp >= 80 && verb === "PASS") {
      const pipelineStages = (r.trace?.pipeline || []).map((p: any) => p.stage);
      const triggeredRules = r.trace?.pipeline
        ?.filter((p: any) => p.status === "FAILED" || p.status?.includes("VETO"))
        .map((p: any) => `${p.stage}:${p.status}`) || [];

      highSpPassCases.push({
        jobHash: r.jobHash,
        cv: r.decisionSummary?.careerValue ?? 0,
        sp,
        friction: r.decisionSummary?.pursuitFriction ?? 0,
        rawScore: r.rawScore ?? 0,
        vetoed: r.vetoed ?? false,
        vetoReason: r.vetoReason ?? null,
        identityScore: (r.trace as any)?.identityScore,
        capabilityScore: (r.trace as any)?.capabilityScore,
        careerScore: (r.trace as any)?.careerScore,
        pipeline: pipelineStages,
        triggeredRules
      });
    }
  }

  return highSpPassCases;
}

function categorizeByVetoReason(cases: HighSpPassCase[]) {
  const categories: Record<string, HighSpPassCase[]> = {
    "Identity Veto": [],
    "Execution Veto": [],
    "Regression Veto": [],
    "Sub-Tier Veto": [],
    "Other Veto": [],
    "Not Vetoed": []
  };

  for (const c of cases) {
    if (c.vetoReason?.includes("IDENTITY")) {
      categories["Identity Veto"].push(c);
    } else if (c.vetoReason?.includes("EXECUTION")) {
      categories["Execution Veto"].push(c);
    } else if (c.vetoReason?.includes("REGRESSION")) {
      categories["Regression Veto"].push(c);
    } else if (c.vetoReason?.includes("SUB-TIER")) {
      categories["Sub-Tier Veto"].push(c);
    } else if (c.vetoed) {
      categories["Other Veto"].push(c);
    } else {
      categories["Not Vetoed"].push(c);
    }
  }

  return categories;
}

function printReport(cases: HighSpPassCase[]) {
  console.log("\n" + "=".repeat(80));
  console.log("P3-B: HIGH SP (≥80) + PASS ANALYSIS");
  console.log("=".repeat(80));
  console.log(`\n📊 Total High SP + PASS Cases: ${cases.length}`);

  const categories = categorizeByVetoReason(cases);

  console.log("\n" + "-".repeat(80));
  console.log("CATEGORIZATION BY VETO REASON");
  console.log("-".repeat(80));

  for (const [category, casesInCategory] of Object.entries(categories)) {
    if (casesInCategory.length > 0) {
      console.log(`\n${category}: ${casesInCategory.length} cases`);
      console.log("Sample cases:");
      casesInCategory.slice(0, 3).forEach(c => {
        console.log(`  - ${c.jobHash}: CV=${c.cv}, SP=${c.sp}, Score=${c.rawScore}`);
        if (c.vetoReason) console.log(`    Veto: ${c.vetoReason}`);
        console.log(`    Pipeline: ${c.pipeline.slice(0, 4).join(" → ")}...`);
      });
    }
  }

  // Analyze NOT VETOED cases (potential real contradictions)
  const notVetoed = categories["Not Vetoed"];
  if (notVetoed.length > 0) {
    console.log("\n" + "-".repeat(80));
    console.log("⚠️ CASES NOT VETOED (Potential Contradictions)");
    console.log("-".repeat(80));
    console.log(`\nTotal: ${notVetoed.length} cases`);
    console.log("\nThese cases have high SP but still PASS without a veto:");
    notVetoed.slice(0, 10).forEach(c => {
      console.log(`\n  ${c.jobHash}:`);
      console.log(`    CV: ${c.cv}, SP: ${c.sp}, Friction: ${c.friction}`);
      console.log(`    Raw Score: ${c.rawScore}`);
      console.log(`    Pipeline: ${c.pipeline.join(" → ")}`);
    });

    if (notVetoed.length > 10) {
      console.log(`\n  ... and ${notVetoed.length - 10} more`);
    }
  }

  // Summary
  console.log("\n" + "=".repeat(80));
  console.log("SUMMARY");
  console.log("=".repeat(80));

  const vetoedCount = cases.filter(c => c.vetoed).length;
  const notVetoedCount = cases.filter(c => !c.vetoed).length;

  console.log(`\n✅ Legitimate Vetoes (High SP overridden by other factors): ${vetoedCount}`);
  console.log(`⚠️ Potential Contradictions (High SP + PASS without veto): ${notVetoedCount}`);

  if (notVetoedCount === 0) {
    console.log("\n✅ All High SP + PASS cases are legitimate vetoes");
    console.log("   The signals are coherent - high SP can be overridden by");
    console.log("   identity mismatches, capability gaps, or career regression.");
  } else if (notVetoedCount < 20) {
    console.log("\n⚠️ Minor number of non-vetoed cases - may be edge cases");
    console.log("   These could be cases where raw score just misses threshold.");
  } else {
    console.log("\n❌ Significant number of non-vetoed cases requires investigation");
    console.log("   Recommendation: Examine scoring thresholds and signal weights.");
  }

  console.log("\n" + "=".repeat(80));
}

async function main() {
  console.log("P3-B: Analyzing High SP + PASS cases...");

  invalidateEngineCache();

  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);

  const { records } = runEngine(projection, 0);

  const cases = analyzeHighSpPass(records);
  printReport(cases);
}

main().catch(console.error);
