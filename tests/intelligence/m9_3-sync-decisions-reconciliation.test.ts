import { describe, it, expect, beforeEach, vi, afterEach, beforeAll } from "vitest";
import { getRepositories } from "../../src/data/sqlite/provider";
import { SqliteDecisionSupportStore } from "../../src/data/sqlite/repositories/SqliteDecisionSupportStore";

const globalAny = global as any;

vi.mock("../../src/data/database/index", () => ({
  getDatabaseAdapter: () => globalAny.__testDb
}));

// Mock TanStack Start createServerFn
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    validator: () => ({
      handler: (fn: any) => fn
    }),
    handler: (fn: any) => fn
  })
}));

vi.mock("../../src/lib/auth/guard", () => ({
  requireAuthUser: vi.fn(),
  AuthError: class AuthError extends Error {}
}));

import * as serverFns from "../../src/lib/intelligence/decisions-server";
import * as guard from "../../src/lib/auth/guard";

describe("M9.3 Decision Synchronization & Orphan Reconciliation", () => {
  const TENANT_A = "tenant_sync_a";
  const PERSON_A = "person_sync_a";

  beforeAll(async () => {
    const { default: Database } = await import("better-sqlite3");
    const { SqliteAdapter } = await import("../../src/data/database/sqlite");
    const fs = await import("fs");
    const path = await import("path");

    const sqliteDb = new Database(":memory:");
    const db = new SqliteAdapter(sqliteDb);
    globalAny.__testDb = db;

    const migrationFiles = [
      "001_initial_schema.sql",
      "006_recreate_decisions.sql",
      "009_profile_queryable_columns.sql",
      "018_multi_tenant_foundation.sql",
      "019_evaluation_context_and_read_model.sql",
      "020_canonical_acquisition.sql",
      "025_canonical_decisions.sql"
    ];

    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(process.cwd(), "src/data/sqlite/migrations", file), "utf-8");
      sqliteDb.exec(sql);
    }
  });

  beforeEach(async () => {
    const db = globalAny.__testDb;
    const repos = getRepositories();
    (repos as any).decisions = new SqliteDecisionSupportStore(db);

    await db.execute("DELETE FROM canonical_decisions");
    await db.execute("DELETE FROM canonical_opportunities");
    await db.execute("DELETE FROM memberships");
    await db.execute("DELETE FROM people");
    await db.execute("DELETE FROM users");
    await db.execute("DELETE FROM tenants");

    await db.execute("INSERT INTO tenants (id, status) VALUES (?, ?)", [TENANT_A, "active"]);
    await db.execute("INSERT INTO users (id, email) VALUES (?, ?)", [PERSON_A, "sync_a@example.com"]);
    await db.execute("INSERT INTO people (id, tenant_id, email) VALUES (?, ?, ?)", [PERSON_A, TENANT_A, "sync_a@example.com"]);
    await db.execute("INSERT INTO memberships (tenant_id, user_id, status, role, permissions) VALUES (?, ?, ?, ?, ?)",
      [TENANT_A, PERSON_A, "active", "admin", "[]"]);

    // Seed canonical opportunities for valid jobs
    await db.execute(
      "INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
      [
        "canon_valid_a", "linkedin", "job_valid_a", "https://linkedin.com/jobs/valid-a",
        "canon_valid_c", "indeed", "job_valid_c", "https://indeed.com/jobs/valid-c"
      ]
    );

    vi.mocked(guard.requireAuthUser).mockResolvedValue({ id: PERSON_A } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("Test A: Valid local decision persists server-side and is returned in authoritative decision map", async () => {
    const db = globalAny.__testDb;

    const res = await (serverFns.syncDecisionsFn as any)({
      data: {
        decisions: {
          job_valid_a: { verb: "PURSUE", reviewedFingerprint: "fp_1" }
        }
      }
    });

    expect(res.success).toBe(true);
    expect(res.decisions).toBeDefined();
    expect(res.decisions["job_valid_a"]).toBeDefined();
    expect(res.decisions["job_valid_a"].verb).toBe("PURSUE");

    // Verify row exists in canonical_decisions table
    const rows = await db.many("SELECT * FROM canonical_decisions WHERE canonical_job_id = 'canon_valid_a'");
    expect(rows.length).toBe(1);
    expect(rows[0].person_id).toBe(PERSON_A);
    expect(rows[0].action).toBe("PURSUE");
  });

  it("Test B: Orphaned historical job is not written to DB and is omitted from authoritative map", async () => {
    const db = globalAny.__testDb;

    const res = await (serverFns.syncDecisionsFn as any)({
      data: {
        decisions: {
          "j-0379479f0b86": { verb: "PASS", reviewedFingerprint: null }
        }
      }
    });

    expect(res.success).toBe(true);
    expect(res.decisions).toBeDefined();
    expect(res.decisions["j-0379479f0b86"]).toBeUndefined();

    // Verify 0 rows in canonical_decisions table
    const rows = await db.many("SELECT * FROM canonical_decisions");
    expect(rows.length).toBe(0);
  });

  it("Test C: Mixed batch persists valid jobs and omits orphan without cross-record interference", async () => {
    const db = globalAny.__testDb;

    const res = await (serverFns.syncDecisionsFn as any)({
      data: {
        decisions: {
          job_valid_a: { verb: "PURSUE", reviewedFingerprint: "fp_a" },
          "j-0a5b3c5f63e7": { verb: "CONSIDER", reviewedFingerprint: null },
          job_valid_c: { verb: "PASS", reviewedFingerprint: "fp_c" }
        }
      }
    });

    expect(res.success).toBe(true);
    expect(res.decisions["job_valid_a"]).toBeDefined();
    expect(res.decisions["job_valid_a"].verb).toBe("PURSUE");
    expect(res.decisions["job_valid_c"]).toBeDefined();
    expect(res.decisions["job_valid_c"].verb).toBe("PASS");
    expect(res.decisions["j-0a5b3c5f63e7"]).toBeUndefined();

    // Verify DB state
    const rowsA = await db.many("SELECT * FROM canonical_decisions WHERE canonical_job_id = 'canon_valid_a'");
    expect(rowsA.length).toBe(1);
    const rowsC = await db.many("SELECT * FROM canonical_decisions WHERE canonical_job_id = 'canon_valid_c'");
    expect(rowsC.length).toBe(1);
  });

  it("Test D: Existing server decisions are preserved and returned alongside newly synced decisions", async () => {
    // Pre-insert a decision for job_valid_a directly
    const repos = getRepositories();
    await repos.decisions.recordUserDecision(PERSON_A, "job_valid_a", "PURSUE", undefined, null, TENANT_A);

    // Sync job_valid_c
    const res = await (serverFns.syncDecisionsFn as any)({
      data: {
        decisions: {
          job_valid_c: { verb: "CONSIDER", reviewedFingerprint: null }
        }
      }
    });

    expect(res.success).toBe(true);
    expect(res.decisions["job_valid_a"].verb).toBe("PURSUE");
    expect(res.decisions["job_valid_c"].verb).toBe("CONSIDER");
  });

  it("Test E: Unauthenticated request throws AuthError and never produces a false success", async () => {
    vi.mocked(guard.requireAuthUser).mockRejectedValueOnce(new guard.AuthError("Unauthorized"));

    await expect((serverFns.syncDecisionsFn as any)({
      data: {
        decisions: { job_valid_a: { verb: "PURSUE" } }
      }
    })).rejects.toThrow();
  });
});
