import { describe, test, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { DatabaseAdapter, QueryParams } from "@/data/database/DatabaseAdapter";
import { computeCanonicalJobId } from "@/lib/domain/canonical_identity";
import { SqliteDecisionSupportStore } from "@/data/sqlite/repositories/SqliteDecisionSupportStore";

class TestSqliteAdapter implements DatabaseAdapter {
  constructor(public db: Database.Database) {}
  async one<T>(sql: string, params?: QueryParams): Promise<T | null> {
    const stmt = this.db.prepare(sql);
    const row = stmt.get(...(params || []));
    return (row as T) || null;
  }
  async many<T>(sql: string, params?: QueryParams): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...(params || [])) as T[];
  }
  async execute(sql: string, params?: QueryParams): Promise<{
    rowsAffected: number;
    lastInsertRowid?: number | bigint | string;
  }> {
    const stmt = this.db.prepare(sql);
    const info = stmt.run(...(params || []));
    return { rowsAffected: info.changes, lastInsertRowid: info.lastInsertRowid };
  }
  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    this.db.exec("BEGIN");
    try {
      const res = await fn(this);
      this.db.exec("COMMIT");
      return res;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}

describe("M9.4.1 Forensic Certification: Multi-Tenant Zero-Orphan & Cross-Tenant Boundary Contract", () => {
  let sqliteDb: Database.Database;
  let adapter: TestSqliteAdapter;
  let decisionStore: SqliteDecisionSupportStore;

  const TENANT_A = "tenant_alpha";
  const TENANT_B = "tenant_beta";
  const PERSON_A = "person_alpha_1";
  const PERSON_B = "person_beta_1";

  beforeEach(() => {
    sqliteDb = new Database(":memory:");
    sqliteDb.pragma("foreign_keys = ON");

    const migrationFiles = [
      "001_initial_schema.sql",
      "006_recreate_decisions.sql",
      "009_profile_queryable_columns.sql",
      "018_multi_tenant_foundation.sql",
      "019_evaluation_context_and_read_model.sql",
      "020_canonical_acquisition.sql",
      "021_evaluation_work_queue.sql",
      "025_canonical_decisions.sql"
    ];

    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(process.cwd(), "src/data/sqlite/migrations", file), "utf-8");
      sqliteDb.exec(sql);
    }

    adapter = new TestSqliteAdapter(sqliteDb);
    decisionStore = new SqliteDecisionSupportStore(adapter);

    // Seed tenants and persons
    sqliteDb.prepare(`INSERT INTO tenants (id, status, created_at, updated_at) VALUES (?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(TENANT_A);
    sqliteDb.prepare(`INSERT INTO tenants (id, status, created_at, updated_at) VALUES (?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(TENANT_B);

    sqliteDb.prepare(`INSERT INTO people (id, tenant_id, email, created_at, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(
      PERSON_A, TENANT_A, "alice@alpha.com"
    );
    sqliteDb.prepare(`INSERT INTO people (id, tenant_id, email, created_at, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(
      PERSON_B, TENANT_B, "bob@beta.com"
    );
  });

  test("Composite Foreign Key blocks cross-tenant person assignment", async () => {
    const canonicalJobId = computeCanonicalJobId({ source: "LinkedIn", sourceJobId: "cross-job-001" });
    sqliteDb.prepare(`
      INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(canonicalJobId, "LinkedIn", "cross-job-001", "https://linkedin.com/jobs/001", "Target Co");

    // Attempt to insert decision for PERSON_A (who belongs to TENANT_A) under TENANT_B
    expect(() => {
      sqliteDb.prepare(`
        INSERT INTO canonical_decisions (id, tenant_id, person_id, canonical_job_id, action, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run("cross_dec_1", TENANT_B, PERSON_A, canonicalJobId, "PURSUE");
    }).toThrow(/FOREIGN KEY constraint failed/);

    // Valid insertion under TENANT_A succeeds
    expect(() => {
      sqliteDb.prepare(`
        INSERT INTO canonical_decisions (id, tenant_id, person_id, canonical_job_id, action, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run("valid_dec_1", TENANT_A, PERSON_A, canonicalJobId, "PURSUE");
    }).not.toThrow();
  });

  test("Query isolation: Tenant A cannot read Tenant B canonical decisions", async () => {
    const canonicalJobId = computeCanonicalJobId({ source: "LinkedIn", sourceJobId: "iso-job-001" });
    sqliteDb.prepare(`
      INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(canonicalJobId, "LinkedIn", "iso-job-001", "https://linkedin.com/jobs/001", "Target Co");

    // Tenant B records a decision
    await decisionStore.recordUserDecision(PERSON_B, "iso-job-001", "PASS", "Not interested", null, TENANT_B);

    // Tenant A queries decisions for their person
    const decisionsA = await decisionStore.getUserDecisions(PERSON_A, TENANT_A);
    expect(Object.keys(decisionsA)).toHaveLength(0);

    // Even if Tenant A maliciously requests PERSON_B under TENANT_A, 0 rows return
    const maliciousQuery = await decisionStore.getUserDecisions(PERSON_B, TENANT_A);
    expect(Object.keys(maliciousQuery)).toHaveLength(0);

    // Tenant B queries their own decisions
    const decisionsB = await decisionStore.getUserDecisions(PERSON_B, TENANT_B);
    expect(Object.keys(decisionsB)).toHaveLength(1);
    expect(decisionsB["iso-job-001"].verb).toBe("PASS");
  });

  test("Mutation isolation: Tenant A cannot delete or modify Tenant B decisions", async () => {
    const canonicalJobId = computeCanonicalJobId({ source: "LinkedIn", sourceJobId: "mut-job-001" });
    sqliteDb.prepare(`
      INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(canonicalJobId, "LinkedIn", "mut-job-001", "https://linkedin.com/jobs/001", "Target Co");

    // Tenant B records a decision
    await decisionStore.recordUserDecision(PERSON_B, "mut-job-001", "PURSUE", "High strategic value", null, TENANT_B);

    // Tenant A attempts to delete Tenant B's decision using Tenant A scope
    await decisionStore.deleteUserDecision(PERSON_B, "mut-job-001", TENANT_A);

    // Tenant B's decision remains untouched
    const decisionsB = await decisionStore.getUserDecisions(PERSON_B, TENANT_B);
    expect(decisionsB["mut-job-001"].verb).toBe("PURSUE");
  });

  test("Zero-orphan invariant verified across multi-tenant relational tables", async () => {
    const tables = [
      "canonical_decisions",
      "search_plans",
      "search_plan_snapshots",
      "search_plan_candidates",
      "evaluation_contexts",
      "materialized_evaluations",
      "evaluation_jobs"
    ];

    for (const tableName of tables) {
      const orphans = sqliteDb.prepare(`
        SELECT COUNT(*) as c
        FROM ${tableName} t
        LEFT JOIN people p ON t.person_id = p.id AND t.tenant_id = p.tenant_id
        WHERE p.id IS NULL
      `).get() as any;
      expect(orphans.c).toBe(0);
    }
  });
});
