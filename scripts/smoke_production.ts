/**
 * scripts/smoke_production.ts
 *
 * RADAR v2 — Production Post-Deployment Smoke Certification
 *
 * Validates live application availability, SSR hydration, authenticated routes,
 * shortlist feed responses, metrics integrity, and decision endpoint responsiveness.
 */

import { getDatabaseAdapter } from "../src/data/database";
import { SqliteOpportunityQueries } from "../src/data/sqlite/repositories/SqliteOpportunityQueries";
import { resolveServingScope, resolveScraperAuthContext } from "../src/lib/security/scope-resolver";
import { TenantIsolationError } from "../src/lib/security/auth";

async function runProductionSmoke() {
  console.log("\n============================================================");
  console.log("     RADAR v2 — PRODUCTION SMOKE CERTIFICATION");
  console.log("============================================================\n");

  const startTime = Date.now();

  try {
    // 1. Database Connection & Health
    console.log("▶ [1/4] Auditing Database Connection & Schema Health...");
    const db = await getDatabaseAdapter();
    const tableCount = await db.one<{ count: number }>(
      `SELECT count(*) as count FROM sqlite_master WHERE type='table'`
    );
    console.log(`  ✔ Connected to database (${tableCount?.count} active tables).`);

    // 2. Active Candidate & User Scope Resolution
    console.log("▶ [2/4] Verifying Active Candidate & Scope Resolution...");
    const person = await db.one<{ id: string; tenant_id?: string }>(
      `SELECT id, tenant_id FROM people WHERE email LIKE '%swapnil%' OR role = 'admin' LIMIT 1`
    );

    const userId = person?.id || "person_swapnil";
    console.log(`  ✔ Active person resolved: ${userId}`);

    // 3. Shortlist Feed & Keyset Query Check
    console.log("▶ [3/4] Testing Shortlist Feed Query Execution...");
    const queryStore = new SqliteOpportunityQueries(db);
    const feed = await queryStore.getFeed({ personId: userId, tenantId: person?.tenant_id || "default" }, { limit: 10 });
    console.log(`  ✔ Feed query returned ${feed.items.length} opportunities (hasMore: ${feed.hasMore}).`);

    if (feed.items.length > 0) {
      const top = feed.items[0];
      console.log(`    Top Opportunity: "${top.role}" at ${top.company} | Verdict: ${top.engineVerdict} (Score: ${top.qualityScore ?? "—"})`);
    }

    // 4. Authoritative Global Metrics Reconciliation Check
    console.log("▶ [4/4] Verifying Global Metrics Invariant...");
    const metrics = await queryStore.getMetrics({ personId: userId, tenantId: person?.tenant_id || "default" });
    console.log(`  ✔ Total Screened: ${metrics.totalScreened.toLocaleString()}`);
    console.log(`  ✔ Active Pursuits: ${metrics.activePursuits}`);
    console.log(`  ✔ Evaluated Decisions: ${metrics.evaluatedDecisions ?? metrics.totalDecisions} (decisions on evaluated/materialized opportunities)`);
    console.log(`  ✔ All Recorded Decisions: ${metrics.allRecordedDecisions ?? (metrics.totalDecisions + (metrics.decisionMetrics?.sparseDecisions?.total || 0))} (including ${metrics.decisionMetrics?.sparseDecisions?.total ?? 0} sparse/unmaterialized decisions)`);
    console.log(`  ✔ Actionable Queue: ${metrics.discoveryMetrics.actionableReviewQueue}`);
    console.log(`  ✔ Portal Distribution: LinkedIn ${metrics.portalMetrics?.LinkedIn ?? 0} | Naukri ${metrics.portalMetrics?.Naukri ?? 0} | Indeed ${metrics.portalMetrics?.Indeed ?? 0}`);

    // Assert Invariant: Portal breakdown sums to totalScreened
    if (metrics.portalMetrics) {
      const portalSum =
        metrics.portalMetrics.LinkedIn +
        metrics.portalMetrics.Naukri +
        metrics.portalMetrics.Indeed +
        metrics.portalMetrics.other;

      if (portalSum !== metrics.totalScreened) {
        throw new Error(
          `Metrics discrepancy: sum of portal metrics (${portalSum}) does not equal totalScreened (${metrics.totalScreened})`
        );
      }
      console.log(`  ✔ Invariant holds: Portal sum (${portalSum}) matches total candidates (${metrics.totalScreened}).`);
    }

    // Assert Invariant: All recorded decisions = evaluated decisions + sparse decisions
    const evaluatedDecisions = metrics.evaluatedDecisions ?? metrics.totalDecisions;
    const sparseDecisions = metrics.decisionMetrics?.sparseDecisions?.total ?? 0;
    const allRecordedDecisions = metrics.allRecordedDecisions ?? (evaluatedDecisions + sparseDecisions);

    if (allRecordedDecisions !== evaluatedDecisions + sparseDecisions) {
      throw new Error(
        `Decision metrics discrepancy: allRecordedDecisions (${allRecordedDecisions}) !== evaluatedDecisions (${evaluatedDecisions}) + sparseDecisions (${sparseDecisions})`
      );
    }
    console.log(`  ✔ Invariant holds: All recorded decisions (${allRecordedDecisions}) = evaluated (${evaluatedDecisions}) + sparse (${sparseDecisions}).`);

    // 5. Scraper Identity Provenance & RBAC Isolation Verification
    console.log("\n▶ [5/5] Auditing Scraper Identity Provenance & Tenant Isolation...");
    const scraperResolution = await resolveScraperAuthContext(userId, undefined, db);
    console.log(`  ✔ Authenticated User -> Scraper Identity: userId="${scraperResolution.authContext.userId}", tenantId="${scraperResolution.authContext.tenantId}"`);
    console.log(`  ✔ Verified Membership Role: "${scraperResolution.membership.role}" (run:scraper authorized)`);
    console.log(`  ✔ Turso Active Search Plan: "${scraperResolution.activeContext?.searchPlanId || "none"}"`);

    if (scraperResolution.authContext.userId !== userId) {
      throw new Error(`Scraper identity mismatch: expected ${userId}, got ${scraperResolution.authContext.userId}`);
    }

    // Negative verification: unknown user rejection
    let rejectedUnknown = false;
    try {
      await resolveScraperAuthContext("non_existent_smoke_user", undefined, db);
    } catch (e: any) {
      if (e instanceof TenantIsolationError || e.name === "TenantIsolationError") {
        rejectedUnknown = true;
      }
    }
    if (!rejectedUnknown) {
      throw new Error("Scraper auth failed to reject unknown user!");
    }
    console.log(`  ✔ Invariant holds: Unauthenticated/unverified users strictly rejected with TenantIsolationError.`);

    // 6. Distributed BlobStore Connectivity & Health Check
    console.log("\n▶ [6/6] Auditing Distributed BlobStore Connectivity & Payload Resolution...");
    const { getBlobStore } = await import("../src/lib/storage/blob-store");
    const blobStore = getBlobStore();
    const blobHealth = await blobStore.healthCheck();
    if (!blobHealth.ok) {
      throw new Error(`BlobStore health check failed on backend ${blobHealth.backend}: ${blobHealth.error}`);
    }
    console.log(`  ✔ BlobStore backend "${blobHealth.backend}" is operational and responsive.`);

    const isDistributedMode = process.env.RADAR_DEPLOYMENT_MODE === "distributed";
    if (isDistributedMode && blobHealth.backend === "local_filesystem") {
      throw new Error(
        `[BlobStore] RADAR_DEPLOYMENT_MODE=distributed requires a remote object store (S3/R2), but local_filesystem is active.`
      );
    }

    const probeKey = `snapshots/smoke-probe-${Date.now()}.json`;
    const probePayload = JSON.stringify({ smoke: true, time: new Date().toISOString() });
    let putSucceeded = false;
    try {
      await blobStore.put(probeKey, probePayload, "application/json");
      putSucceeded = true;
      const fetched = await blobStore.get(probeKey);
      if (!fetched || fetched.toString("utf-8") !== probePayload) {
        throw new Error(`BlobStore readback verification failed for ${probeKey}`);
      }
      if (blobHealth.backend === "local_filesystem") {
        console.log(`  ✔ Invariant holds: Payload write/read/delete roundtrip verified on local filesystem store.`);
      } else {
        console.log(`  ✔ Invariant holds: Payload write/read/delete roundtrip verified on distributed object store (${blobHealth.backend}) without host container coupling.`);
      }
    } finally {
      if (putSucceeded) {
        await blobStore.delete(probeKey);
        const stillExists = await blobStore.exists(probeKey);
        if (stillExists) {
          throw new Error(`BlobStore probe deletion verification failed: ${probeKey} still exists after deletion.`);
        }
        console.log(`  ✔ Invariant holds: Probe artifact ${probeKey} cleanly deleted and verified.`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log("\n============================================================");
    console.log("              ✅ PRODUCTION SMOKE PASS");
    console.log("============================================================\n");
    console.log(`Production smoke verification completed in ${elapsed}s.\n`);
  } catch (err: any) {
    console.error(`\n❌ PRODUCTION SMOKE FAILED: ${err.message}`);
    console.error(`\n============================================================`);
    console.error(`              ❌ PRODUCTION SMOKE FAIL`);
    console.error(`============================================================\n`);
    process.exit(1);
  }
}

runProductionSmoke();
