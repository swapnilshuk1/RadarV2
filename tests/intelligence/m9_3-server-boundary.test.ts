import { describe, it, expect, beforeEach, vi, afterEach, beforeAll } from "vitest";
import { getRepositories } from "../../src/data/sqlite/provider";
import { SqliteDecisionSupportStore } from "../../src/data/sqlite/repositories/SqliteDecisionSupportStore";

// 1. Setup global db reference so hoisted mock can use it
const globalAny = global as any;

vi.mock("../../src/data/database/index", () => ({
  getDatabaseAdapter: () => globalAny.__testDb
}));

// Mock tanstack start
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

describe("M9.3 Canonical Decision Write-Path Server Integration", () => {
  const TENANT_A = "tenant_srv_a";
  const TENANT_B = "tenant_srv_b";
  const PERSON_A = "person_srv_a";
  const PERSON_B = "person_srv_b";

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
      "021_evaluation_work_queue.sql",
      "025_canonical_decisions.sql"
      ,"026_canonical_acquisition_integrity.sql",
      "027_materialized_evaluations_nullable_decision.sql",
      "028_active_evaluation_context_pointers.sql",
      "037_materialized_evaluation_fingerprint.sql"
    ];

    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(process.cwd(), "src/data/sqlite/migrations", file), "utf-8");
      sqliteDb.exec(sql);
    }
  });

  beforeEach(async () => {
    const db = globalAny.__testDb;
    const repos = getRepositories();
    // Inject test DB directly into repos
    (repos as any).decisions = new SqliteDecisionSupportStore(db);

    await db.execute("DELETE FROM canonical_decisions");
    await db.execute("DELETE FROM active_evaluation_contexts");
    await db.execute("DELETE FROM evaluation_context_scopes");
    await db.execute("DELETE FROM search_plan_candidates");
    await db.execute("DELETE FROM evaluation_contexts");
    await db.execute("DELETE FROM search_plan_snapshots");
    await db.execute("DELETE FROM search_plans");
    await db.execute("DELETE FROM opportunity_versions");
    await db.execute("DELETE FROM canonical_opportunities");
    await db.execute("DELETE FROM memberships");
    await db.execute("DELETE FROM people");
    await db.execute("DELETE FROM users");
    await db.execute("DELETE FROM tenants");

    await db.execute("INSERT INTO tenants (id, status) VALUES (?, ?), (?, ?)", [TENANT_A, "active", TENANT_B, "active"]);
    await db.execute("INSERT INTO users (id, email) VALUES (?, ?), (?, ?)", [PERSON_A, "a@example.com", PERSON_B, "b@example.com"]);
    await db.execute("INSERT INTO people (id, tenant_id, email) VALUES (?, ?, ?), (?, ?, ?)", 
      [PERSON_A, TENANT_A, "a@example.com", PERSON_B, TENANT_B, "b@example.com"]);
    await db.execute("INSERT INTO memberships (tenant_id, user_id, status, role, permissions) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)",
      [TENANT_A, PERSON_A, "active", "admin", "[]", TENANT_B, PERSON_B, "active", "admin", "[]"]);
       
    await db.execute(
      "INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url) VALUES (?, ?, ?, ?)",
      ["canon_srv_1", "linkedin", "job_srv_1", "http://linkedin.com/1"]
    );
    await db.execute(`INSERT INTO search_plans (id, tenant_id, person_id, title, status, criteria_json) VALUES (?, ?, ?, 'test', 'active', '{}')`, ["plan_a", TENANT_A, PERSON_A]);
    await db.execute(`INSERT INTO search_plan_snapshots (id, search_plan_id, tenant_id, person_id, snapshot_hash, payload_json) VALUES ('snap_a', ?, ?, ?, 'hash', '{}')`, ["plan_a", TENANT_A, PERSON_A]);
    await db.execute(`INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version) VALUES ('ctx_a', ?, ?, 'snap_a', 'v', 'h', 'p', 'projection-test')`, [TENANT_A, PERSON_A]);
    await db.execute(`INSERT INTO evaluation_context_scopes (context_fingerprint, tenant_id, person_id, search_plan_id) VALUES ('ctx_a', ?, ?, 'plan_a')`, [TENANT_A, PERSON_A]);
    await db.execute(`INSERT INTO active_evaluation_contexts (tenant_id, person_id, search_plan_id, context_fingerprint, activated_by) VALUES (?, ?, 'plan_a', 'ctx_a', 'test')`, [TENANT_A, PERSON_A]);
    await db.execute(`INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, raw_content) VALUES ('version_a', 'canon_srv_1', 'content', 'Role', 'JD')`);
    await db.execute(`INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision) VALUES (?, ?, 'plan_a', 'canon_srv_1', 'version_a', 'CANDIDATE')`, [TENANT_A, PERSON_A]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function setAuthUser(personId: string) {
    vi.mocked(guard.requireAuthUser).mockResolvedValue({ id: personId } as any);
  }

  it("Gates 2, 3, 4: Server Boundary Auth and V4-only save", async () => {
    const db = globalAny.__testDb;
    // 1. Authenticate as A
    setAuthUser(PERSON_A);
    
    // Save decision as A (without any legacy opportunities row - Gate 3)
    await (serverFns.saveDecisionFn as any)({ data: { jobHash: "job_srv_1", verb: "PURSUE" } });
    
    // Read decision as A
    const resA = await (serverFns.getDecisionsFn as any)({});
    expect(resA.success).toBe(true);
    expect(resA.decisions["job_srv_1"].verb).toBe("PURSUE");
    
    // 2. Authenticate as B
    setAuthUser(PERSON_B);
    
    // B attempts to read A's decision
    const resB = await (serverFns.getDecisionsFn as any)({});
    expect(resB.decisions["job_srv_1"]).toBeUndefined();
    
    // Verify db level isolation
    const row = await db.many("SELECT * FROM canonical_decisions WHERE canonical_job_id = 'canon_srv_1'");
    expect(row.length).toBe(1);
    expect(row[0].person_id).toBe(PERSON_A);
    expect(row[0].tenant_id).toBe(TENANT_A);
  });

  it("Gate 4: rejects invalid or out-of-scope writes and ignores browser provenance", async () => {
    const db = globalAny.__testDb;
    setAuthUser(PERSON_A);
    await (serverFns.saveDecisionFn as any)({ data: { jobHash: "job_srv_1", verb: "PURSUE", reviewedFingerprint: "browser-forgery" } });
    const saved = await db.one<any>("SELECT reviewed_fingerprint FROM canonical_decisions WHERE tenant_id = ? AND person_id = ?", [TENANT_A, PERSON_A]);
    expect(saved.reviewed_fingerprint).toBeNull();

    await expect((serverFns.saveDecisionFn as any)({ data: { jobHash: "job_srv_1", verb: "DELETE_ALL" } })).rejects.toThrow(/INVALID_DECISION_VERB/);
    await expect((serverFns.saveDecisionFn as any)({ data: { jobHash: "missing", verb: "PURSUE" } })).rejects.toThrow(/OUT_OF_SCOPE_OPPORTUNITY/);

    setAuthUser(PERSON_B);
    await expect((serverFns.saveDecisionFn as any)({ data: { jobHash: "job_srv_1", verb: "PURSUE" } })).rejects.toThrow(/OUT_OF_SCOPE_OPPORTUNITY/);
  });
});
