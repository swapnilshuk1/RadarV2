import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { runMigrations } from "../../src/data/sqlite/migrations/runner";
import { resolveScraperAuthContext } from "../../src/lib/security/scope-resolver";

describe("Scraper authorization permission non-escalation", () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(new Database(":memory:"));
    await runMigrations(db);
    await db.execute("INSERT INTO tenants (id, status) VALUES ('tenant_alpha', 'active')");
  });

  async function seedMember(userId: string, role: string, permissions: readonly string[]) {
    await db.execute("INSERT INTO users (id, email) VALUES (?, ?)", [userId, `${userId}@example.test`]);
    await db.execute("INSERT INTO people (id, email, tenant_id) VALUES (?, ?, 'tenant_alpha')", [
      userId,
      `${userId}@example.test`,
    ]);
    await db.execute(
      "INSERT INTO memberships (user_id, tenant_id, role, status, permissions) VALUES (?, 'tenant_alpha', ?, 'active', ?)",
      [userId, role, JSON.stringify(permissions)],
    );
  }

  it("preserves actual grants and never manufactures scraper or credential capabilities", async () => {
    const cases = [
      { id: "none", role: "member", grants: [], denied: true },
      { id: "plan", role: "member", grants: ["manage:search_plan"], expected: ["manage:search_plan"] },
      { id: "scraper", role: "member", grants: ["run:scraper"], expected: ["run:scraper"] },
      { id: "read", role: "member", grants: ["read:credentials"], denied: true },
      { id: "plan-and-scraper", role: "member", grants: ["manage:search_plan", "run:scraper"], expected: ["manage:search_plan", "run:scraper"] },
      { id: "scraper-and-read", role: "member", grants: ["run:scraper", "read:credentials"], expected: ["run:scraper", "read:credentials"] },
      {
        id: "all-member-grants",
        role: "member",
        grants: ["run:scraper", "manage:search_plan", "manage:credentials", "read:credentials", "read:evaluation", "write:evaluation", "read:person", "write:person"],
        expected: ["run:scraper", "manage:search_plan", "manage:credentials", "read:credentials", "read:evaluation", "write:evaluation", "read:person", "write:person"],
      },
      { id: "owner", role: "owner", grants: ["run:scraper", "manage:search_plan"], expected: ["run:scraper", "manage:search_plan"] },
      {
        id: "admin",
        role: "admin",
        grants: [],
        expected: ["run:scraper", "manage:search_plan", "manage:credentials", "read:credentials", "read:evaluation", "write:evaluation", "read:person", "write:person"],
      },
    ] as const;

    for (const testCase of cases) {
      await seedMember(testCase.id, testCase.role, testCase.grants);

      if (testCase.denied) {
        await expect(resolveScraperAuthContext(testCase.id, "tenant_alpha", db)).rejects.toThrow();
        continue;
      }

      const resolved = await resolveScraperAuthContext(testCase.id, "tenant_alpha", db);
      expect([...resolved.authContext.permissions].sort()).toEqual([...testCase.expected].sort());
      expect(resolved.membership.permissions).toEqual(testCase.grants);

      if (testCase.id === "plan") {
        expect(resolved.authContext.permissions).not.toContain("run:scraper");
        expect(resolved.authContext.permissions).not.toContain("read:credentials");
      }
    }
  });
});
