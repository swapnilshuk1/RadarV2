/**
 * scripts/benchmarks/verify_phase7_metrics_parity.ts
 *
 * RADAR v2 — Phase 7 SQL Metrics Aggregation Parity Benchmark.
 *
 * Compares every single metric field between:
 * 1. Legacy SqliteCanonicalServingStore.getOpportunityMetrics(scope) (Hydrates 3,002 opportunities)
 * 2. New SqliteOpportunityQueries.getMetrics(scope) (Zero evaluation_json, Zero raw_content)
 */

import { getDatabaseAdapter } from "../../src/data/database/index";
import { SqliteCanonicalServingStore } from "../../src/data/sqlite/repositories/SqliteCanonicalServingStore";
import { SqliteOpportunityQueries } from "../../src/data/sqlite/repositories/SqliteOpportunityQueries";
import { resolveServingScope } from "../../src/lib/security/scope-resolver";

async function runPhase7ParityCheck() {
  const db = getDatabaseAdapter();
  const legacyStore = new SqliteCanonicalServingStore(db);
  const newQueries = new SqliteOpportunityQueries(db);

  const userId = "ms6i7e3y-4x0chy5fy";
  const tenantId = "tenant_default";

  console.log("Resolving serving scope...");
  const { scope, activeContext } = await resolveServingScope(userId, tenantId, db);
  if (!activeContext) {
    throw new Error("Active context resolution failed.");
  }
  console.log(`Resolved Scope: ${scope.tenantId} / ${scope.personId}, Context: ${activeContext.contextFingerprint}`);

  console.log("\n1. Running Legacy Metrics (Full Corpus Hydration)...");
  const legacyStart = performance.now();
  const legacyMetrics = await legacyStore.getOpportunityMetrics(scope);
  const legacyDuration = performance.now() - legacyStart;
  console.log(`Legacy Metrics completed in ${legacyDuration.toFixed(2)} ms`);

  console.log("\n2. Running New SQL Metrics Aggregation...");
  const newStart = performance.now();
  const newMetrics = await newQueries.getMetrics(scope);
  const newDuration = performance.now() - newStart;
  console.log(`New SQL Metrics completed in ${newDuration.toFixed(2)} ms`);

  // Compare every field
  console.log("\n============================================================");
  console.log("PHASE 7 METRICS EXACT FIELD-BY-FIELD COMPARISON");
  console.log("============================================================");

  const comparisons: Array<{ field: string; legacy: any; newSql: any; match: boolean }> = [
    { field: "totalScreened", legacy: legacyMetrics.totalScreened, newSql: newMetrics.totalScreened, match: legacyMetrics.totalScreened === newMetrics.totalScreened },
    { field: "activePursuits", legacy: legacyMetrics.activePursuits, newSql: newMetrics.activePursuits, match: legacyMetrics.activePursuits === newMetrics.activePursuits },
    { field: "totalShortlisted", legacy: legacyMetrics.totalShortlisted, newSql: newMetrics.totalShortlisted, match: legacyMetrics.totalShortlisted === newMetrics.totalShortlisted },
    { field: "totalDecisions", legacy: legacyMetrics.totalDecisions, newSql: newMetrics.totalDecisions, match: legacyMetrics.totalDecisions === newMetrics.totalDecisions },
    { field: "remainingToReview", legacy: legacyMetrics.remainingToReview, newSql: newMetrics.remainingToReview, match: legacyMetrics.remainingToReview === newMetrics.remainingToReview },

    // Engine Breakdown
    { field: "engineBreakdown.pursue", legacy: legacyMetrics.engineBreakdown.pursue, newSql: newMetrics.engineBreakdown.pursue, match: legacyMetrics.engineBreakdown.pursue === newMetrics.engineBreakdown.pursue },
    { field: "engineBreakdown.consider", legacy: legacyMetrics.engineBreakdown.consider, newSql: newMetrics.engineBreakdown.consider, match: legacyMetrics.engineBreakdown.consider === newMetrics.engineBreakdown.consider },
    { field: "engineBreakdown.pass", legacy: legacyMetrics.engineBreakdown.pass, newSql: newMetrics.engineBreakdown.pass, match: legacyMetrics.engineBreakdown.pass === newMetrics.engineBreakdown.pass },
    { field: "engineBreakdown.sparse", legacy: legacyMetrics.engineBreakdown.sparse, newSql: newMetrics.engineBreakdown.sparse, match: legacyMetrics.engineBreakdown.sparse === newMetrics.engineBreakdown.sparse },

    // User Breakdown
    { field: "userBreakdown.pursue", legacy: legacyMetrics.userBreakdown.pursue, newSql: newMetrics.userBreakdown.pursue, match: legacyMetrics.userBreakdown.pursue === newMetrics.userBreakdown.pursue },
    { field: "userBreakdown.consider", legacy: legacyMetrics.userBreakdown.consider, newSql: newMetrics.userBreakdown.consider, match: legacyMetrics.userBreakdown.consider === newMetrics.userBreakdown.consider },
    { field: "userBreakdown.pass", legacy: legacyMetrics.userBreakdown.pass, newSql: newMetrics.userBreakdown.pass, match: legacyMetrics.userBreakdown.pass === newMetrics.userBreakdown.pass },
    { field: "userBreakdown.total", legacy: legacyMetrics.userBreakdown.total, newSql: newMetrics.userBreakdown.total, match: legacyMetrics.userBreakdown.total === newMetrics.userBreakdown.total },

    // Effective Breakdown
    { field: "effectiveBreakdown.pursue", legacy: legacyMetrics.effectiveBreakdown.pursue, newSql: newMetrics.effectiveBreakdown.pursue, match: legacyMetrics.effectiveBreakdown.pursue === newMetrics.effectiveBreakdown.pursue },
    { field: "effectiveBreakdown.consider", legacy: legacyMetrics.effectiveBreakdown.consider, newSql: newMetrics.effectiveBreakdown.consider, match: legacyMetrics.effectiveBreakdown.consider === newMetrics.effectiveBreakdown.consider },
    { field: "effectiveBreakdown.pass", legacy: legacyMetrics.effectiveBreakdown.pass, newSql: newMetrics.effectiveBreakdown.pass, match: legacyMetrics.effectiveBreakdown.pass === newMetrics.effectiveBreakdown.pass },
    { field: "effectiveBreakdown.sparse", legacy: legacyMetrics.effectiveBreakdown.sparse, newSql: newMetrics.effectiveBreakdown.sparse, match: legacyMetrics.effectiveBreakdown.sparse === newMetrics.effectiveBreakdown.sparse },

    // Discovery Metrics
    { field: "discoveryMetrics.engineQualified", legacy: legacyMetrics.discoveryMetrics?.engineQualified, newSql: newMetrics.discoveryMetrics?.engineQualified, match: legacyMetrics.discoveryMetrics?.engineQualified === newMetrics.discoveryMetrics?.engineQualified },
    { field: "discoveryMetrics.actionableReviewQueue", legacy: legacyMetrics.discoveryMetrics?.actionableReviewQueue, newSql: newMetrics.discoveryMetrics?.actionableReviewQueue, match: legacyMetrics.discoveryMetrics?.actionableReviewQueue === newMetrics.discoveryMetrics?.actionableReviewQueue },
    { field: "discoveryMetrics.unreviewedSparse", legacy: legacyMetrics.discoveryMetrics?.unreviewedSparse, newSql: newMetrics.discoveryMetrics?.unreviewedSparse, match: legacyMetrics.discoveryMetrics?.unreviewedSparse === newMetrics.discoveryMetrics?.unreviewedSparse },

    // Decision Metrics
    { field: "decisionMetrics.totalDecided", legacy: legacyMetrics.decisionMetrics?.totalDecided, newSql: newMetrics.decisionMetrics?.totalDecided, match: legacyMetrics.decisionMetrics?.totalDecided === newMetrics.decisionMetrics?.totalDecided },
    { field: "decisionMetrics.userConfirmed", legacy: legacyMetrics.decisionMetrics?.userConfirmed, newSql: newMetrics.decisionMetrics?.userConfirmed, match: legacyMetrics.decisionMetrics?.userConfirmed === newMetrics.decisionMetrics?.userConfirmed },
    { field: "decisionMetrics.preferenceOverride", legacy: legacyMetrics.decisionMetrics?.preferenceOverride, newSql: newMetrics.decisionMetrics?.preferenceOverride, match: legacyMetrics.decisionMetrics?.preferenceOverride === newMetrics.decisionMetrics?.preferenceOverride },
    { field: "decisionMetrics.vetoOverride", legacy: legacyMetrics.decisionMetrics?.vetoOverride, newSql: newMetrics.decisionMetrics?.vetoOverride, match: legacyMetrics.decisionMetrics?.vetoOverride === newMetrics.decisionMetrics?.vetoOverride },
    { field: "decisionMetrics.userPassed", legacy: legacyMetrics.decisionMetrics?.userPassed, newSql: newMetrics.decisionMetrics?.userPassed, match: legacyMetrics.decisionMetrics?.userPassed === newMetrics.decisionMetrics?.userPassed },
    { field: "decisionMetrics.userPursueTotal", legacy: legacyMetrics.decisionMetrics?.userPursueTotal, newSql: newMetrics.decisionMetrics?.userPursueTotal, match: legacyMetrics.decisionMetrics?.userPursueTotal === newMetrics.decisionMetrics?.userPursueTotal },
    { field: "decisionMetrics.userConsiderTotal", legacy: legacyMetrics.decisionMetrics?.userConsiderTotal, newSql: newMetrics.decisionMetrics?.userConsiderTotal, match: legacyMetrics.decisionMetrics?.userConsiderTotal === newMetrics.decisionMetrics?.userConsiderTotal },
    { field: "decisionMetrics.userPassTotal", legacy: legacyMetrics.decisionMetrics?.userPassTotal, newSql: newMetrics.decisionMetrics?.userPassTotal, match: legacyMetrics.decisionMetrics?.userPassTotal === newMetrics.decisionMetrics?.userPassTotal },
  ];

  let mismatches = 0;
  for (const c of comparisons) {
    const status = c.match ? "✅ MATCH" : "❌ MISMATCH";
    if (!c.match) mismatches++;
    console.log(`  - ${c.field.padEnd(38)} : Legacy=${String(c.legacy).padEnd(6)} | New=${String(c.newSql).padEnd(6)} [${status}]`);
  }

  // Category Metrics Comparison
  console.log("\nCategory Metrics Breakdown:");
  const legCats = legacyMetrics.categoryMetrics || {};
  const newCats = newMetrics.categoryMetrics || {};
  const allCatKeys = Array.from(new Set([...Object.keys(legCats), ...Object.keys(newCats)]));

  for (const cat of allCatKeys) {
    const legC = legCats[cat] || { total: 0, unreviewed: 0, shortlisted: 0 };
    const newC = newCats[cat] || { total: 0, unreviewed: 0, shortlisted: 0 };
    const catMatch =
      legC.total === newC.total &&
      legC.unreviewed === newC.unreviewed &&
      legC.shortlisted === newC.shortlisted;
    if (!catMatch) mismatches++;
    const status = catMatch ? "✅ MATCH" : "❌ MISMATCH";
    console.log(`  - Category [${cat.padEnd(20)}]: Legacy={T:${legC.total}, U:${legC.unreviewed}, S:${legC.shortlisted}} | New={T:${newC.total}, U:${newC.unreviewed}, S:${newC.shortlisted}} [${status}]`);
  }

  const payloadBytes = Buffer.byteLength(JSON.stringify(newMetrics), "utf-8");
  console.log("------------------------------------------------------------");
  console.log(`Metrics DTO Response Size:    ${(payloadBytes / 1024).toFixed(2)} KB`);
  console.log(`Legacy Execution Time:        ${legacyDuration.toFixed(2)} ms`);
  console.log(`New SQL Execution Time:       ${newDuration.toFixed(2)} ms (${((1 - newDuration / legacyDuration) * 100).toFixed(1)}% faster)`);
  console.log(`Total Mismatches Detected:    ${mismatches}`);
  console.log("============================================================\n");

  if (mismatches > 0) {
    throw new Error(`Phase 7 Certification Failed: ${mismatches} mismatches detected.`);
  }

  console.log("SUCCESS: Phase 7 SQL Metrics Aggregation has 100.00% exact parity with legacy oracle!");
}

runPhase7ParityCheck().catch((err) => {
  console.error(err);
  process.exit(1);
});
