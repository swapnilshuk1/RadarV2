/**
 * P3-C Deep Dive: JSON Leakage Investigation
 */

import { runEngine, invalidateEngineCache } from "../src/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../src/data/candidate-profile";
import type { RecommendationRecord } from "../src/lib/intelligence/record";

function investigateJsonLeakage(records: RecommendationRecord[]) {
  console.log("\n" + "=".repeat(80));
  console.log("P3-C: JSON LEAKAGE INVESTIGATION");
  console.log("=".repeat(80));

  const samples: RecommendationRecord[] = [];

  for (const r of records) {
    const pipelineStr = JSON.stringify(r.trace?.pipeline || []);
    if (pipelineStr.includes('"reason":{')) {
      if (samples.length < 5) {
        samples.push(r);
      }
    }
  }

  console.log(`\nFound ${samples.length} sample cases with JSON leakage\n`);

  for (const r of samples) {
    console.log("-".repeat(80));
    console.log(`Case: ${r.jobHash}`);
    console.log("-".repeat(80));
    console.log("\nPipeline:");
    (r.trace?.pipeline || []).forEach((stage: any, i: number) => {
      console.log(`  ${i + 1}. ${stage.stage}: ${JSON.stringify(stage, null, 2).substring(0, 200)}`);
    });
    console.log();
  }
}

async function main() {
  invalidateEngineCache();

  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);

  const { records } = runEngine(projection, 0);

  investigateJsonLeakage(records);
}

main().catch(console.error);
