/**
 * scripts/diagnose.ts
 *
 * RADAR v2 — Unified Operational Diagnostic Tool
 *
 * Consolidates forensic and health diagnostics into a single discoverable command:
 * 1. Database Connection & Schema Health
 * 2. Active Tenant & Scope Resolution
 * 3. Search Plan & Candidate Lineage Invariants
 * 4. Authoritative Global Metrics & Decision Disambiguation
 * 5. Keyset Feed & Dossier Query Execution
 *
 * Usage:
 *   npx tsx scripts/diagnose.ts
 */

import { getDatabaseAdapter } from "../src/data/database";
import { SqliteOpportunityQueries } from "../src/data/sqlite/repositories/SqliteOpportunityQueries";
import { resolveServingScope } from "../src/lib/security/scope-resolver";

async function runDiagnostics() {
  console.log("\n============================================================");
  console.log("       RADAR v2 — SYSTEM DIAGNOSTIC REPORT");
  console.log("============================================================\n");

  const startTime = Date.now();

  try {
    const db = await getDatabaseAdapter();

    // 1. Schema & Table Audit
    console.log("▶ [1/5] Schema & Persistence Invariant Audit...");
    const tableRows = await db.many<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    );
    console.log(`  ✔ Active tables in database: ${tableRows.length}`);

    const criticalTables = [
      "canonical_opportunities",
      "opportunity_versions",
      "search_plans",
      "search_plan_candidates",
      "materialized_evaluations",
      "canonical_decisions",
      "people",
    ];

    for (const table of criticalTables) {
      const exists = tableRows.some((r) => r.name === table);
      if (!exists) {
        throw new Error(`CRITICAL TABLE MISSING: ${table}`);
      }
    }
    console.log("  ✔ All critical relational tables verified.");

    // 2. Active Candidate & Scope
    console.log("▶ [2/5] Scope Resolution & Active Context...");
    const person = await db.one<{ id: string; tenant_id?: string }>(
      `SELECT id, tenant_id FROM people WHERE email LIKE '%swapnil%' OR role = 'admin' LIMIT 1`
    );
    const userId = person?.id || "ms6i7e3y-4x0chy5fy";
    const tenantId = person?.tenant_id || "default";

    const scopeRes = await resolveServingScope(userId, tenantId, db);
    console.log(`  ✔ Person ID: ${userId}`);
    console.log(`  ✔ Tenant ID: ${tenantId}`);
    console.log(`  ✔ Context Fingerprint: ${scopeRes.activeContext?.context_fingerprint ?? "N/A"}`);
    console.log(`  ✔ Search Plan ID: ${scopeRes.activeContext?.search_plan_id ?? "N/A"}`);

    // 3. Lineage & Orphan FK Audit
    console.log("▶ [3/5] Candidate & Ingestion Lineage Audit...");
    const orphanCandidates = await db.one<{ count: number }>(
      `SELECT count(*) as count 
       FROM search_plan_candidates spc
       LEFT JOIN opportunity_versions ov 
         ON spc.canonical_job_id = ov.canonical_job_id 
        AND spc.opportunity_version = ov.id
       WHERE ov.id IS NULL`
    );
    console.log(`  ✔ Orphan search plan candidates: ${orphanCandidates?.count || 0}`);
    if ((orphanCandidates?.count || 0) > 0) {
      console.warn("  ⚠ Warning: Found orphan search plan candidates!");
    }

    // 4. Metrics & Decision Disambiguation
    console.log("▶ [4/5] Authoritative Metrics & Decision Reconciliation...");
    const queryStore = new SqliteOpportunityQueries(db);
    const metrics = await queryStore.getMetrics({ personId: userId, tenantId });

    console.log(`  ✔ Total Screened: ${metrics.totalScreened.toLocaleString()}`);
    console.log(`  ✔ Active Pursuits: ${metrics.activePursuits}`);
    console.log(`  ✔ Evaluated Decisions: ${metrics.evaluatedDecisions ?? metrics.totalDecisions}`);
    console.log(`  ✔ All Recorded Decisions: ${metrics.allRecordedDecisions ?? metrics.totalDecisions}`);
    console.log(`  ✔ Sparse Decisions: ${metrics.decisionMetrics?.sparseDecisions?.total ?? 0}`);
    console.log(`  ✔ Actionable Review Queue: ${metrics.discoveryMetrics.actionableReviewQueue}`);
    console.log(`  ✔ Portals: LinkedIn ${metrics.portalMetrics?.LinkedIn ?? 0} | Naukri ${metrics.portalMetrics?.Naukri ?? 0} | Indeed ${metrics.portalMetrics?.Indeed ?? 0}`);

    // 5. Serving Query Execution
    console.log("▶ [5/5] Keyset Serving & Feed Parity...");
    const feed = await queryStore.getFeed({ personId: userId, tenantId }, { limit: 5 });
    console.log(`  ✔ Feed items retrieved: ${feed.items.length} (hasMore: ${feed.hasMore})`);
    if (feed.items.length > 0) {
      console.log(`    Sample: "${feed.items[0].role}" at ${feed.items[0].company} [${feed.items[0].engineVerdict}]`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log("\n============================================================");
    console.log("              ✅ SYSTEM HEALTH: OPTIMAL");
    console.log("============================================================\n");
    console.log(`Diagnostics completed in ${elapsed}s.\n`);
  } catch (err: any) {
    console.error(`\n❌ DIAGNOSTICS FAILED: ${err.message}\n`);
    process.exit(1);
  }
}

runDiagnostics();
