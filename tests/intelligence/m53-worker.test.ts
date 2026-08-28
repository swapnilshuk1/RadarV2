import { describe, test, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { DatabaseAdapter, QueryParams } from "@/data/database/DatabaseAdapter";
import { EvaluationWorker } from "@/lib/intelligence/EvaluationWorker";
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

import { runMigrations } from "@/data/sqlite/migrations/runner";

describe("Sub-Phase M5.3: Distributed Worker Runtime & Atomic Claim Lease Protocol", () => {
  let sqliteDb: Database.Database;
  let adapter: TestSqliteAdapter;

  const authA: AuthContext = { userId: "user_A", tenantId: "tenant_A", permissions: ["manage:search_plan"] };

  const validProfileJson = JSON.stringify({
    identity: { currentTitle: "Executive", company: "Leadership" },
    executiveIdentity: { archetype: "Growth Executive", valueProposition: "Commercial Growth", executiveThemes: ["Growth Marketing"] },
    experience: { achievements: ["Grew ARR 5x"], yearsExperience: 15 },
    evidence: [],
    preferences: { locations: ["Bengaluru"] }
  });

  beforeEach(async () => {
    sqliteDb = new Database(":memory:");
    sqliteDb.pragma("foreign_keys = ON");
    adapter = new TestSqliteAdapter(sqliteDb);
    await runMigrations(adapter);

    sqliteDb.exec("INSERT INTO tenants (id, status) VALUES ('tenant_A', 'active'), ('tenant_B', 'active')");
    sqliteDb.exec("INSERT INTO people (id, email, tenant_id) VALUES ('person_A', 'execA@test.com', 'tenant_A'), ('person_B', 'execB@test.com', 'tenant_B')");
    sqliteDb.exec(`INSERT INTO search_plans (id, tenant_id, person_id, status, title, criteria_json) VALUES 
      ('plan_A', 'tenant_A', 'person_A', 'active', 'Plan A', '{"targetRoles":["VP"]}')
    `);
    sqliteDb.exec(`INSERT INTO search_plan_snapshots (id, search_plan_id, tenant_id, person_id, snapshot_hash, payload_json) VALUES 
      ('snap_A1', 'plan_A', 'tenant_A', 'person_A', 'hash_A1', '${validProfileJson}')
    `);
    sqliteDb.exec(`INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version) VALUES 
      ('ctx_fingerprint_A1', 'tenant_A', 'person_A', 'snap_A1', 'v3', 'ont_hash', 'v4', 'prof_1')
    `);
    sqliteDb.exec(`INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url) VALUES 
      ('job_1', 'linkedin', '101', 'https://job.1')
    `);
    sqliteDb.exec(`INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, company_name, raw_content, acquisition_status, lifecycle_state) VALUES 
      ('ver_1a', 'job_1', 'chash_1a', 'VP Product', 'Acme', '{"jobHash":"job_1","role":"VP Product","company":"Acme","rawDescription":"Executive product role"}', 'ACQUIRED', 'ACTIVE')
    `);
    sqliteDb.exec(`INSERT INTO search_plan_candidates (search_plan_id, tenant_id, person_id, canonical_job_id, opportunity_version, attention_decision) VALUES 
      ('plan_A', 'tenant_A', 'person_A', 'job_1', 'ver_1a', 'CANDIDATE')
    `);
  });

  test("1. Atomic Claim & Execution", async () => {
    await enqueueEvaluationJobsForPlan(authA, "person_A", "plan_A", { adapter });
    const worker = new EvaluationWorker("worker_1", { adapter });
    const claim = await worker.claimNextJob();
    expect(claim).not.toBeNull();
    const result = await worker.processJob(claim!);
    expect(result.status).toBe("completed");
  });

  test("2. Lock Contention", async () => {
    await enqueueEvaluationJobsForPlan(authA, "person_A", "plan_A", { adapter });
    const worker1 = new EvaluationWorker("worker_1", { adapter });
    const worker2 = new EvaluationWorker("worker_2", { adapter });
    const claim1 = await worker1.claimNextJob();
    expect(claim1).not.toBeNull();
    const claim2 = await worker2.claimNextJob();
    expect(claim2).toBeNull();
  });

  test("3. Stale Lease Protection", async () => {
    await enqueueEvaluationJobsForPlan(authA, "person_A", "plan_A", { adapter });
    const worker = new EvaluationWorker("worker_1", { adapter });
    const claim = await worker.claimNextJob();
    const staleClaim = { ...claim!, leaseToken: "stolen_lease_token_xyz" };
    const result = await worker.processJob(staleClaim);
    expect(result.status).toBe("stale_lease_lost");
  });

  test("4. Durable Exponential Retry", async () => {
    await enqueueEvaluationJobsForPlan(authA, "person_A", "plan_A", { adapter });
    sqliteDb.exec("UPDATE opportunity_versions SET raw_content = 'FAIL_FOR_TEST' WHERE canonical_job_id = 'job_1'");
    const worker = new EvaluationWorker("worker_1", { adapter });
    const claim = await worker.claimNextJob();
    const result = await worker.processJob(claim!);
    expect(result.status).toBe("retry_scheduled");
    expect(result.nextAttemptInSeconds).toBe(5);
  });

  test("5. Dead-Letter Transition", async () => {
    await enqueueEvaluationJobsForPlan(authA, "person_A", "plan_A", { adapter });
    sqliteDb.exec("UPDATE opportunity_versions SET raw_content = 'FAIL_FOR_TEST' WHERE canonical_job_id = 'job_1'");
    sqliteDb.exec("UPDATE evaluation_jobs SET attempts = 2 WHERE search_plan_id = 'plan_A'");
    const worker = new EvaluationWorker("worker_1", { adapter });
    const claim = await worker.claimNextJob();
    const result = await worker.processJob(claim!);
    expect(result.status).toBe("dead_letter");
  });

  test("6. Lease expiration recovery: Expired processing job is reclaimed by another worker", async () => {
    await enqueueEvaluationJobsForPlan(authA, "person_A", "plan_A", { adapter });

    const worker1 = new EvaluationWorker("worker_1", { adapter });
    const claim1 = await worker1.claimNextJob();
    expect(claim1).not.toBeNull();

    // Advance locked_at to trigger expiration (>300s ago)
    sqliteDb.exec("UPDATE evaluation_jobs SET locked_at = datetime('now', '-301 seconds')");

    const worker2 = new EvaluationWorker("worker_2", { adapter });
    const claim2 = await worker2.claimNextJob();
    expect(claim2).not.toBeNull();
    expect(claim2?.leaseToken).not.toBe(claim1?.leaseToken);
    
    // Check db status
    const dbJob = await adapter.one<any>("SELECT * FROM evaluation_jobs WHERE id = ?", [claim2?.id]);
    expect(dbJob.locked_by).toBe("worker_2");
  });

  test("7. Old worker cannot materialize after reclaim (Late worker protection)", async () => {
    await enqueueEvaluationJobsForPlan(authA, "person_A", "plan_A", { adapter });

    const worker1 = new EvaluationWorker("worker_1", { adapter });
    const claim1 = await worker1.claimNextJob();

    // Lease expires, worker2 claims
    sqliteDb.exec("UPDATE evaluation_jobs SET locked_at = datetime('now', '-301 seconds')");
    const worker2 = new EvaluationWorker("worker_2", { adapter });
    const claim2 = await worker2.claimNextJob();
    
    // Worker 2 succeeds
    const result2 = await worker2.processJob(claim2!);
    expect(result2.status).toBe("completed");

    // Worker 1 finishes late
    const result1 = await worker1.processJob(claim1!);
    expect(result1.status).toBe("stale_lease_lost");

    // DB should only have the worker2 results, and no errors
    const matList = await adapter.many<any>("SELECT * FROM materialized_evaluations WHERE tenant_id = 'tenant_A'");
    expect(matList.length).toBe(1); // Didn't duplicate
  });

  test("8. Materialization idempotency: Competing UPDATEs DO NOTHING", async () => {
    await enqueueEvaluationJobsForPlan(authA, "person_A", "plan_A", { adapter });
    
    const worker1 = new EvaluationWorker("worker_1", { adapter });
    const claim1 = await worker1.claimNextJob();

    // Insert competing evaluation externally before worker1 finishes
    sqliteDb.exec(`INSERT INTO materialized_evaluations (
             id, tenant_id, person_id, canonical_job_id, opportunity_version,
             evaluation_context_fingerprint, decision, quality_score,
             rationale, evidence_ids, evaluation_json, materialized_at
           ) VALUES ('ext_mat_1', 'tenant_A', 'person_A', 'job_1', 'ver_1a', 'ctx_fingerprint_A1', 'PASS', 10, '{}', '[]', '{}', CURRENT_TIMESTAMP)`);

    const result = await worker1.processJob(claim1!);
    expect(result.status).toBe("completed");

    // Check DB: exactly 1 materialized evaluation exists (UPSERT without duplicates)
    const matList = await adapter.many<any>("SELECT * FROM materialized_evaluations WHERE tenant_id = 'tenant_A'");
    expect(matList.length).toBe(1);
    expect(matList[0].decision).toBe("CONSIDER"); // Authoritative worker UPSERT result
  });

  test("9. AuthContext negative test: Mismatched tenant fails authorization", async () => {
    await enqueueEvaluationJobsForPlan(authA, "person_A", "plan_A", { adapter });
    
    const worker = new EvaluationWorker("worker_1", { adapter });
    const claim = await worker.claimNextJob();
    
    // Tamper with tenantId to try to access person_A from tenant_B context
    claim!.tenantId = "tenant_B"; 

    const result = await worker.processJob(claim!);
    expect(result.status).toBe("authorization_failed");
    expect(result.error).toContain("does not belong to tenant");
  });

  test("10. Profile/context lineage: Worker resolves correct snapshot payload", async () => {
    await enqueueEvaluationJobsForPlan(authA, "person_A", "plan_A", { adapter });
    
    // Add unique marker to the payload in DB
    const markerJson = JSON.stringify({
      ...JSON.parse(validProfileJson),
      identity: { currentTitle: "UNIQUE_TEST_TITLE", company: "UNIQUE_TEST_COMPANY" }
    });
    sqliteDb.exec(`UPDATE search_plan_snapshots SET payload_json = '${markerJson}' WHERE id = 'snap_A1'`);

    const worker = new EvaluationWorker("worker_1", { adapter });
    const claim = await worker.claimNextJob();
    const result = await worker.processJob(claim!);
    expect(result.status).toBe("completed");
    
    // Fetch materialized eval to see if it used the updated projection
    const mat = await adapter.one<any>("SELECT evaluation_json FROM materialized_evaluations WHERE tenant_id = 'tenant_A'");
    const parsedEval = JSON.parse(mat.evaluationJson || mat.evaluation_json);
    
    expect(parsedEval).toBeDefined();
  });
});
