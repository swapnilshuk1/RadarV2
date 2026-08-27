/**
 * tests/pipeline/autonomous-pipeline.test.ts
 *
 * RADAR v2 — Autonomous Acquisition-to-Serving Pipeline Certification Test Suite
 *
 * Verifies:
 * 1. INV-AUTO-PROJECTION: Synthetic raw acquisition -> Canonical -> Search-Plan Candidate -> Evaluation Job -> Evaluation Worker -> Materialized Evaluation -> Servable feed item.
 * 2. Idempotency on repeated acquisition: 0 duplicate opportunities, versions, candidates, or jobs.
 * 3. Sparse capture resilience: Un-enriched / partial capture reaches canonical ingestion, recovery queue, and materialized read model without silent loss.
 */

import { describe, test, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { DatabaseAdapter, QueryParams } from "@/data/database/adapter";
import { CanonicalIngestionService } from "@/lib/acquisition/CanonicalIngestionService";
import { EvaluationWorker } from "@/lib/intelligence/EvaluationWorker";
import { SqliteCanonicalServingStore } from "@/data/sqlite/repositories/SqliteCanonicalServingStore";
import { computeEvaluationContextFingerprint } from "@/lib/domain/evaluation_fingerprint";
import { computeCanonicalJobId } from "@/lib/domain/canonical_identity";
import { CandidateProjection } from "@/lib/domain/candidate_projection";

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
      lastInsertRowid: result.lastInsertRowid,
    };
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

