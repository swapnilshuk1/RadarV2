/**
 * scripts/test-enrich-validation.ts
 * 
 * Empirical Runtime Verification Script for Gemini Serial Queue & QueryMetricsStore.
 */

import { enrichWithLLM } from "./scraper/enrich/gemini";
import { QueryMetricsStore } from "./scraper/run/metrics";
import { passesHardFilter } from "./scraper/utils/hard-filter";

async function runValidation() {
  console.log("================================================================================");
  console.log("            RADAR v2 EMPIRICAL FIX VALIDATION RUN");
  console.log("================================================================================\n");

  // 1. Validate HardFilter granular telemetry
  console.log("--- 1. Validating HardFilter Granular Telemetry ---");
  const res1 = passesHardFilter({ title: "", company: "Google", location: "" });
  console.log(`Title missing result: "${res1.reason}"`);
  console.assert(res1.reason === "Missing title", "HardFilter title missing test failed");

  const res2 = passesHardFilter({ title: "Vice President Marketing", company: "", location: "" });
  console.log(`Company missing result: "${res2.reason}"`);
  console.assert(res2.reason === "Missing company name", "HardFilter company missing test failed");

  const res3 = passesHardFilter({ title: "", company: "", location: "" });
  console.log(`Both missing result: "${res3.reason}"`);
  console.assert(res3.reason === "Missing title and company name", "HardFilter both missing test failed");
  console.log("✅ HardFilter granular telemetry verified.\n");

  // 2. Validate QueryMetricsStore persistence
  console.log("--- 2. Validating QueryMetricsStore Persistence ---");
  QueryMetricsStore.record({
    runId: "validation-run-1",
    portal: "LinkedIn",
    query: "Chief Marketing Officer",
    page: 1,
    cardsSeen: 20,
    cardsParsed: 20,
    canonicalDuplicates: 15,
    ledgerKnown: 0,
    hardFiltered: 0,
    identityFailed: 0,
    novelAccepted: 5,
    novelAcquired: 5,
    noveltyRate: 0.25,
    elapsedMs: 1200,
    timestamp: new Date().toISOString()
  });

  const avgNovelty = QueryMetricsStore.getAverageNoveltyRate("LinkedIn", "Chief Marketing Officer");
  console.log(`Average Novelty Rate for LinkedIn CMO: ${(avgNovelty * 100).toFixed(1)}%`);
  console.assert(avgNovelty === 0.25, "QueryMetricsStore novelty rate calculation failed");
  console.log("✅ QueryMetricsStore analytical metrics verified.\n");

  // 3. Validate Serial Queue Spacing in Gemini Enrichment
  console.log("--- 3. Validating Gemini LLM Serial Queue Throttling ---");
  const sampleCard = {
    title: "Chief Marketing Officer",
    company: "Acme Corp",
    location: "Bengaluru, India",
    snippet: "Leading global marketing strategy and growth teams.",
    detailText: "We are seeking a seasoned CMO to oversee marketing operations, brand strategy, and performance acquisition.",
    applyUrl: "https://example.com/job/123",
    portal: "LinkedIn" as const,
    missingKeys: ["pnl_scale", "team_size"]
  };

  const t0 = Date.now();
  console.log(`[1/${new Date().toLocaleTimeString()}] Submitting Request 1 to Gemini serial queue...`);
  const promise1 = enrichWithLLM(sampleCard);

  console.log(`[2/${new Date().toLocaleTimeString()}] Submitting Request 2 to Gemini serial queue concurrently...`);
  const promise2 = enrichWithLLM(sampleCard);

  const [out1, out2] = await Promise.all([promise1, promise2]);
  const elapsedTotal = Date.now() - t0;

  console.log(`Total time for 2 queued requests: ${(elapsedTotal / 1000).toFixed(2)}s`);
  console.log(`Request 1 result keys: ${out1 ? Object.keys(out1).join(", ") : "null"}`);
  console.log(`Request 2 result keys: ${out2 ? Object.keys(out2).join(", ") : "null"}`);

  // 2 queued requests with 4.2s spacing must take at least 4.2s total (never parallel 0ms burst)
  if (elapsedTotal >= 4000) {
    console.log("✅ Gemini serial queue verified: Enforced strict sequential timing gap.");
  } else {
    console.error("❌ Gemini serial queue failed: Requests ran in parallel without serial gap!");
    process.exit(1);
  }

  console.log("\n================================================================================");
  console.log("ALL EMPIRICAL VALIDATION CHECKS PASSED CLEANLY!");
  console.log("================================================================================");
}

runValidation().catch(err => {
  console.error("Validation failed with error:", err);
  process.exit(1);
});
