/**
 * Sub-Phase M5.1 — Durable Evaluation Work Queue Schema & Lineage Integration Tests
 */
import { describe, test, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { DatabaseAdapter, QueryParams } from "@/data/database/DatabaseAdapter";

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

describe("Sub-Phase M5.1: Durable Evaluation Work Queue Schema & Composite Invariants", () => {
  let sqliteDb: Database.Database;
  let adapter: TestSqliteAdapter;

  beforeEach(() => {
    sqliteDb = new Database(":memory:");
    sqliteDb.pragma("foreign_keys = ON");

    const migrationFiles = [
      "001_initial_schema.sql",
      "009_profile_queryable_columns.sql",
      "018_multi_tenant_foundation.sql",
      "019_evaluation_context_and_read_model.sql",
      "020_canonical_acquisition.sql",
      "021_evaluation_work_queue.sql"
    ];

    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(process.cwd(), "src/data/sqlite/migrations", file), "utf-8");
      sqliteDb.exec(sql);
    }

    // Seed Tenant A & Person A & Plan A
    sqliteDb.exec("INSERT INTO tenants (id, status) VALUES ('tenant_A', 'active'), ('tenant_B', 'active')");
    sqliteDb.exec("INSERT INTO people (id, email, tenant_id) VALUES ('person_A', 'execA@test.com', 'tenant_A'), ('person_B', 'execB@test.com', 'tenant_B')");
    sqliteDb.exec(`INSERT INTO search_plans (id, tenant_id, person_id, status, title, criteria_json) VALUES 
      ('plan_A', 'tenant_A', 'person_A', 'active', 'Plan A', '{"targetRoles":["VP"]}'),
      ('plan_B', 'tenant_B', 'person_B', 'active', 'Plan B', '{"targetRoles":["Director"]}')
    `);

    // Seed Canonical Job 1 & Version 1
    sqliteDb.exec(`INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url) VALUES 
      ('job_1', 'linkedin', '101', 'https://job.1')
    `);
    sqliteDb.exec(`INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, company_name, raw_content) VALUES 
      ('ver_1', 'job_1', 'chash_1', 'VP Product', 'Acme', 'JD Content')
    `);

    // Seed Search Plan Candidate for Tenant A / Person A / Plan A / Job 1 / Version 1
    sqliteDb.exec(`INSERT INTO search_plan_candidates (search_plan_id, tenant_id, person_id, canonical_job_id, opportunity_version, attention_decision) VALUES 
      ('plan_A', 'tenant_A', 'person_A', 'job_1', 'ver_1', 'CANDIDATE')
    `);

    adapter = new TestSqliteAdapter(sqliteDb);
  });

  test("1. Migration 021 creates evaluation_jobs table with expected columns and defaults", async () => {
    const columns = await adapter.many<{ name: string; dflt_value: any }>(
      "PRAGMA table_info(evaluation_jobs)"
    );

    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain("id");
    expect(colNames).toContain("tenant_id");
    expect(colNames).toContain("person_id");
    expect(colNames).toContain("search_plan_id");
    expect(colNames).toContain("canonical_job_id");
    expect(colNames).toContain("opportunity_version");
    expect(colNames).toContain("evaluation_context_fingerprint");
    expect(colNames).toContain("status");
    expect(colNames).toContain("attempts");
    expect(colNames).toContain("max_attempts");
    expect(colNames).toContain("next_attempt_at");
    expect(colNames).toContain("last_error");
    expect(colNames).toContain("locked_by");
    expect(colNames).toContain("lease_token");
    expect(colNames).toContain("locked_at");
    expect(colNames).toContain("completed_at");

    // Test default values
    await adapter.execute(`
      INSERT INTO evaluation_jobs (id, tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
      VALUES ('job_eval_1', 'tenant_A', 'person_A', 'plan_A', 'job_1', 'ver_1', 'ctx_fingerprint_1')
    `);

    const row = await adapter.one<any>("SELECT * FROM evaluation_jobs WHERE id = 'job_eval_1'");
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(0);
    expect(row.max_attempts).toBe(3);
    expect(row.next_attempt_at).toBeTruthy();
  });

  test("2. Composite Tenant / Person FK Lineage: Rejects job if person_id belongs to a different tenant", async () => {
    // Attempt inserting with tenant_A but person_B (which belongs to tenant_B)
    expect(() => {
      sqliteDb.exec(`
        INSERT INTO evaluation_jobs (id, tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
        VALUES ('eval_mismatch_1', 'tenant_A', 'person_B', 'plan_A', 'job_1', 'ver_1', 'ctx_1')
      `);
    }).toThrow(/FOREIGN KEY constraint failed/);
  });

  test("3. Composite SearchPlan FK Lineage: Rejects job if search_plan_id belongs to a different person/tenant", async () => {
    // Attempt inserting with plan_B (which belongs to tenant_B/person_B) for tenant_A/person_A
    expect(() => {
      sqliteDb.exec(`
        INSERT INTO evaluation_jobs (id, tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
        VALUES ('eval_mismatch_2', 'tenant_A', 'person_A', 'plan_B', 'job_1', 'ver_1', 'ctx_1')
      `);
    }).toThrow(/FOREIGN KEY constraint failed/);
  });

  test("4. Composite Canonical Job / Version FK Lineage: Rejects job if opportunity_version belongs to a different canonical job", async () => {
    // Seed job_2 with ver_2
    sqliteDb.exec("INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url) VALUES ('job_2', 'naukri', '202', 'https://job.2')");
    sqliteDb.exec("INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, company_name, raw_content) VALUES ('ver_2', 'job_2', 'chash_2', 'VP Eng', 'Beta', 'JD Content 2')");
    sqliteDb.exec("INSERT INTO search_plan_candidates (search_plan_id, tenant_id, person_id, canonical_job_id, opportunity_version, attention_decision) VALUES ('plan_A', 'tenant_A', 'person_A', 'job_2', 'ver_2', 'CANDIDATE')");

    // Attempt inserting evaluation_jobs with job_1 + ver_2 (where ver_2 belongs to job_2)
    expect(() => {
      sqliteDb.exec(`
        INSERT INTO evaluation_jobs (id, tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
        VALUES ('eval_mismatch_3', 'tenant_A', 'person_A', 'plan_A', 'job_1', 'ver_2', 'ctx_1')
      `);
    }).toThrow(/FOREIGN KEY constraint failed/);
  });

  test("5. Composite Candidate Provenance FK: Rejects job if no candidate record exists in search_plan_candidates", async () => {
    // Attempt inserting evaluation job for job_1/ver_1 under plan_B (tenant_B/person_B) without a search_plan_candidate row
    expect(() => {
      sqliteDb.exec(`
        INSERT INTO evaluation_jobs (id, tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
        VALUES ('eval_unprovenanced', 'tenant_B', 'person_B', 'plan_B', 'job_1', 'ver_1', 'ctx_1')
      `);
    }).toThrow(/FOREIGN KEY constraint failed/);
  });

  test("6. Deduplication Constraint: Rejects duplicate evaluation job for identical context fingerprint", async () => {
    await adapter.execute(`
      INSERT INTO evaluation_jobs (id, tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
      VALUES ('job_eval_A', 'tenant_A', 'person_A', 'plan_A', 'job_1', 'ver_1', 'ctx_shared')
    `);

    // Duplicate insertion with same tenant, plan, job, version, and context fingerprint must fail
    expect(() => {
      sqliteDb.exec(`
        INSERT INTO evaluation_jobs (id, tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
        VALUES ('job_eval_B', 'tenant_A', 'person_A', 'plan_A', 'job_1', 'ver_1', 'ctx_shared')
      `);
    }).toThrow(/UNIQUE constraint failed/);
  });

  test("7. PRAGMA foreign_keys = ON is mechanically verified", async () => {
    const fkStatus = await adapter.one<{ foreign_keys: number }>("PRAGMA foreign_keys");
    expect(fkStatus?.foreign_keys).toBe(1);
  });
});
