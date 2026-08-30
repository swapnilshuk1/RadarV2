import { getDatabaseAdapter } from "../src/data/database/index";
import { resolveScope } from "../src/lib/intelligence/opportunity-service";
import { SqliteCanonicalServingStore } from "../src/data/sqlite/repositories/SqliteCanonicalServingStore";

async function testScopeResolution() {
  const db = getDatabaseAdapter();
  const store = new SqliteCanonicalServingStore(db);

  const users = [
    "ms6i7e3y-4x0chy5fy", // canonical user
    "swapnil-shukla",     // legacy user
    "guest-user",          // multi-tenant user
    "non-existent-user",   // invalid
  ];

  console.log("=== CURRENT SEQUENTIAL RESOLUTION ===");
  for (const u of users) {
    try {
      const scope = await resolveScope(u);
      const ctx = await store.getActiveContext(scope);
      console.log(`User ${u}:`, {
        tenantId: scope.tenantId,
        personId: scope.personId,
        searchPlanId: ctx?.searchPlanId,
        contextFingerprint: ctx?.contextFingerprint
      });
    } catch (err: any) {
      console.log(`User ${u} ERROR:`, err.message);
    }
  }

  // Also test with requestedTenantId for guest-user (who has multiple memberships: tenant_default, tenant_guest-user)
  console.log("\n=== MULTI-TENANT TEST FOR guest-user ===");
  try {
    const scopeDefault = await resolveScope("guest-user", "tenant_default");
    const ctxDefault = await store.getActiveContext(scopeDefault);
    console.log("guest-user with tenant_default:", { scope: scopeDefault, ctx: ctxDefault });
  } catch (e: any) {
    console.log("guest-user tenant_default ERROR:", e.message);
  }

  try {
    const scopeGuest = await resolveScope("guest-user", "tenant_guest-user");
    const ctxGuest = await store.getActiveContext(scopeGuest);
    console.log("guest-user with tenant_guest-user:", { scope: scopeGuest, ctx: ctxGuest });
  } catch (e: any) {
    console.log("guest-user tenant_guest-user ERROR:", e.message);
  }
}

testScopeResolution().catch(console.error);
