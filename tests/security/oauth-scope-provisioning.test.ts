import { beforeEach, describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { runMigrations } from "../../src/data/sqlite/migrations/runner";
import { provisionOAuthScope } from "../../src/lib/auth/oauth-scope-provisioning";
import { resolveServingScope } from "../../src/lib/security/scope-resolver";
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

  test("new OAuth identity atomically obtains a resolvable person, tenant, user, membership, and account", async () => {
    const result = await provisionOAuthScope(db, identity, () => "person_new");
    expect(result).toMatchObject({ personId: "person_new", tenantId: "tenant_active", isNewUser: true, needsOnboarding: true });
    await expect(resolveServingScope("person_new", undefined, db)).resolves.toMatchObject({ scope: { personId: "person_new", tenantId: "tenant_active" } });
    expect(raw.prepare("SELECT user_id FROM oauth_accounts").get()).toMatchObject({ user_id: "person_new" });
  });

  test("duplicate callback is idempotent and creates no duplicate identity rows", async () => {
    await provisionOAuthScope(db, identity, () => "person_new");
    const repeated = await provisionOAuthScope(db, identity, () => "should_not_be_used");
    expect(repeated.personId).toBe("person_new");
    expect(raw.prepare("SELECT COUNT(*) AS n FROM people").get()).toMatchObject({ n: 1 });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM memberships").get()).toMatchObject({ n: 1 });
  });

  test("verified existing email links safely without duplicate person or user rows", async () => {
    await db.execute("INSERT INTO people (id, email, tenant_id) VALUES ('existing', 'new@example.test', 'tenant_active')");
    await db.execute("INSERT INTO users (id, email) VALUES ('existing', 'new@example.test')");
    const result = await provisionOAuthScope(db, identity, () => "unused");
    expect(result.personId).toBe("existing");
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

  test("a missing scoped evaluator-control row defaults to RUNNING while a missing table remains an error", async () => {
    const control = new EvaluationRuntimeControl(db);
    await expect(control.get({ tenantId: "tenant_active", personId: "person_new" }))
      .resolves.toMatchObject({ desiredState: "RUNNING", updatedAt: 0, updatedBy: null });
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

  test("ambiguous active tenancy fails before identity rows are created", async () => {
    await db.execute("INSERT INTO tenants (id, status) VALUES ('tenant_second', 'active')");
    await expect(provisionOAuthScope(db, identity, () => "person_new")).rejects.toThrow("exactly one active tenant");
    expect(raw.prepare("SELECT COUNT(*) AS n FROM people").get()).toMatchObject({ n: 0 });
  });
});
