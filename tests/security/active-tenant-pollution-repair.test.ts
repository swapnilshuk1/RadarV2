import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  APPROVED_DISPOSABLE_TENANT_IDS,
  CANONICAL_TENANT_ID,
  GUEST_TENANT_ID,
  applyTenantStatusRepair,
  assertNoConfiguredTursoTenantMutation,
  auditTenant,
  listActiveTenants,
} from "../../src/lib/maintenance/active-tenant-pollution-repair";
import { getDatabaseAdapter, resetDatabaseAdapter } from "../../src/data/database";
import { runMigrations } from "../../src/data/sqlite/migrations/runner";
import type { DatabaseAdapter } from "../../src/data/database/adapter";

describe("active tenant pollution repair", () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    resetDatabaseAdapter();
    process.env.RADAR_ENV = "test";
    db = getDatabaseAdapter(":memory:");
    await runMigrations(db);
    for (const tenantId of [CANONICAL_TENANT_ID, GUEST_TENANT_ID, ...APPROVED_DISPOSABLE_TENANT_IDS]) {
      await db.execute("INSERT INTO tenants (id, status) VALUES (?, 'active')", [tenantId]);
    }
    await db.execute("INSERT INTO users (id, email) VALUES ('guest-user', 'guest@example.invalid')");
    await db.execute("INSERT INTO people (id, email, tenant_id) VALUES ('guest-user', 'guest-person@example.invalid', ?)", [GUEST_TENANT_ID]);
    await db.execute("INSERT INTO memberships (user_id, tenant_id, role, permissions, status) VALUES ('guest-user', ?, 'member', '[]', 'active')", [GUEST_TENANT_ID]);
  });

  afterEach(() => resetDatabaseAdapter());

  it("is read-only while auditing and does not modify protected identity tables", async () => {
    const before = await db.one<{ tenants: number; people: number; users: number; memberships: number; oauth: number; decisions: number }>(
      `SELECT (SELECT COUNT(*) FROM tenants) AS tenants, (SELECT COUNT(*) FROM people) AS people,
              (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM memberships) AS memberships,
              (SELECT COUNT(*) FROM oauth_accounts) AS oauth, (SELECT COUNT(*) FROM canonical_decisions) AS decisions`,
    );
    const audit = await auditTenant(db, GUEST_TENANT_ID);
    const after = await db.one<typeof before>(
      `SELECT (SELECT COUNT(*) FROM tenants) AS tenants, (SELECT COUNT(*) FROM people) AS people,
              (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM memberships) AS memberships,
              (SELECT COUNT(*) FROM oauth_accounts) AS oauth, (SELECT COUNT(*) FROM canonical_decisions) AS decisions`,
    );
    expect(audit.tenant?.status).toBe("active");
    expect(audit.memberships).toEqual([{ userId: "guest-user", status: "active", userExists: true, personExists: true, personTenantId: GUEST_TENANT_ID }]);
    expect(after).toEqual(before);
    expect((await listActiveTenants(db)).map((row) => row.id)).toContain(GUEST_TENANT_ID);
  });

  it("changes every noncanonical active tenant status transactionally and verifies the exact postcondition", async () => {
    const result = await applyTenantStatusRepair(db, {
      expectedActiveTenantIds: [CANONICAL_TENANT_ID],
    });
    expect(result.updatedTenantIds).toEqual([GUEST_TENANT_ID, ...APPROVED_DISPOSABLE_TENANT_IDS].sort());
    expect(result.afterActiveTenantIds).toEqual([CANONICAL_TENANT_ID]);
    const inactive = await db.many<{ id: string; status: string }>("SELECT id, status FROM tenants WHERE id IN (?, ?, ?, ?, ?, ?) ORDER BY id", APPROVED_DISPOSABLE_TENANT_IDS);
    expect(inactive.every((row) => row.status === "inactive")).toBe(true);
    const identity = await db.one<{ people: number; users: number; memberships: number; tenant_id: string }>(
      `SELECT (SELECT COUNT(*) FROM people) AS people, (SELECT COUNT(*) FROM users) AS users,
              (SELECT COUNT(*) FROM memberships) AS memberships,
              (SELECT tenant_id FROM people WHERE id = 'guest-user') AS tenant_id`,
    );
    expect(identity).toEqual({ people: 1, users: 1, memberships: 1, tenant_id: GUEST_TENANT_ID });
  });

  it("fails before mutation when the requested final active-tenant set is not exact", async () => {
    await expect(applyTenantStatusRepair(db, {
      expectedActiveTenantIds: [CANONICAL_TENANT_ID, GUEST_TENANT_ID],
    })).rejects.toThrow(/exact sole expected/i);
    const activeIds = (await listActiveTenants(db)).map((row) => row.id);
    expect(activeIds).toContain(APPROVED_DISPOSABLE_TENANT_IDS[0]);
    expect(activeIds).toContain(GUEST_TENANT_ID);
  });

  it("rejects historical tenant-mutating verification against configured Turso", () => {
    expect(() => assertNoConfiguredTursoTenantMutation({ engine: "turso", fingerprint: "turso:fixture" })).toThrow(/configured Turso/i);
    expect(() => assertNoConfiguredTursoTenantMutation({ engine: "test-sqlite", fingerprint: "test-sqlite:memory" })).not.toThrow();
  });
});
