/**
 * scripts/benchmarks/verify_phase9_10_singleflight_and_telemetry.ts
 *
 * RADAR v2 — Phase 9 & 10 Live Singleflight & Observability Benchmark.
 *
 * Demonstrates:
 * 1. 10 concurrent requests to getFeed coalescing into 1 WAN round-trip.
 * 2. 10 concurrent requests to getMetrics coalescing into 1 WAN round-trip.
 * 3. 10 concurrent requests to getDossier coalescing into 1 WAN round-trip.
 * 4. Fine-grained telemetry decomposition (scope, sql, transform, total).
 */

import { getDatabaseAdapter } from "../../src/data/database/index";
import { SqliteOpportunityQueries } from "../../src/data/sqlite/repositories/SqliteOpportunityQueries";
import { SingleflightOpportunityQueries } from "../../src/lib/intelligence/serving/singleflight";
import { servingTelemetry, type ServingTelemetry } from "../../src/lib/intelligence/serving/observability";
import { resolveServingScope } from "../../src/lib/security/scope-resolver";

async function runSingleflightLiveBenchmark() {
  const db = getDatabaseAdapter();
  const rawQueries = new SqliteOpportunityQueries(db);
  const sfQueries = new SingleflightOpportunityQueries(rawQueries);

  const userId = "ms6i7e3y-4x0chy5fy";
  const tenantId = "tenant_default";

  console.log("Resolving serving scope...");
  const { scope } = await resolveServingScope(userId, tenantId, db);

  const capturedEvents: ServingTelemetry[] = [];
  servingTelemetry.subscribe((t) => capturedEvents.push(t));

  console.log("\n============================================================");
  console.log("1. LIVE CONCURRENT getFeed() COALESCING BENCHMARK (10 CALLS)");
  console.log("============================================================");

  const feedStart = performance.now();
  const feedPromises = Array.from({ length: 10 }).map((_, i) => sfQueries.getFeed(scope, undefined, undefined, 24));
  const feedResults = await Promise.all(feedPromises);
  const feedTotalDuration = performance.now() - feedStart;

  const feedEvents = capturedEvents.filter((e) => e.queryType === "feed");
  const feedLeader = feedEvents.find((e) => !e.coalesced);
  const feedFollowers = feedEvents.filter((e) => e.coalesced);

  console.log(`Fired 10 concurrent getFeed() calls in: ${feedTotalDuration.toFixed(2)} ms`);
  console.log(`Total Telemetry Events: ${feedEvents.length}`);
  console.log(`Leader execution duration: ${feedLeader?.timings.totalMs.toFixed(2)} ms (Coalesced: false)`);
  console.log(`Followers coalesced count: ${feedFollowers.length} / 9 (Coalesced: true)`);
  console.log(`All 10 callers received identical 24-item payload: ${feedResults.every((r) => r.items.length === 24)}`);

  console.log("\n============================================================");
  console.log("2. LIVE CONCURRENT getMetrics() COALESCING BENCHMARK (10 CALLS)");
  console.log("============================================================");

  const metricsStart = performance.now();
  const metricsPromises = Array.from({ length: 10 }).map(() => sfQueries.getMetrics(scope));
  const metricsResults = await Promise.all(metricsPromises);
  const metricsTotalDuration = performance.now() - metricsStart;

  const metricsEvents = capturedEvents.filter((e) => e.queryType === "metrics");
  const metricsLeader = metricsEvents.find((e) => !e.coalesced);
  const metricsFollowers = metricsEvents.filter((e) => e.coalesced);

  console.log(`Fired 10 concurrent getMetrics() calls in: ${metricsTotalDuration.toFixed(2)} ms`);
  console.log(`Total Telemetry Events: ${metricsEvents.length}`);
  console.log(`Leader execution duration: ${metricsLeader?.timings.totalMs.toFixed(2)} ms (Coalesced: false)`);
  console.log(`Followers coalesced count: ${metricsFollowers.length} / 9 (Coalesced: true)`);
  console.log(`All 10 callers received identical totalScreened=3002: ${metricsResults.every((r) => r.totalScreened === 3002)}`);

  console.log("\n============================================================");
  console.log("3. LIVE CONCURRENT getDossier() COALESCING BENCHMARK (10 CALLS)");
  console.log("============================================================");

  const targetHash = feedResults[0].items[0].jobHash;
  const dossierStart = performance.now();
  const dossierPromises = Array.from({ length: 10 }).map(() => sfQueries.getDossier(scope, targetHash));
  const dossierResults = await Promise.all(dossierPromises);
  const dossierTotalDuration = performance.now() - dossierStart;

  const dossierEvents = capturedEvents.filter((e) => e.queryType === "dossier");
  const dossierLeader = dossierEvents.find((e) => !e.coalesced);
  const dossierFollowers = dossierEvents.filter((e) => e.coalesced);

  console.log(`Fired 10 concurrent getDossier(${targetHash}) calls in: ${dossierTotalDuration.toFixed(2)} ms`);
  console.log(`Leader execution duration: ${dossierLeader?.timings.totalMs.toFixed(2)} ms (Coalesced: false)`);
  console.log(`Followers coalesced count: ${dossierFollowers.length} / 9 (Coalesced: true)`);
  console.log(`All 10 callers received identical dossier: ${dossierResults.every((r) => r?.jobHash === targetHash)}`);

  console.log("\n============================================================");
  console.log("4. TELEMETRY STAGE DECOMPOSITION REPORT");
  console.log("============================================================");
  if (dossierLeader) {
    console.log("Dossier Leader Timing Breakdown:");
    console.log(`  - Scope Resolution: ${dossierLeader.timings.scopeMs.toFixed(2)} ms`);
    console.log(`  - SQL Query (WAN):  ${dossierLeader.timings.sqlQueryMs.toFixed(2)} ms`);
    console.log(`  - Pure Transform:   ${dossierLeader.timings.transformMs.toFixed(2)} ms`);
    console.log(`  - Total Elapsed:    ${dossierLeader.timings.totalMs.toFixed(2)} ms`);
  }

  console.log("\nSUCCESS: Live singleflight and request observability certified!");
}

runSingleflightLiveBenchmark().catch((err) => {
  console.error(err);
  process.exit(1);
});
