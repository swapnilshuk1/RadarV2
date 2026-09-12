/**
 * Sub-Phase M5.2 — Work Enqueuer & Idempotent Projection Sync Unit & Integration Tests
 */
import { describe, test, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { DatabaseAdapter, QueryParams } from "@/data/database/DatabaseAdapter";
import { enqueueEvaluationJobsForPlan } from "@/lib/intelligence/enqueueEvaluationJobs";
import type { AuthContext } from "@/lib/security/auth";

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

describe("Sub-Phase M5.2: Work Enqueuer & Idempotent Projection Sync", () => {
  let sqliteDb: Database.Database;
  let adapter: TestSqliteAdapter;

  const authA: AuthContext = { userId: "user_A", tenantId: "tenant_A", permissions: ["manage:search_plan"] };
  const authB: AuthContext = { userId: "user_B", tenantId: "tenant_B", permissions: ["manage:search_plan"] };

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

    adapter = new TestSqliteAdapter(sqliteDb);

    // Seed Tenant A, Person A, Plan A
    sqliteDb.exec("INSERT INTO tenants (id, status) VALUES ('tenant_A', 'active'), ('tenant_B', 'active')");
    sqliteDb.exec("INSERT INTO people (id, email, tenant_id) VALUES ('person_A', 'execA@test.com', 'tenant_A'), ('person_B', 'execB@test.com', 'tenant_B')");
    sqliteDb.exec(`INSERT INTO search_plans (id, tenant_id, person_id, status, title, criteria_json) VALUES 
      ('plan_A', 'tenant_A', 'person_A', 'active', 'Plan A', '{"targetRoles":["VP"]}'),
      ('plan_B', 'tenant_B', 'person_B', 'active', 'Plan B', '{"targetRoles":["Director"]}')
    `);

    // Seed Snapshot A & Context A (Phase M3)
    sqliteDb.exec(`INSERT INTO search_plan_snapshots (id, search_plan_id, tenant_id, person_id, snapshot_hash, payload_json) VALUES 
      ('snap_A1', 'plan_A', 'tenant_A', 'person_A', 'hash_A1', '{"criteria": "VP"}'),
      ('snap_B1', 'plan_B', 'tenant_B', 'person_B', 'hash_B1', '{"criteria": "Director"}')
    `);
    sqliteDb.exec(`INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version) VALUES 
      ('ctx_fingerprint_A1', 'tenant_A', 'person_A', 'snap_A1', 'v3', 'ont_hash', 'v4', 'prof_1'),
      ('ctx_fingerprint_B1', 'tenant_B', 'person_B', 'snap_B1', 'v3', 'ont_hash', 'v4', 'prof_2')
    `);

    // Seed Canonical Opportunities & Versions (Phase M4)
    sqliteDb.exec(`INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url) VALUES 
      ('job_1', 'linkedin', '101', 'https://job.1'),
      ('job_2', 'naukri', '202', 'https://job.2')
    `);
    sqliteDb.exec(`INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, company_name, raw_content) VALUES 
      ('ver_1a', 'job_1', 'chash_1a', 'VP Product', 'Acme', 'JD Content 1a'),
      ('ver_1b', 'job_1', 'chash_1b', 'VP Product Updated', 'Acme', 'JD Content 1b'),
      ('ver_2a', 'job_2', 'chash_2a', 'Director Eng', 'Beta', 'JD Content 2a')
    `);

    // Seed Search Plan Candidates for Tenant A & Tenant B
    sqliteDb.exec(`INSERT INTO search_plan_candidates (search_plan_id, tenant_id, person_id, canonical_job_id, opportunity_version, attention_decision) VALUES 
      ('plan_A', 'tenant_A', 'person_A', 'job_1', 'ver_1a', 'CANDIDATE'),
      ('plan_A', 'tenant_A', 'person_A', 'job_2', 'ver_2a', 'NOT_CANDIDATE'),
      ('plan_B', 'tenant_B', 'person_B', 'job_1', 'ver_1a', 'CANDIDATE')
    `);
  });

  test("1. Positive: CANDIDATE projection enqueues exactly one evaluation_job", async () => {
    const result = await enqueueEvaluationJobsForPlan(authA, "person_A", "plan_A", { adapter });

    expect(result.enqueuedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
    expect(result.ignoredNotCandidateCount).toBe(1); // job_2 is NOT_CANDIDATE
    expect(result.evaluationContextFingerprint).toBe("ctx_fingerprint_A1");

    // Verify queue row in SQLite
    const jobs = await adapter.many<any>("SELECT * FROM evaluation_jobs WHERE tenant_id = 'tenant_A'");
    expect(jobs.length).toBe(1);
    expect(jobs[0].canonical_job_id).toBe("job_1");
    expect(jobs[0].opportunity_version).toBe("ver_1a");
    expect(jobs[0].evaluation_context_fingerprint).toBe("ctx_fingerprint_A1");
    expect(jobs[0].status).toBe("pending");
    expect(jobs[0].attempts).toBe(0);
  });

  test("2. Idempotency: Submitting identical candidate/context twice produces 0 duplicate jobs", async () => {
    // First run
    const res1 = await enqueueEvaluationJobsForPlan(authA, "person_A", "plan_A", { adapter });
    expect(res1.enqueuedCount).toBe(1);

    // Second run with same context and candidate
    const res2 = await enqueueEvaluationJobsForPlan(authA, "person_A", "plan_A", { adapter });
    expect(res2.enqueuedCount).toBe(0);
    expect(res2.skippedCount).toBe(1);

    // Total jobs in DB remains exactly 1
    const totalJobs = await adapter.many("SELECT * FROM evaluation_jobs WHERE tenant_id = 'tenant_A'");
    expect(totalJobs.length).toBe(1);
  });

  test("3. Version Change: Enqueuing a new opportunity version creates a new evaluation job", async () => {
    await enqueueEvaluationJobsForPlan(authA, "person_A", "plan_A", { adapter });

    // Update candidate to ver_1b
    sqliteDb.exec(`INSERT INTO search_plan_candidates (search_plan_id, tenant_id, person_id, canonical_job_id, opportunity_version, attention_decision) VALUES 
      ('plan_A', 'tenant_A', 'person_A', 'job_1', 'ver_1b', 'CANDIDATE')
    `);

    const res2 = await enqueueEvaluationJobsForPlan(authA, "person_A", "plan_A", { adapter });
    expect(res2.enqueuedCount).toBe(1); // new version ver_1b enqueued

    const totalJobs = await adapter.many("SELECT * FROM evaluation_jobs WHERE tenant_id = 'tenant_A'");
    expect(totalJobs.length).toBe(2);
  });

  test("4. Context Change: Enqueuing with a new EvaluationContext snapshot creates a new evaluation job", async () => {
    await enqueueEvaluationJobsForPlan(authA, "person_A", "plan_A", { adapter });

    // Add new snapshot and context for plan_A
    sqliteDb.exec(`INSERT INTO search_plan_snapshots (id, search_plan_id, tenant_id, person_id, snapshot_hash, payload_json) VALUES 
      ('snap_A2', 'plan_A', 'tenant_A', 'person_A', 'hash_A2', '{"criteria": "VP updated"}')
    `);
    sqliteDb.exec(`INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version) VALUES 
      ('ctx_fingerprint_A2', 'tenant_A', 'person_A', 'snap_A2', 'v3', 'ont_hash', 'v4', 'prof_1')
    `);

    const res2 = await enqueueEvaluationJobsForPlan(authA, "person_A", "plan_A", { adapter });
    expect(res2.enqueuedCount).toBe(1);
    expect(res2.evaluationContextFingerprint).toBe("ctx_fingerprint_A2");

    const totalJobs = await adapter.many("SELECT * FROM evaluation_jobs WHERE tenant_id = 'tenant_A'");
    expect(totalJobs.length).toBe(2);
  });

  test("5. Multi-Tenant Independence: Tenant A and Tenant B enqueue identical canonical job independently", async () => {
    const resA = await enqueueEvaluationJobsForPlan(authA, "person_A", "plan_A", { adapter });
    const resB = await enqueueEvaluationJobsForPlan(authB, "person_B", "plan_B", { adapter });

    expect(resA.enqueuedCount).toBe(1);
    expect(resB.enqueuedCount).toBe(1);

    const jobsA = await adapter.many("SELECT * FROM evaluation_jobs WHERE tenant_id = 'tenant_A'");
    const jobsB = await adapter.many("SELECT * FROM evaluation_jobs WHERE tenant_id = 'tenant_B'");

    expect(jobsA.length).toBe(1);
    expect(jobsB.length).toBe(1);
    expect(jobsA[0].canonical_job_id).toBe("job_1");
    expect(jobsB[0].canonical_job_id).toBe("job_1");
  });

  test("6. Negative: NOT_CANDIDATE projection is ignored", async () => {
    // Plan with only NOT_CANDIDATE candidate
    sqliteDb.exec("DELETE FROM search_plan_candidates WHERE search_plan_id = 'plan_A'");
    sqliteDb.exec(`INSERT INTO search_plan_candidates (search_plan_id, tenant_id, person_id, canonical_job_id, opportunity_version, attention_decision) VALUES 
      ('plan_A', 'tenant_A', 'person_A', 'job_2', 'ver_2a', 'NOT_CANDIDATE')
    `);

    const result = await enqueueEvaluationJobsForPlan(authA, "person_A", "plan_A", { adapter });
    expect(result.enqueuedCount).toBe(0);
    expect(result.ignoredNotCandidateCount).toBe(1);

    const jobs = await adapter.many("SELECT * FROM evaluation_jobs WHERE tenant_id = 'tenant_A'");
    expect(jobs.length).toBe(0);
  });

  test("7. Negative: Cross-tenant AuthContext mismatch throws authorization error", async () => {
    // Attempting to enqueue person_B (belonging to tenant_B) using Tenant A AuthContext
    await expect(enqueueEvaluationJobsForPlan(authA, "person_B", "plan_B", { adapter })).rejects.toThrow(
      /Access denied. Person person_B does not belong to tenant tenant_A/
    );
  });

  test("8. Negative: Missing EvaluationContext throws error (M5.2 consumes existing contexts only)", async () => {
    // Plan C with candidate but NO evaluation_contexts row
    sqliteDb.exec("INSERT INTO search_plans (id, tenant_id, person_id, status, title, criteria_json) VALUES ('plan_C', 'tenant_A', 'person_A', 'active', 'Plan C', '{}')");
    sqliteDb.exec("INSERT INTO search_plan_candidates (search_plan_id, tenant_id, person_id, canonical_job_id, opportunity_version, attention_decision) VALUES ('plan_C', 'tenant_A', 'person_A', 'job_1', 'ver_1a', 'CANDIDATE')");

    await expect(enqueueEvaluationJobsForPlan(authA, "person_A", "plan_C", { adapter })).rejects.toThrow(
      /No pre-existing EvaluationContext found/
    );
  });
});
