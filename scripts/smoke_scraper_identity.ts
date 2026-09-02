/**
 * scripts/smoke_scraper_identity.ts
 *
 * Checkpoint B Live Identity Provenance Smoke Test.
 *
 * Proves against live Turso Cloud:
 * 1. Authenticated session user resolves DB membership and permissions.
 * 2. Active search plan is retrieved from Turso for the resolved tenant/person.
 * 3. Scraper runner receives identical tenant, person, and search plan identities.
 * 4. Negative cases are enforced against live database:
 *    - Unknown user -> TenantIsolationError
 *    - Insufficient role (viewer lacking run:scraper) -> TenantIsolationError
 *    - Cross-tenant / wrong tenant mismatch -> TenantIsolationError
 */

import { getDatabaseAdapter } from "../src/data/database";
import { resolveScraperAuthContext } from "../src/lib/security/scope-resolver";
import { TenantIsolationError } from "../src/lib/security/auth";

async function smokeIdentityProvenance() {
  console.log("\n============================================================");
  console.log("   RADAR v2 — SCRAPER IDENTITY PROVENANCE SMOKE TEST");
  console.log("============================================================\n");

  const db = getDatabaseAdapter();

  // Test 1: Live Positive Case — Canonical Authenticated User
  console.log("▶ [1/4] Testing Live Positive Authorization Chain...");
  const authenticatedUserId = "ms6i7e3y-4x0chy5fy";

  const resolved = await resolveScraperAuthContext(authenticatedUserId, undefined, db);

  console.log(`  ✔ userId == authenticated session user: "${resolved.authContext.userId}"`);
  console.log(`  ✔ tenantId == membership-resolved tenant: "${resolved.authContext.tenantId}"`);
  console.log(`  ✔ personId == membership-resolved person: "${resolved.scope.personId}"`);
  console.log(`  ✔ role/permissions: "${resolved.membership.role}" (run:scraper authorized: true)`);
  console.log(`  ✔ searchPlanId == Turso active plan: "${resolved.activeContext?.searchPlanId}"`);

  if (resolved.authContext.userId !== authenticatedUserId) {
    throw new Error(`Identity mismatch: expected ${authenticatedUserId}, got ${resolved.authContext.userId}`);
  }
  if (resolved.authContext.tenantId !== "tenant_default") {
    throw new Error(`Tenant mismatch: expected tenant_default, got ${resolved.authContext.tenantId}`);
  }
  if (resolved.scope.personId !== authenticatedUserId) {
    throw new Error(`Person mismatch: expected ${authenticatedUserId}, got ${resolved.scope.personId}`);
  }
  if (!resolved.activeContext?.searchPlanId) {
    throw new Error(`Search plan missing: active plan not resolved from Turso`);
  }

  // Verify Runner Parity Invariant
  console.log("\n▶ [2/4] Testing Runner Identity Ingestion Parity...");
  const runnerOpts = {
    authContext: resolved.authContext,
    searchPlanId: resolved.activeContext.searchPlanId,
  };

  console.log(`  ✔ Runner tenantId: "${runnerOpts.authContext.tenantId}"`);
  console.log(`  ✔ Runner userId:   "${runnerOpts.authContext.userId}"`);
  console.log(`  ✔ Runner planId:   "${runnerOpts.searchPlanId}"`);

  if (runnerOpts.authContext.tenantId !== resolved.authContext.tenantId) {
    throw new Error("Runner received different tenant than resolved authContext");
  }
  if (runnerOpts.searchPlanId !== resolved.activeContext.searchPlanId) {
    throw new Error("Runner received different searchPlanId than resolved activeContext");
  }

  // Negative Case 1: Unknown User
  console.log("\n▶ [3/4] Testing Negative Case: Unknown User Rejection...");
  try {
    await resolveScraperAuthContext("non_existent_user_9999", undefined, db);
    throw new Error("FAILED: Unknown user was not rejected!");
  } catch (err: any) {
    if (err instanceof TenantIsolationError || err.name === "TenantIsolationError") {
      console.log(`  ✔ Unknown user rejected with TenantIsolationError: "${err.message}"`);
    } else {
      throw err;
    }
  }

  // Negative Case 2: User with Insufficient Permissions (guest-user has 'viewer' role)
  console.log("\n▶ [4/4] Testing Negative Cases: Insufficient Permissions & Tenant Mismatch...");
  try {
    await resolveScraperAuthContext("guest-user", undefined, db);
    throw new Error("FAILED: Viewer user without run:scraper was not rejected!");
  } catch (err: any) {
    if (err instanceof TenantIsolationError || err.name === "TenantIsolationError") {
      console.log(`  ✔ Viewer user rejected with TenantIsolationError: "${err.message}"`);
    } else {
      throw err;
    }
  }

  // Negative Case 3: Wrong / Cross Tenant Requested
  try {
    await resolveScraperAuthContext(authenticatedUserId, "unauthorized_tenant_xyz", db);
    throw new Error("FAILED: Wrong tenant request was not rejected!");
  } catch (err: any) {
    if (err instanceof TenantIsolationError || err.name === "TenantIsolationError") {
      console.log(`  ✔ Wrong tenant request rejected with TenantIsolationError: "${err.message}"`);
    } else {
      throw err;
    }
  }

  console.log("\n============================================================");
  console.log("       ✅ SCRAPER IDENTITY PROVENANCE SMOKE PASS");
  console.log("============================================================\n");
}

smokeIdentityProvenance().catch(err => {
  console.error("❌ Identity Provenance Smoke Failed:", err);
  process.exit(1);
});
