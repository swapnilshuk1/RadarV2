import { describe, it, expect } from "vitest";
import { getDatabaseAdapter } from "../../src/data/database";
import {
  authenticateTenantMembership,
  authorizePersonScope,
  TenantIsolationError,
} from "../../src/lib/security/auth";
import { SqliteCanonicalServingStore } from "../../src/data/sqlite/repositories/SqliteCanonicalServingStore";

describe("Milestone M8 — Multi-Tenant Isolation & Adversarial Security", () => {
  const db = getDatabaseAdapter();
  const legitimateTenantId = "tenant_default";
  const legitimateUserId = "ms6i7e3y-4x0chy5fy";
  const adversarialTenantId = "tenant_adversary_corp";
  const foreignPersonId = "person_foreign_target_999";

  it("should successfully authenticate and authorize legitimate tenant and user scope", async () => {
    const authContext = await authenticateTenantMembership(legitimateUserId, legitimateTenantId, db);
    expect(authContext).toBeDefined();
    expect(authContext.userId).toBe(legitimateUserId);
    expect(authContext.tenantId).toBe(legitimateTenantId);

    const scope = await authorizePersonScope(authContext, legitimateUserId, db);
    expect(scope).toBeDefined();
    expect(scope.tenantId).toBe(legitimateTenantId);
    expect(scope.personId).toBe(legitimateUserId);
  });

  it("should reject authentication for a tenant where the user has no membership", async () => {
    await expect(
      authenticateTenantMembership(legitimateUserId, adversarialTenantId, db)
    ).rejects.toThrow(TenantIsolationError);
  });

  it("should reject access when a user in one tenant attempts to access a person in another tenant", async () => {
    const authContext = await authenticateTenantMembership(legitimateUserId, legitimateTenantId, db);

    await expect(
      authorizePersonScope(authContext, foreignPersonId, db)
    ).rejects.toThrow(TenantIsolationError);
  });

  it("should ensure canonical queries strictly isolate opportunities between tenants", async () => {
    const store = new SqliteCanonicalServingStore(db);

    // 1. Legitimate scope returns active opportunities
    const legitimateScope = {
      tenantId: legitimateTenantId,
      personId: legitimateUserId,
    };
    const legitimateOpps = await store.listOpportunities(legitimateScope);
    expect(legitimateOpps.length).toBeGreaterThan(0);

    // 2. Synthetic foreign scope returns 0 opportunities
    const foreignScope = {
      tenantId: adversarialTenantId,
      personId: foreignPersonId,
    };
    const foreignOpps = await store.listOpportunities(foreignScope);
    expect(foreignOpps).toHaveLength(0);

    // 3. Synthetic foreign scope single get returns undefined
    const firstLegitHash = legitimateOpps[0].jobHash;
    const leakAttempt = await store.getOpportunity(foreignScope, firstLegitHash);
    expect(leakAttempt).toBeUndefined();

    // 4. Synthetic foreign scope metrics return 0 screened count
    const foreignMetrics = await store.getOpportunityMetrics(foreignScope);
    expect(foreignMetrics.totalScreened).toBe(0);
    expect(foreignMetrics.activePursuits).toBe(0);
  });
});
