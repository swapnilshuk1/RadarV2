import { describe, it, expect, beforeEach } from "vitest";
import { getDatabaseAdapter } from "../../src/data/database/index";
import { SqliteDecisionSupportStore } from "../../src/data/sqlite/repositories/SqliteDecisionSupportStore";

describe("M9.3 Canonical Decision Write-Path", () => {
  let db: any;
  let decisionsStore: SqliteDecisionSupportStore;

  const TENANT_A = "tenant_a";
  const TENANT_B = "tenant_b";
  const PERSON_A = "person_a";
  const PERSON_B = "person_b";

  beforeEach(async () => {
    const { default: Database } = await import("better-sqlite3");
    const { SqliteAdapter } = await import("../../src/data/database/sqlite");
    const fs = await import("fs");
    const path = await import("path");

    const sqliteDb = new Database(":memory:");
    db = new SqliteAdapter(sqliteDb);

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

    await db.execute("INSERT INTO tenants (id, status) VALUES (?, ?), (?, ?)", [TENANT_A, "active", TENANT_B, "active"]);
    await db.execute("INSERT INTO people (id, tenant_id, email) VALUES (?, ?, ?), (?, ?, ?)", 
      [PERSON_A, TENANT_A, "a@example.com",
       PERSON_B, TENANT_B, "b@example.com"]);
       
    // Insert canonical_opportunities
    await db.execute(
      "INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
      ["canon_hash_1", "linkedin", "job_1", "http://linkedin.com/1",
       "canon_hash_2", "indeed", "job_2", "http://indeed.com/2"]
    );

    decisionsStore = new SqliteDecisionSupportStore(db);
  });

  it("PURSUE, CONSIDER, PASS are persisted for canonical opportunities without legacy rows", async () => {
    // Note: No 'opportunities' legacy row is inserted
    await decisionsStore.recordUserDecision(PERSON_A, "job_1", "PURSUE", undefined, undefined, TENANT_A);
    let map = await decisionsStore.getUserDecisions(PERSON_A, TENANT_A);
    expect(map["job_1"].verb).toBe("PURSUE");

    await decisionsStore.recordUserDecision(PERSON_A, "job_1", "CONSIDER", undefined, undefined, TENANT_A);
    map = await decisionsStore.getUserDecisions(PERSON_A, TENANT_A);
    expect(map["job_1"].verb).toBe("CONSIDER");

    await decisionsStore.recordUserDecision(PERSON_A, "job_1", "PASS", undefined, undefined, TENANT_A);
    map = await decisionsStore.getUserDecisions(PERSON_A, TENANT_A);
    expect(map["job_1"].verb).toBe("PASS");
  });

  it("Tenant isolation: A cannot read or overwrite B's decision", async () => {
    await decisionsStore.recordUserDecision(PERSON_A, "job_1", "PURSUE", undefined, undefined, TENANT_A);
    
    // B reads: shouldn't see A's decision
    const mapB = await decisionsStore.getUserDecisions(PERSON_B, TENANT_B);
    expect(mapB["job_1"]).toBeUndefined();

    // B writes same job
    await decisionsStore.recordUserDecision(PERSON_B, "job_1", "PASS", undefined, undefined, TENANT_B);
    
    // A reads: shouldn't be affected by B
    const mapA = await decisionsStore.getUserDecisions(PERSON_A, TENANT_A);
    expect(mapA["job_1"].verb).toBe("PURSUE");
    
    // Check DB isolation
    const rows = await db.many("SELECT * FROM canonical_decisions");
    expect(rows.length).toBe(2);
  });

  it("Repeated decision is deterministic (upsert)", async () => {
    await decisionsStore.recordUserDecision(PERSON_A, "job_1", "PURSUE", undefined, undefined, TENANT_A);
    await decisionsStore.recordUserDecision(PERSON_A, "job_1", "PURSUE", undefined, undefined, TENANT_A);
    
    const rows = await db.many("SELECT * FROM canonical_decisions WHERE canonical_job_id = ?", ["canon_hash_1"]);
    expect(rows.length).toBe(1);
    expect(rows[0].action).toBe("PURSUE");
  });

  it("Active V4 reads/writes contain zero legacy decisions dependencies", async () => {
    await decisionsStore.recordUserDecision(PERSON_A, "job_1", "PURSUE", undefined, undefined, TENANT_A);
    await decisionsStore.getUserDecisions(PERSON_A, TENANT_A);
    
    // Ensure the legacy decisions table is totally empty
    const legacy = await db.many("SELECT * FROM decisions");
    expect(legacy.length).toBe(0);
  });

  it("Deleting works canonically", async () => {
    await decisionsStore.recordUserDecision(PERSON_A, "job_1", "PURSUE", undefined, undefined, TENANT_A);
    await decisionsStore.deleteUserDecision(PERSON_A, "job_1", TENANT_A);
    
    const map = await decisionsStore.getUserDecisions(PERSON_A, TENANT_A);
    expect(map["job_1"]).toBeUndefined();
  });
});
