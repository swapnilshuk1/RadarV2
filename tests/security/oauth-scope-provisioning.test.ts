import { beforeEach, describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { runMigrations } from "../../src/data/sqlite/migrations/runner";
import { provisionOAuthScope } from "../../src/lib/auth/oauth-scope-provisioning";
import { resolveServingScope } from "../../src/lib/security/scope-resolver";

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
    expect(result).toMatchObject({ personId: "person_new", tenantId: "tenant_active", isNewUser: true });
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

  test("ambiguous active tenancy fails before identity rows are created", async () => {
    await db.execute("INSERT INTO tenants (id, status) VALUES ('tenant_second', 'active')");
    await expect(provisionOAuthScope(db, identity, () => "person_new")).rejects.toThrow("exactly one active tenant");
    expect(raw.prepare("SELECT COUNT(*) AS n FROM people").get()).toMatchObject({ n: 0 });
  });
});