describe("RADAR v2 — Autonomous Acquisition-to-Serving Pipeline (INV-AUTO-PROJECTION)", () => {
  const TENANT_ID = "tenant_auto_1";
  const USER_ID = "user_auto_1";
  const PERSON_ID = "person_auto_1";
  const PLAN_ID = "plan_auto_1";

  let sqliteDb: InstanceType<typeof Database>;
  let adapter: DatabaseAdapter;
  let contextFingerprint: string;

  const candidateProjection: CandidateProjection = {
    operatingLevel: { value: "STRATEGIC", confidence: 0.95, evidenceIds: ["ev_1"] },
    workNature: { value: "STRATEGIC_WORK", confidence: 0.95, evidenceIds: ["ev_2"] },
    decisionAuthority: { value: "ENTERPRISE", confidence: 0.95, evidenceIds: ["ev_3"] },
    commercialScope: { value: "NONE", confidence: 0.95, evidenceIds: ["ev_4"] },
    yearsOfExperience: 18,
    coreCapabilities: ["SOFTWARE_ENGINEERING", "SYSTEM_ARCHITECTURE", "CLOUD_INFRASTRUCTURE", "TECH_LEADERSHIP"],
    preferredLocations: ["Bengaluru", "Remote"],
    preferredWorkModel: "HYBRID",
    executiveThemes: ["cloud_infrastructure", "engineering_scale"],
    attentionWindow: 4,
    headspaceCapacityPerMonth: 2,
  };

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
      "023_canonical_posted_at.sql",
      "024_canonical_posting_precision.sql",
      "025_canonical_decisions.sql",
      "026_canonical_acquisition_integrity.sql",
      "027_materialized_evaluations_nullable_decision.sql",
    ];

    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(process.cwd(), "src/data/sqlite/migrations", file), "utf-8");
      sqliteDb.exec(sql);
    }

    adapter = new TestSqliteAdapter(sqliteDb);

    // Seed Tenant, User, Person, Membership
    sqliteDb.prepare(`INSERT INTO tenants (id, status, created_at, updated_at) VALUES (?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(TENANT_ID);
    sqliteDb.prepare(`INSERT INTO users (id, email, created_at) VALUES (?, 'exec@domain.internal', CURRENT_TIMESTAMP)`).run(USER_ID);
    sqliteDb.prepare(`INSERT INTO people (id, tenant_id, email, created_at, updated_at) VALUES (?, ?, 'exec@domain.internal', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(PERSON_ID, TENANT_ID);
    sqliteDb.prepare(`INSERT INTO memberships (user_id, tenant_id, role, permissions, status, created_at) VALUES (?, ?, 'owner', '["read:opportunity","write:opportunity"]', 'active', CURRENT_TIMESTAMP)`).run(USER_ID, TENANT_ID);

    // Seed Search Plan
    const criteria = {
      targetSeniority: ["VP", "Head", "Director", "Chief"],
      targetRoles: ["VP of Engineering", "Chief Technology Officer", "VP AI", "Technology"],
      targetLocations: ["Bengaluru", "Remote"],
    };

    sqliteDb.prepare(`
      INSERT INTO search_plans (id, tenant_id, person_id, title, status, criteria_json, created_at, updated_at)
      VALUES (?, ?, ?, 'Executive AI & Tech Leadership', 'active', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(PLAN_ID, TENANT_ID, PERSON_ID, JSON.stringify(criteria));

    // Seed Search Plan Snapshot & Evaluation Context
    const snapshotId = "sps_auto_1";
    sqliteDb.prepare(`
      INSERT INTO search_plan_snapshots (id, search_plan_id, tenant_id, person_id, snapshot_hash, payload_json, created_at)
      VALUES (?, ?, ?, ?, 'snap_auto_hash', ?, CURRENT_TIMESTAMP)
    `).run(snapshotId, PLAN_ID, TENANT_ID, PERSON_ID, JSON.stringify({ criteria }));

    contextFingerprint = computeEvaluationContextFingerprint({
      tenantId: TENANT_ID,
      personId: PERSON_ID,
      searchPlanSnapshotId: snapshotId,
      ontologyVersion: "2.1.0",
      ontologyFingerprint: "ont_fp_auto",
      policyVersion: "v4_strict",
      profileVersion: "prof_v1_auto",
    });

    sqliteDb.prepare(`
      INSERT INTO evaluation_contexts (
        context_fingerprint, tenant_id, person_id, search_plan_snapshot_id,
        ontology_version, ontology_fingerprint, policy_version, profile_version, created_at
      ) VALUES (?, ?, ?, ?, '2.1.0', 'ont_fp_auto', 'v4_strict', 'prof_v1_auto', CURRENT_TIMESTAMP)
    `).run(contextFingerprint, TENANT_ID, PERSON_ID, snapshotId);

    // Seed authoritative candidate projection in career_profiles
    sqliteDb.prepare(`
      INSERT INTO career_profiles (
        id, person_id, timeline, skills, projection_json, projection_generated_at,
        current_title, years_experience, archetype, preferred_work_model, created_at, updated_at
      ) VALUES (?, ?, '[]', '[]', ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run("cp_auto_1", PERSON_ID, JSON.stringify(candidateProjection), "VP of Engineering & AI", 18, "Engineering Leader", "HYBRID");
  });

  test("INV-AUTO-PROJECTION: Acquisition -> Canonical -> Candidates -> Evaluation Worker -> Serving", async () => {
    const ingestion = new CanonicalIngestionService(adapter);
    const worker = new EvaluationWorker("test_worker_auto", { adapter });
    const servingStore = new SqliteCanonicalServingStore(adapter);

    // 1. Raw synthetic opportunity capture
    const rawPayload = {
      sourcePortal: "LinkedIn",
      sourceJobId: "li-exec-ai-8888",
      canonicalUrl: "https://www.linkedin.com/jobs/view/8888",
      jobTitle: "VP of Engineering & AI Systems",
      companyName: "Acme Cognitive Systems",
      location: "Bengaluru, India (Hybrid)",
      employmentType: "Full-time",
      postedAt: "2026-08-25T08:30:00Z",
      postedPrecision: "EXACT" as const,
      rawContent: "Acme Cognitive Systems is hiring a VP of Engineering & AI Systems in Bengaluru. Lead our core distributed AI systems, multi-agent frameworks, and high-performance engineering organization. 15+ years experience.",
    };

    const ingestRes = await ingestion.ingestOpportunity(rawPayload);

    // Assert canonicalization & candidate projection
    expect(ingestRes.isNewOpportunity).toBe(true);
    expect(ingestRes.isNewVersion).toBe(true);
    expect(ingestRes.candidatesProjected).toBe(1);
    expect(ingestRes.candidateDecisions[PLAN_ID]).toBe("CANDIDATE");
    expect(ingestRes.jobsEnqueued).toBe(1);

    // 2. Verify Evaluation Job is pending in database
    const pendingJob = await adapter.one<{ id: string; status: string }>(
      `SELECT id, status FROM evaluation_jobs WHERE canonical_job_id = ? AND tenant_id = ?`,
      [ingestRes.canonicalJobId, TENANT_ID]
    );
    expect(pendingJob).not.toBeNull();
    expect(pendingJob?.status).toBe("pending");

    // 3. Autonomous drain via EvaluationWorker
    const drainResult = await worker.drainQueue();
    expect(drainResult.processed).toBe(1);
    expect(drainResult.completed).toBe(1);
    expect(drainResult.failed).toBe(0);

    // 4. Verify Materialized Evaluation is written
    const matEval = await adapter.one<{ evaluation_state: string; decision: string; quality_score: number }>(
      `SELECT evaluation_state, decision, quality_score 
       FROM materialized_evaluations 
       WHERE canonical_job_id = ? AND tenant_id = ?`,
      [ingestRes.canonicalJobId, TENANT_ID]
    );
    expect(matEval).not.toBeNull();
    expect(matEval?.evaluation_state).toBe("EVALUATED");
    expect(["PURSUE", "CONSIDER", "PASS"]).toContain(matEval?.decision);
    expect(matEval?.quality_score).toBeGreaterThan(0);

    // 5. Query Canonical Serving Store for the active person scope
    const feed = await servingStore.listOpportunities({ tenantId: TENANT_ID, personId: PERSON_ID });
    expect(feed.length).toBe(1);
    expect(feed[0].canonicalJobId).toBe(ingestRes.canonicalJobId);
    expect(feed[0].role).toBe("VP of Engineering & AI Systems");
    expect(feed[0].company).toBe("Acme Cognitive Systems");
    expect(["PURSUE", "CONSIDER", "PASS"]).toContain(feed[0].engineRecommendation?.engineVerdict);
    expect(feed[0].effectiveDecision).toBeDefined();
  });

  test("Idempotency: Repeated identical ingestion produces 0 duplicate records", async () => {
    const ingestion = new CanonicalIngestionService(adapter);
    const worker = new EvaluationWorker("test_worker_auto_idemp", { adapter });

    const rawPayload = {
      sourcePortal: "LinkedIn",
      sourceJobId: "li-exec-ai-9999",
      canonicalUrl: "https://www.linkedin.com/jobs/view/9999",
      jobTitle: "Chief Technology Officer",
      companyName: "Global AI Holdings",
      location: "Bengaluru, India",
      employmentType: "Full-time",
      postedAt: "2026-08-26T10:00:00Z",
      postedPrecision: "EXACT" as const,
      rawContent: "Global AI Holdings seeks an experienced Chief Technology Officer to lead technology, architecture, and engineering scale.",
    };

    // First Ingestion
    const firstRes = await ingestion.ingestOpportunity(rawPayload);
    expect(firstRes.isNewOpportunity).toBe(true);
    expect(firstRes.isNewVersion).toBe(true);
    expect(firstRes.jobsEnqueued).toBe(1);

    // Drain Queue
    await worker.drainQueue();

    // Replay Second Ingestion (Exact duplicate)
    const secondRes = await ingestion.ingestOpportunity(rawPayload);
    expect(secondRes.isNewOpportunity).toBe(false);
    expect(secondRes.isNewVersion).toBe(false);
    expect(secondRes.jobsEnqueued).toBe(0);

    // Verify Counts in DB
    const oppCount = await adapter.one<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM canonical_opportunities`);
    const verCount = await adapter.one<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM opportunity_versions`);
    const candCount = await adapter.one<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM search_plan_candidates`);
    const jobCount = await adapter.one<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM evaluation_jobs`);
    const matCount = await adapter.one<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM materialized_evaluations`);

    expect(oppCount?.cnt).toBe(1);
    expect(verCount?.cnt).toBe(1);
    expect(candCount?.cnt).toBe(1);
    expect(jobCount?.cnt).toBe(1);
    expect(matCount?.cnt).toBe(1);
  });

  test("Sparse-capture resilience: Un-enriched card enters recovery queue & materialized read model", async () => {
    const ingestion = new CanonicalIngestionService(adapter);
    const worker = new EvaluationWorker("test_worker_auto_sparse", { adapter });

    const sparsePayload = {
      sourcePortal: "Indeed",
      sourceJobId: "ind-sparse-111",
      canonicalUrl: "https://in.indeed.com/viewjob?jk=111",
      jobTitle: "VP of Engineering",
      companyName: "Stealth Startup",
      location: "Bengaluru",
      employmentType: null,
      postedAt: null,
      postedPrecision: "UNKNOWN" as const,
      rawContent: "VP of Engineering at Stealth Startup", // Sparse text (<200 chars)
    };

    const sparseRes = await ingestion.ingestOpportunity(sparsePayload);
    expect(sparseRes.isNewOpportunity).toBe(true);
    expect(sparseRes.candidatesProjected).toBe(1);
    expect(sparseRes.jobsEnqueued).toBe(1);

    // Verify recovery queue entry
    const recoveryItem = await adapter.one<{ id: string; status: string }>(
      `SELECT id, status FROM recovery_queue WHERE canonical_job_id = ?`,
      [sparseRes.canonicalJobId]
    );
    expect(recoveryItem).not.toBeNull();
    expect(recoveryItem?.status).toBe("PENDING");

    // Drain Queue
    const drainResult = await worker.drainQueue();
    expect(drainResult.processed).toBe(1);
    expect(drainResult.completed).toBe(1);

    // Verify Materialized Evaluation is marked as ACQUISITION_PENDING
    const matEval = await adapter.one<{ evaluation_state: string; decision: string | null }>(
      `SELECT evaluation_state, decision 
       FROM materialized_evaluations 
       WHERE canonical_job_id = ? AND tenant_id = ?`,
      [sparseRes.canonicalJobId, TENANT_ID]
    );
    expect(matEval).not.toBeNull();
    expect(matEval?.evaluation_state).toBe("ACQUISITION_PENDING");
    expect(matEval?.decision).toBeNull();
  });
});
