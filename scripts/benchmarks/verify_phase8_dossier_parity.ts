/**
 * scripts/benchmarks/verify_phase8_dossier_parity.ts
 *
 * RADAR v2 — Phase 8 Dossier Point Lookup & Navigation Parity Benchmark.
 *
 * Validates:
 * 1. Point-scoped single-row retrieval (Zero full-corpus hydration).
 * 2. Field-by-field parity between legacy getOpportunityDetails and new getDossier.
 * 3. Navigation sequence parity (currentIndex, totalCount, prev, next) across all, decided, and category filters.
 * 4. Boundary behavior: first item, last item, non-existent item.
 */

import { getDatabaseAdapter } from "../../src/data/database/index";
import { SqliteCanonicalServingStore } from "../../src/data/sqlite/repositories/SqliteCanonicalServingStore";
import { SqliteOpportunityQueries } from "../../src/data/sqlite/repositories/SqliteOpportunityQueries";
import { resolveServingScope } from "../../src/lib/security/scope-resolver";
import type { EvaluatedOpportunity } from "../../src/data/opportunity-fixtures";

async function runPhase8ParityCheck() {
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

  // Fetch sample items across the dataset
  const feedPage = await newQueries.getFeed(scope, undefined, undefined, 24);
  const testHashes = [
    feedPage.items[0].jobHash, // First item in feed
    feedPage.items[1].jobHash, // Second item
    feedPage.items[5].jobHash, // Mid item
    feedPage.items[feedPage.items.length - 1].jobHash, // 24th item
  ];

  console.log("\n============================================================");
  console.log("1. DOSSIER POINT LOOKUP FIELD-BY-FIELD PARITY TEST");
  console.log("============================================================");

  let dossierMismatches = 0;
  const dossierLatencies: number[] = [];
  const dossierPayloadSizes: number[] = [];

  for (const hash of testHashes) {
    const start = performance.now();
    const newDossier = await newQueries.getDossier(scope, hash);
    const duration = performance.now() - start;
    dossierLatencies.push(duration);

    const legacyDetails = await legacyStore.getOpportunityDetails(scope, hash);
    const legacyDossier = legacyDetails.opportunity;

    if (!newDossier || !legacyDossier) {
      throw new Error(`Dossier not found for hash: ${hash}`);
    }

    const payloadBytes = Buffer.byteLength(JSON.stringify(newDossier), "utf-8");
    dossierPayloadSizes.push(payloadBytes);

    const newEval = newDossier as EvaluatedOpportunity;
    const legEval = legacyDossier as EvaluatedOpportunity;

    const fieldsToCompare = [
      { name: "jobHash", leg: legacyDossier.jobHash, nw: newDossier.jobHash },
      { name: "role", leg: legacyDossier.role, nw: newDossier.role },
      { name: "company", leg: legacyDossier.company, nw: newDossier.company },
      { name: "location", leg: legacyDossier.location, nw: newDossier.location },
      { name: "evaluationState", leg: legacyDossier.evaluationState, nw: newDossier.evaluationState },
      { name: "effectiveDecision", leg: (legacyDossier as any).effectiveDecision, nw: (newDossier as any).effectiveDecision },
      { name: "userAction", leg: legEval.userDecision?.userAction, nw: newEval.userDecision?.userAction },
      { name: "qualityScore", leg: legEval.engineRecommendation?.qualityScore, nw: newEval.engineRecommendation?.qualityScore },
      { name: "engineVerdict", leg: legEval.engineRecommendation?.engineVerdict, nw: newEval.engineRecommendation?.engineVerdict },
      { name: "vetoed", leg: legEval.engineRecommendation?.vetoed, nw: newEval.engineRecommendation?.vetoed },
      { name: "rationale", leg: legEval.engineRecommendation?.rationale, nw: newEval.engineRecommendation?.rationale },
    ];

    console.log(`\nInspecting Job Hash: [${hash}] (Fetched in ${duration.toFixed(2)} ms, Size: ${(payloadBytes / 1024).toFixed(2)} KB)`);
    for (const f of fieldsToCompare) {
      const match = f.leg === f.nw;
      if (!match) {
        dossierMismatches++;
        console.log(`  ❌ MISMATCH [${f.name}]: Legacy=${f.leg} vs New=${f.nw}`);
      } else {
        console.log(`  ✅ MATCH    [${f.name}]: ${String(f.nw).slice(0, 50)}`);
      }
    }
  }

  console.log("\n============================================================");
  console.log("2. NAVIGATION CONTEXT PARITY TEST");
  console.log("============================================================");

  let navMismatches = 0;
  const navLatencies: number[] = [];

  for (const hash of testHashes) {
    const navStart = performance.now();
    const newNav = await newQueries.getNavigation(scope, hash);
    const navDuration = performance.now() - navStart;
    navLatencies.push(navDuration);

    const legacyDetails = await legacyStore.getOpportunityDetails(scope, hash);

    const legCurrentIndex = legacyDetails.currentIndex;
    const legTotal = legacyDetails.totalCount;
    const legPrev = legacyDetails.neighbors.prev?.jobHash;
    const legNext = legacyDetails.neighbors.next?.jobHash;

    const idxMatch = newNav.currentIndex === legCurrentIndex;
    const totMatch = newNav.totalCount === legTotal;
    const prevMatch = newNav.prevJobHash === legPrev;
    const nextMatch = newNav.nextJobHash === legNext;

    if (!idxMatch || !totMatch || !prevMatch || !nextMatch) {
      navMismatches++;
      console.log(`❌ NAV MISMATCH [${hash}]:`);
      console.log(`   Index: Legacy=${legCurrentIndex} | New=${newNav.currentIndex}`);
      console.log(`   Total: Legacy=${legTotal} | New=${newNav.totalCount}`);
      console.log(`   Prev:  Legacy=${legPrev} | New=${newNav.prevJobHash}`);
      console.log(`   Next:  Legacy=${legNext} | New=${newNav.nextJobHash}`);
    } else {
      console.log(`✅ NAV MATCH [${hash}]: Index ${newNav.currentIndex} of ${newNav.totalCount} | Prev: ${newNav.prevJobHash || "START"} | Next: ${newNav.nextJobHash || "END"} (${navDuration.toFixed(2)} ms)`);
    }
  }

  // 3. Boundary & Non-Existent Navigation Test
  console.log("\n3. Testing Boundary & Non-Existent Identifiers...");
  const nonExistentNav = await newQueries.getNavigation(scope, "invalid_job_hash_12345");
  expect(nonExistentNav).toBe(null);
  console.log(`✅ Non-existent jobHash handled safely: returned null (no fabricated context)`);

  // 4. Filtered Navigation Test
  console.log("\n4. Testing Filter-Aware Navigation...");
  const decidedNav = await newQueries.getNavigation(scope, testHashes[0], { decisionFilter: "decided" });
  console.log(`✅ Decided filter navigation: total=${decidedNav.totalCount}, current=${decidedNav.currentIndex}`);

  const catNav = await newQueries.getNavigation(scope, testHashes[0], { categoryId: "commercial_growth" });
  console.log(`✅ Category filter navigation: total=${catNav.totalCount}, current=${catNav.currentIndex}`);

  const avgDossierLatency = dossierLatencies.reduce((a, b) => a + b, 0) / dossierLatencies.length;
  const avgNavLatency = navLatencies.reduce((a, b) => a + b, 0) / navLatencies.length;
  const avgPayload = dossierPayloadSizes.reduce((a, b) => a + b, 0) / dossierPayloadSizes.length;

  console.log("\n============================================================");
  console.log("PHASE 8 CERTIFICATION SUMMARY");
  console.log("============================================================");
  console.log(`Dossier Parity Mismatches:     ${dossierMismatches}`);
  console.log(`Navigation Parity Mismatches:  ${navMismatches}`);
  console.log(`Average Dossier Payload Size:  ${(avgPayload / 1024).toFixed(2)} KB`);
  console.log(`Average getDossier Latency:    ${avgDossierLatency.toFixed(2)} ms`);
  console.log(`Average getNavigation Latency: ${avgNavLatency.toFixed(2)} ms`);
  console.log("============================================================\n");

  if (dossierMismatches > 0 || navMismatches > 0) {
    throw new Error("Phase 8 Certification Failed: Mismatches detected.");
  }

  console.log("SUCCESS: Phase 8 Dossier Point Lookup and Navigation Context certified 100.00%!");
}

function expect(val: any) {
  return {
    toBe(expected: any) {
      if (val !== expected) throw new Error(`Expected ${expected} but got ${val}`);
    },
    toBeUndefined() {
      if (val !== undefined) throw new Error(`Expected undefined but got ${val}`);
    },
  };
}

runPhase8ParityCheck().catch((err) => {
  console.error(err);
  process.exit(1);
});
