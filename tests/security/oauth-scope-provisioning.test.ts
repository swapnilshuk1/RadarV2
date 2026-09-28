import { beforeEach, describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { runMigrations } from "../../src/data/sqlite/migrations/runner";
import { provisionOAuthScope } from "../../src/lib/auth/oauth-scope-provisioning";
import { resolveServingScope, resolveScraperAuthContext } from "../../src/lib/security/scope-resolver";
import { EvaluationRuntimeControl } from "../../src/lib/intelligence/EvaluationRuntimeControl";

describe("OAuth scope provisioning", () => {
  let raw: Database.Database;
  let db: SqliteAdapter;
  const identity = { provider: "google", providerUserId: "google-subject", email: "new@example.test", name: "New User", avatarUrl: null, emailVerified: true };

  beforeEach(async () => {
    raw = new Database(":memory:");
    db = new SqliteAdapter(raw);
    await runMigrations(db);
    await db.execute("INSERT INTO tenants (id, status) VALUES ('tenant_active', 'active')");
  });

  test("new OAuth identity atomically obtains a resolvable person, own new tenant, user, admin membership, and account", async () => {
    const result = await provisionOAuthScope(db, identity, () => "person_new", () => "tenant_person_new");
    expect(result).toMatchObject({ personId: "person_new", tenantId: "tenant_person_new", isNewUser: true, needsOnboarding: true });
    await expect(resolveServingScope("person_new", undefined, db)).resolves.toMatchObject({ scope: { personId: "person_new", tenantId: "tenant_person_new" } });
    expect(raw.prepare("SELECT user_id FROM oauth_accounts").get()).toMatchObject({ user_id: "person_new" });

    // Verify newly provisioned tenant exists and membership is admin with scraper authority
    const tenantRow = raw.prepare("SELECT id, status FROM tenants WHERE id = ?").get("tenant_person_new");
    expect(tenantRow).toMatchObject({ id: "tenant_person_new", status: "active" });

    const membership = raw.prepare("SELECT role, permissions, status FROM memberships WHERE user_id = ? AND tenant_id = ?")
      .get("person_new", "tenant_person_new") as { role: string; permissions: string; status: string };
    expect(membership.role).toBe("admin");
    expect(membership.status).toBe("active");
    expect(membership.permissions).toContain("run:scraper");
  });

  test("Tenant A existing + new OAuth user -> creates Tenant B and does not join Tenant A", async () => {
    // Tenant A already exists in beforeEach ('tenant_active')
    const result = await provisionOAuthScope(db, identity, () => "person_b", () => "tenant_b");
    expect(result.tenantId).toBe("tenant_b");
    expect(result.tenantId).not.toBe("tenant_active");

    // Must not join Tenant A
    const tenantAMembership = raw.prepare("SELECT * FROM memberships WHERE user_id = ? AND tenant_id = 'tenant_active'").get("person_b");
    expect(tenantAMembership).toBeUndefined();

    // Must belong to Tenant B
    const tenantBMembership = raw.prepare("SELECT * FROM memberships WHERE user_id = ? AND tenant_id = 'tenant_b'").get("person_b");
    expect(tenantBMembership).toBeDefined();
  });

  test("two pre-existing active tenants -> new OAuth registration succeeds safely with no global ambiguity failure", async () => {
    await db.execute("INSERT INTO tenants (id, status) VALUES ('tenant_second', 'active')");
    // With 2 active tenants in DB, registration must succeed without throwing global ambiguity
    const result = await provisionOAuthScope(db, identity, () => "person_multi", () => "tenant_multi");
    expect(result.personId).toBe("person_multi");
    expect(result.tenantId).toBe("tenant_multi");
    expect(result.isNewUser).toBe(true);
  });

  test("newly provisioned user can resolve profile, activate intent/search plan, and authorize scraper start", async () => {
    const result = await provisionOAuthScope(db, identity, () => "person_exec", () => "tenant_exec");

    // 1. Resolve profile / serving scope
    const servingScope = await resolveServingScope(result.personId, result.tenantId, db);
    expect(servingScope.scope).toEqual({ personId: "person_exec", tenantId: "tenant_exec" });

    // 2. Authorize scraper start (requires admin or 'run:scraper' / 'manage:search_plan')
    const scraperAuth = await resolveScraperAuthContext(result.personId, result.tenantId, db);
    expect(scraperAuth.authContext.tenantId).toBe("tenant_exec");
    expect(scraperAuth.authContext.userId).toBe("person_exec");
    expect(scraperAuth.authContext.role).toBe("admin");
    expect(scraperAuth.authContext.permissions).toContain("run:scraper");
  });

  test("returning user -> login does not change tenant or membership", async () => {
    // Seed existing person and active membership in tenant_active
    await db.execute("INSERT INTO people (id, email, tenant_id, role, onboarded) VALUES ('existing_user', 'new@example.test', 'tenant_active', 'user', 1)");
    await db.execute("INSERT INTO users (id, email) VALUES ('existing_user', 'new@example.test')");
    await db.execute("INSERT INTO memberships (user_id, tenant_id, role, permissions, status) VALUES ('existing_user', 'tenant_active', 'member', '[\"read:evaluation\"]', 'active')");

    // Also add an unrelated second active tenant to prove stability
    await db.execute("INSERT INTO tenants (id, status) VALUES ('tenant_unrelated', 'active')");

    const result = await provisionOAuthScope(db, identity, () => "should_not_be_called");
    expect(result.personId).toBe("existing_user");
    expect(result.tenantId).toBe("tenant_active");
    expect(result.isNewUser).toBe(false);
    expect(result.needsOnboarding).toBe(false);

    // Verify tenant and membership were NOT reassigned or overwritten
    const personRow = raw.prepare("SELECT tenant_id FROM people WHERE id = 'existing_user'").get() as { tenant_id: string };
    expect(personRow.tenant_id).toBe("tenant_active");

    const membershipRow = raw.prepare("SELECT role, permissions, status FROM memberships WHERE user_id = 'existing_user' AND tenant_id = 'tenant_active'").get() as { role: string; permissions: string; status: string };
    expect(membershipRow.role).toBe("member");
    expect(membershipRow.permissions).toBe('["read:evaluation"]');
    expect(membershipRow.status).toBe("active");
  });

  test("duplicate callback is idempotent and creates no duplicate identity rows", async () => {
    await provisionOAuthScope(db, identity, () => "person_new", () => "tenant_new");
    const repeated = await provisionOAuthScope(db, identity, () => "should_not_be_used");
    expect(repeated.personId).toBe("person_new");
    expect(repeated.tenantId).toBe("tenant_new");
    expect(raw.prepare("SELECT COUNT(*) AS n FROM people").get()).toMatchObject({ n: 1 });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM memberships").get()).toMatchObject({ n: 1 });
  });

  test("verified existing email links safely without duplicate person or user rows", async () => {
    await db.execute("INSERT INTO people (id, email, tenant_id) VALUES ('existing', 'new@example.test', 'tenant_active')");
    await db.execute("INSERT INTO users (id, email) VALUES ('existing', 'new@example.test')");
    const result = await provisionOAuthScope(db, identity, () => "unused");
    expect(result.personId).toBe("existing");
    expect(result.tenantId).toBe("tenant_active");
    expect(raw.prepare("SELECT COUNT(*) AS n FROM people").get()).toMatchObject({ n: 1 });
    expect(raw.prepare("SELECT user_id FROM oauth_accounts").get()).toMatchObject({ user_id: "existing" });
  });

  test("legacy profile admin is promoted only when the membership is missing", async () => {
    await db.execute("INSERT INTO people (id, email, tenant_id, role) VALUES ('existing', 'new@example.test', 'tenant_active', 'admin')");
    await db.execute("INSERT INTO users (id, email) VALUES ('existing', 'new@example.test')");
    await provisionOAuthScope(db, identity, () => "unused");
    expect(raw.prepare("SELECT role FROM memberships WHERE user_id='existing' AND tenant_id='tenant_active'").get()).toMatchObject({ role: "admin" });
  });

  test("OAuth login never promotes or reactivates an established membership from legacy profile role", async () => {
    await db.execute("INSERT INTO people (id, email, tenant_id, role) VALUES ('existing', 'new@example.test', 'tenant_active', 'admin')");
    await db.execute("INSERT INTO users (id, email) VALUES ('existing', 'new@example.test')");
    await db.execute("INSERT INTO memberships (user_id, tenant_id, role, permissions, status, revoked_at) VALUES ('existing', 'tenant_active', 'member', '[]', 'revoked', '2026-01-01T00:00:00Z')");
    await provisionOAuthScope(db, identity, () => "unused");
    expect(raw.prepare("SELECT role, status, revoked_at FROM memberships WHERE user_id='existing' AND tenant_id='tenant_active'").get())
      .toMatchObject({ role: "member", status: "revoked", revoked_at: "2026-01-01T00:00:00Z" });
  });

  test("a missing scoped evaluator-control row defaults to STOPPED while a missing table remains an error", async () => {
    const control = new EvaluationRuntimeControl(db);
    await expect(control.get({ tenantId: "tenant_active", personId: "person_new" }))
      .resolves.toMatchObject({ desiredState: "STOPPED", updatedAt: 0, updatedBy: null });
    await db.execute("DROP TABLE evaluation_runtime_control");
    await expect(control.get({ tenantId: "tenant_active", personId: "person_new" })).rejects.toThrow(/no such table/i);
  });

  test("OAuth login never downgrades an existing tenant admin membership", async () => {
    await db.execute("INSERT INTO people (id, email, tenant_id, role) VALUES ('existing', 'new@example.test', 'tenant_active', 'user')");
    await db.execute("INSERT INTO users (id, email) VALUES ('existing', 'new@example.test')");
    await db.execute("INSERT INTO memberships (user_id, tenant_id, role, permissions, status) VALUES ('existing', 'tenant_active', 'admin', '[]', 'active')");
    await provisionOAuthScope(db, identity, () => "unused");
    expect(raw.prepare("SELECT role FROM memberships WHERE user_id='existing' AND tenant_id='tenant_active'").get()).toMatchObject({ role: "admin" });
  });

  test("an established but incomplete person is never classified as new", async () => {
    await db.execute("INSERT INTO people (id, email, tenant_id, onboarded) VALUES ('existing', 'new@example.test', 'tenant_active', 0)");
    await db.execute("INSERT INTO users (id, email) VALUES ('existing', 'new@example.test')");
    const result = await provisionOAuthScope(db, identity, () => "unused");
    expect(result).toMatchObject({ personId: "existing", isNewUser: false, needsOnboarding: true });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM people").get()).toMatchObject({ n: 1 });
  });

  test("unverified email rejects before changing any identity or authorization rows", async () => {
    await expect(provisionOAuthScope(db, { ...identity, emailVerified: false }, () => "person_new"))
      .rejects.toThrow("Verified provider email");
    for (const table of ["people", "users", "memberships", "oauth_accounts"]) {
      expect(raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toMatchObject({ n: 0 });
    }
  });

  test("existing person with NULL tenant_id and one active membership adopts membership tenant, updates people.tenant_id, and succeeds at resolveServingScope", async () => {
    await db.execute("INSERT INTO people (id, email, tenant_id, role, onboarded) VALUES ('legacy_member', 'new@example.test', NULL, 'user', 1)");
    await db.execute("INSERT INTO users (id, email) VALUES ('legacy_member', 'new@example.test')");
    await db.execute("INSERT INTO memberships (user_id, tenant_id, role, permissions, status) VALUES ('legacy_member', 'tenant_active', 'member', '[\"read:person\"]', 'active')");

    const result = await provisionOAuthScope(db, identity, () => "unused", () => "unused");
    expect(result.personId).toBe("legacy_member");
    expect(result.tenantId).toBe("tenant_active");

    const personRow = raw.prepare("SELECT tenant_id FROM people WHERE id = 'legacy_member'").get() as { tenant_id: string };
    expect(personRow.tenant_id).toBe("tenant_active");

    const servingScope = await resolveServingScope("legacy_member", undefined, db);
    expect(servingScope.scope).toEqual({ personId: "legacy_member", tenantId: "tenant_active" });
  });

  test("existing person with NULL tenant_id and no membership receives dedicated tenant, people.tenant_id assignment, admin membership, and scraper authorization", async () => {
    await db.execute("INSERT INTO people (id, email, tenant_id, role, onboarded) VALUES ('legacy_unassigned', 'new@example.test', NULL, 'user', 1)");
    await db.execute("INSERT INTO users (id, email) VALUES ('legacy_unassigned', 'new@example.test')");

    const result = await provisionOAuthScope(db, identity, () => "legacy_unassigned", () => "tenant_dedicated_legacy");
    expect(result.personId).toBe("legacy_unassigned");
    expect(result.tenantId).toBe("tenant_dedicated_legacy");

    const personRow = raw.prepare("SELECT tenant_id, role FROM people WHERE id = 'legacy_unassigned'").get() as { tenant_id: string; role: string };
    expect(personRow.tenant_id).toBe("tenant_dedicated_legacy");
    expect(personRow.role).toBe("admin");

    const membership = raw.prepare("SELECT role, permissions, status FROM memberships WHERE user_id = 'legacy_unassigned' AND tenant_id = 'tenant_dedicated_legacy'")
      .get() as { role: string; permissions: string; status: string };
    expect(membership.role).toBe("admin");
    expect(membership.status).toBe("active");
    expect(membership.permissions).toContain("run:scraper");

    const scraperAuth = await resolveScraperAuthContext("legacy_unassigned", "tenant_dedicated_legacy", db);
    expect(scraperAuth.authContext.tenantId).toBe("tenant_dedicated_legacy");
    expect(scraperAuth.authContext.role).toBe("admin");
    expect(scraperAuth.authContext.permissions).toContain("run:scraper");
  });
});
