import { describe, test, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { EvaluationWorker, ClaimedJob } from "../../src/lib/intelligence/EvaluationWorker";
import { DatabaseAdapter, QueryParams } from "../../src/data/database";
import { type CandidateProjection } from "../../src/lib/domain/candidate_projection";
import { TenantScopedPersonStore } from "../../src/data/sqlite/repositories/TenantScopedPersonStore";
import * as staticProfileModule from "../../src/data/candidate-profile";

class TestSqliteAdapter implements DatabaseAdapter {
  constructor(private db: InstanceType<typeof Database>) {}

  async one<T>(sql: string, params: QueryParams = []): Promise<T | null> {
    const stmt = this.db.prepare(sql);
    const row = stmt.get(...(params as any[]));
    return (row as T) || null;
  }

  async many<T>(sql: string, params: QueryParams = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...(params as any[]));
    return (rows as T[]) || [];
  }

  async execute(sql: string, params: QueryParams = []): Promise<{ rowsAffected: number; lastInsertRowid?: number | bigint | string }> {
    const stmt = this.db.prepare(sql);
    const result = stmt.run(...(params as any[]));
    return {
      rowsAffected: result.changes,
      lastInsertRowid: result.lastInsertRowid
    };
  }

  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

const sampleRawOpp = JSON.stringify({
  jobId: "opp_canon_1",
  title: "VP Growth",
  company: "Acme Enterprise Corp",
  location: "Bengaluru, India",
  description: "We are seeking a VP of Growth to lead our commercial expansion, digital transformation, and marketing strategy. 15+ years experience required.",
  datePosted: "2026-08-01",
  portal: "indeed"
});

const projectionCCO: CandidateProjection = {
  operatingLevel: { value: "STRATEGIC", confidence: 0.95, evidenceIds: ["ev_1"] },
  workNature: { value: "STRATEGIC_WORK", confidence: 0.95, evidenceIds: ["ev_2"] },
  decisionAuthority: { value: "ENTERPRISE", confidence: 0.95, evidenceIds: ["ev_3"] },
  commercialScope: { value: "ENTERPRISE", confidence: 0.95, evidenceIds: ["ev_4"] },
  yearsOfExperience: 22,
  coreCapabilities: ["COMMERCIAL_GROWTH", "GLOBAL_GTM", "MARKETING_LEADERSHIP", "P_AND_L_MANAGEMENT"],
  preferredLocations: ["Bengaluru", "Remote"],
  preferredWorkModel: "HYBRID",
  executiveThemes: ["commercial_growth", "gtm_scale"],
  attentionWindow: 6,
  headspaceCapacityPerMonth: 4,
};

const projectionCTO: CandidateProjection = {
  operatingLevel: { value: "STRATEGIC", confidence: 0.95, evidenceIds: ["ev_5"] },
  workNature: { value: "STRATEGIC_WORK", confidence: 0.95, evidenceIds: ["ev_6"] },
  decisionAuthority: { value: "ENTERPRISE", confidence: 0.95, evidenceIds: ["ev_7"] },
  commercialScope: { value: "NONE", confidence: 0.95, evidenceIds: ["ev_8"] },
  yearsOfExperience: 18,
  coreCapabilities: ["SOFTWARE_ENGINEERING", "SYSTEM_ARCHITECTURE", "CLOUD_INFRASTRUCTURE", "TECH_LEADERSHIP"],
  preferredLocations: ["San Francisco", "Remote"],
  preferredWorkModel: "REMOTE",
  executiveThemes: ["cloud_infrastructure", "engineering_scale"],
  attentionWindow: 4,
  headspaceCapacityPerMonth: 2,
};

describe("M10 Phase 2: Authoritative Candidate Profile Resolution in EvaluationWorker", () => {
  let sqliteDb: InstanceType<typeof Database>;
  let adapter: DatabaseAdapter;
  let worker: EvaluationWorker;

  beforeEach(() => {
    sqliteDb = new Database(":memory:");
    sqliteDb.pragma("foreign_keys = OFF");

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
    worker = new EvaluationWorker("test_worker_1", { adapter });

    // Seed baseline tenants and people
    sqliteDb.exec("INSERT INTO tenants (id, status) VALUES ('tenant_alpha', 'active')");
    sqliteDb.exec("INSERT INTO tenants (id, status) VALUES ('tenant_beta', 'active')");

    sqliteDb.exec("INSERT INTO people (id, email, tenant_id) VALUES ('user_alpha', 'cco@alpha.internal', 'tenant_alpha')");
    sqliteDb.exec("INSERT INTO people (id, email, tenant_id) VALUES ('user_beta', 'cto@beta.internal', 'tenant_beta')");

    // Seed authoritative career_profiles projections
    seedCandidateProjection("user_alpha", "tenant_alpha", projectionCCO, "Chief Commercial Officer");
    seedCandidateProjection("user_beta", "tenant_beta", projectionCTO, "Chief Technology Officer");

    // Seed company, canonical opp, version, and search plans
    sqliteDb.exec("INSERT INTO companies (id, name) VALUES ('comp_1', 'Acme Enterprise Corp')");
    sqliteDb.exec("INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name) VALUES ('opp_canon_1', 'indeed', 'src_job_1', 'https://example.com/job1', 'Acme Enterprise Corp')");
    sqliteDb.exec(`INSERT INTO opportunity_versions (id, canonical_job_id, job_title, company_name, location, raw_content, content_hash) 
      VALUES ('v1_opp_1', 'opp_canon_1', 'VP Growth', 'Acme Enterprise Corp', 'Bengaluru, India', '${sampleRawOpp.replace(/'/g, "''")}', 'hash_v1')
    `);

    sqliteDb.exec(`INSERT INTO search_plans (id, tenant_id, person_id, status, title, criteria_json) 
      VALUES ('plan_alpha', 'tenant_alpha', 'user_alpha', 'active', 'Alpha Plan', '{"targetRoles":["VP Growth"]}')
    `);
    sqliteDb.exec(`INSERT INTO search_plans (id, tenant_id, person_id, status, title, criteria_json) 
      VALUES ('plan_beta', 'tenant_beta', 'user_beta', 'active', 'Beta Plan', '{"targetRoles":["VP Engineering"]}')
    `);
  });

  function seedCandidateProjection(
    personId: string,
    tenantId: string,
    projection: CandidateProjection,
    title: string
  ) {
    sqliteDb.prepare(`
      INSERT INTO career_profiles (
        id, person_id, timeline, skills, projection_json, projection_generated_at,
        current_title, years_experience, archetype, preferred_work_model, created_at, updated_at
      ) VALUES (?, ?, '[]', '[]', ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET projection_json = excluded.projection_json
    `).run(
      `profile-${personId}`,
      personId,
      JSON.stringify(projection),
      title,
      projection.yearsOfExperience,
      projection.executiveThemes?.[0] || "",
      projection.preferredWorkModel || "ANY"
    );
  }

  function seedEvaluationContextAndJob(
    jobId: string,
    snapshotPayload: string,
    personId: string = "user_alpha",
    tenantId: string = "tenant_alpha",
    planId: string = "plan_alpha"
  ): ClaimedJob {
    const snapId = `snap_${jobId}`;
    const ctxFp = `ctx_fp_${jobId}`;
    const snapHash = `snap_hash_${jobId}`;
    
    sqliteDb.prepare(
      `INSERT INTO search_plan_snapshots (id, search_plan_id, tenant_id, person_id, snapshot_hash, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(snapId, planId, tenantId, personId, snapHash, snapshotPayload);

    sqliteDb.prepare(
      `INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version)
       VALUES (?, ?, ?, ?, '1.0', 'ont_fp', '1.0', 'prof_v1')`
    ).run(ctxFp, tenantId, personId, snapId);

    // Ensure candidate row exists for FK invariant
    sqliteDb.prepare(
      `INSERT OR IGNORE INTO search_plan_candidates (search_plan_id, tenant_id, person_id, canonical_job_id, opportunity_version, attention_decision)
       VALUES (?, ?, ?, 'opp_canon_1', 'v1_opp_1', 'CANDIDATE')`
    ).run(planId, tenantId, personId);

    sqliteDb.prepare(
      `INSERT INTO evaluation_jobs (
         id, tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version,
         evaluation_context_fingerprint, status, locked_by, lease_token, locked_at, attempts, max_attempts
       ) VALUES (?, ?, ?, ?, 'opp_canon_1', 'v1_opp_1', ?, 'processing', 'test_worker_1', 'lease_tok_123', CURRENT_TIMESTAMP, 0, 3)`
    ).run(jobId, tenantId, personId, planId, ctxFp);

    return {
      id: jobId,
      tenantId,
      personId,
      searchPlanId: planId,
      canonicalJobId: "opp_canon_1",
      opportunityVersion: "v1_opp_1",
      evaluationContextFingerprint: ctxFp,
      leaseToken: "lease_tok_123",
      attempts: 0,
      maxAttempts: 3
    };
  }

  // =========================================================================================
  // MANDATORY AUTHORITY BOUNDARY TESTS
  // =========================================================================================

  test("TEST 1: tenant A + person A -> resolves authoritative projection A (CCO)", async () => {
    const store = new TenantScopedPersonStore(adapter, { tenantId: "tenant_alpha", personId: "user_alpha" });
    const projection = await store.getLatestProjection("user_alpha");
    expect(projection).toBeDefined();
    expect(projection?.coreCapabilities).toContain("COMMERCIAL_GROWTH");
    expect(projection?.yearsOfExperience).toBe(22);
  });

  test("TEST 2: tenant B + person B -> resolves authoritative projection B (CTO)", async () => {
    const store = new TenantScopedPersonStore(adapter, { tenantId: "tenant_beta", personId: "user_beta" });
    const projection = await store.getLatestProjection("user_beta");
    expect(projection).toBeDefined();
    expect(projection?.coreCapabilities).toContain("SYSTEM_ARCHITECTURE");
    expect(projection?.yearsOfExperience).toBe(18);
  });

  test("TEST 3: tenant A + person A cannot resolve person B (cross-tenant isolation)", async () => {
    const store = new TenantScopedPersonStore(adapter, { tenantId: "tenant_alpha", personId: "user_alpha" });
    // Attempting to resolve person B under tenant A's scope must throw TenantIsolationError
    await expect(store.getLatestProjection("user_beta")).rejects.toThrow(/Access denied/);
  });

  test("TEST 4: Same SearchPlan snapshot '{}' evaluated for person A vs person B produces separate tenant-scoped evaluations", async () => {
    const jobA = seedEvaluationContextAndJob("job_alpha_eval", "{}", "user_alpha", "tenant_alpha", "plan_alpha");
    const jobB = seedEvaluationContextAndJob("job_beta_eval", "{}", "user_beta", "tenant_beta", "plan_beta");

    const resultA = await worker.processJob(jobA);
    const resultB = await worker.processJob(jobB);

    expect(resultA.status).toBe("completed");
    expect(resultB.status).toBe("completed");

    const matA = sqliteDb.prepare("SELECT * FROM materialized_evaluations WHERE tenant_id = 'tenant_alpha' AND person_id = 'user_alpha'").get() as any;
    const matB = sqliteDb.prepare("SELECT * FROM materialized_evaluations WHERE tenant_id = 'tenant_beta' AND person_id = 'user_beta'").get() as any;

    expect(matA).toBeDefined();
    expect(matB).toBeDefined();
    expect(matA.tenant_id).toBe("tenant_alpha");
    expect(matB.tenant_id).toBe("tenant_beta");
  });

  test("TEST 5: '{}' snapshot + valid authoritative candidate in career_profiles -> SUCCESS", async () => {
    const job = seedEvaluationContextAndJob("job_test_5", "{}", "user_alpha", "tenant_alpha", "plan_alpha");

    const result = await worker.processJob(job);
    expect(result.status).toBe("completed");
    expect(["PURSUE", "CONSIDER", "PASS"]).toContain(result.decision);

    const jobRow = sqliteDb.prepare("SELECT status, attempts, last_error FROM evaluation_jobs WHERE id = 'job_test_5'").get() as any;
    expect(jobRow.status).toBe("completed");
    expect(jobRow.last_error).toBeNull();
  });

  test("TEST 6: '{}' snapshot + missing candidate projection in career_profiles -> deterministic failure & retry", async () => {
    // Register a user with NO career_profiles entry
    sqliteDb.exec("INSERT INTO people (id, email, tenant_id) VALUES ('user_empty', 'empty@alpha.internal', 'tenant_alpha')");
    sqliteDb.exec(`INSERT INTO search_plans (id, tenant_id, person_id, status, title, criteria_json) 
      VALUES ('plan_empty', 'tenant_alpha', 'user_empty', 'active', 'Empty Plan', '{}')
    `);

    const job = seedEvaluationContextAndJob("job_test_6", "{}", "user_empty", "tenant_alpha", "plan_empty");

    const result = await worker.processJob(job);
    expect(result.status).toBe("retry_scheduled");
    expect(result.nextAttemptInSeconds).toBe(5);

    const jobRow = sqliteDb.prepare("SELECT status, attempts, last_error FROM evaluation_jobs WHERE id = 'job_test_6'").get() as any;
    expect(jobRow.status).toBe("pending");
    expect(jobRow.attempts).toBe(1);
    expect(jobRow.last_error).toContain("No authoritative candidate projection found for tenant 'tenant_alpha', person 'user_empty'");
  });

  test("TEST 7: Static candidate-profile seed is NOT consulted by EvaluationWorker during processing", async () => {
    // Spy on candidateProfile object access to prove it is completely decoupled
    const staticProfileSpy = vi.spyOn(staticProfileModule, "candidateProfile", "get");

    const job = seedEvaluationContextAndJob("job_test_7", "{}", "user_alpha", "tenant_alpha", "plan_alpha");
    const result = await worker.processJob(job);

    expect(result.status).toBe("completed");
    // Verify that the static seed getter was never invoked
    expect(staticProfileSpy).not.toHaveBeenCalled();

    staticProfileSpy.mockRestore();
  });
});
