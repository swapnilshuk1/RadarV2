/**
 * tests/intelligence/m10-continuous-pipeline.test.ts
 *
 * RADAR v2 — Milestone M10 Continuous Canonical Ingestion & Serving Pipeline Contract Suite.
 *
 * Proves the unbroken, deterministic execution across all 11 subsystems (A through K):
 *   1. Scraper Card Payload Ingestion
 *   2. Canonical Ingestion Service (Identity + Versioning)
 *   3. Attention Gate Filtering & search_plan_candidates Projection
 *   4. Durable evaluation_jobs Work Queue
 *   5. EvaluationWorker Claiming & Lease Concurrency Control
 *   6. Deterministic runEngineSingle Evaluation & materialized_evaluations Persistence
 *   7. Queue Retries & Dead-Letter State Machine
 *   8. SqliteCanonicalServingStore & OpportunityService Executive Serving
 *   9. Multi-Tenant Boundary Isolation & Historical Immutability
 */

import { describe, test, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { DatabaseAdapter, QueryParams } from "@/data/database/DatabaseAdapter";
import { CanonicalIngestionService } from "@/lib/acquisition/CanonicalIngestionService";
import { EvaluationWorker } from "@/lib/intelligence/EvaluationWorker";
import { SqliteCanonicalServingStore } from "@/data/sqlite/repositories/SqliteCanonicalServingStore";
import { computeEvaluationContextFingerprint } from "@/lib/domain/evaluation_fingerprint";
import { computeCanonicalJobId } from "@/lib/domain/canonical_identity";
import { computeContentHash, computeOpportunityVersionId } from "@/lib/domain/canonical_acquisition";
import type { CandidateProfile } from "@/data/candidate-profile";
import type { AuthorizedPersonScope } from "@/lib/security/auth";

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

describe("RADAR v2 — Milestone M10 Continuous Canonical Pipeline Suite", () => {
  let sqliteDb: Database.Database;
  let adapter: TestSqliteAdapter;

  const TENANT_A = "tenant_m10_primary";
  const TENANT_B = "tenant_m10_isolated";
  const PERSON_A = "person_m10_exec_a";
  const PERSON_B = "person_m10_exec_b";
  const USER_A = "user_m10_a";
  const USER_B = "user_m10_b";
  const PLAN_A = "plan_m10_chief_tech";

  const executiveProfileA: CandidateProfile = {
    identity: {
      fullName: "Alex Rivera",
      currentTitle: "VP of Engineering & AI",
      currentCompany: "Global Cloud Scale Inc",
      location: "Bengaluru",
      targetRoles: ["VP Engineering", "VP AI", "Chief Technology Officer", "Head of Engineering"]
    },
    executiveIdentity: {
      archetype: "Engineering & AI Leader",
      valueProposition: "Scaling enterprise platforms to 100M+ users with low-latency LLM architectures",
      executiveThemes: ["Enterprise Platform Engineering", "Distributed Systems", "AI Scaling"]
    },
    experience: {
      totalYears: 18,
      leadershipYears: 10,
      achievements: [
        "Led 120-person distributed engineering organization",
        "Architected core cloud infrastructure processing 50B daily requests",
        "Managed $25M infrastructure & tooling budget"
      ]
    },
    evidence: [],
    preferences: {
      targetLocations: ["Bengaluru", "Remote"],
      minCompINR: 10000000,
      targetCompanyStages: ["Series B", "Series C", "Growth", "Public"]
    }
  };

  let contextFingerprintA: string;

  beforeEach(async () => {
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
      "028_active_evaluation_context_pointers.sql"
    ];

    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(process.cwd(), "src/data/sqlite/migrations", file), "utf-8");
      sqliteDb.exec(sql);
    }

    adapter = new TestSqliteAdapter(sqliteDb);

    // Setup Tenant A & User/Person A
    sqliteDb.prepare(`INSERT INTO tenants (id, status, created_at, updated_at) VALUES (?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(TENANT_A);
    sqliteDb.prepare(`INSERT INTO users (id, email, created_at) VALUES (?, 'alex@example.com', CURRENT_TIMESTAMP)`).run(USER_A);
    sqliteDb.prepare(`INSERT INTO people (id, tenant_id, email, created_at, updated_at) VALUES (?, ?, 'alex@example.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(PERSON_A, TENANT_A);
    sqliteDb.prepare(`INSERT INTO memberships (user_id, tenant_id, role, permissions, status, created_at) VALUES (?, ?, 'owner', '["read:opportunity","write:opportunity"]', 'active', CURRENT_TIMESTAMP)`).run(USER_A, TENANT_A);

    // Setup Tenant B & User/Person B (for isolation verification)
    sqliteDb.prepare(`INSERT INTO tenants (id, status, created_at, updated_at) VALUES (?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(TENANT_B);
    sqliteDb.prepare(`INSERT INTO users (id, email, created_at) VALUES (?, 'other@example.com', CURRENT_TIMESTAMP)`).run(USER_B);
    sqliteDb.prepare(`INSERT INTO people (id, tenant_id, email, created_at, updated_at) VALUES (?, ?, 'other@example.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(PERSON_B, TENANT_B);
    sqliteDb.prepare(`INSERT INTO memberships (user_id, tenant_id, role, permissions, status, created_at) VALUES (?, ?, 'owner', '["read:opportunity","write:opportunity"]', 'active', CURRENT_TIMESTAMP)`).run(USER_B, TENANT_B);

    // Search Plan A for Executive Engineering/AI roles in Bengaluru/Remote
    const criteriaA = {
      targetSeniority: ["VP", "Head", "Director", "Chief"],
      targetRoles: ["VP Engineering", "VP AI", "Technology", "Engineering", "Chief Technology Officer"],
      targetLocations: ["Bengaluru", "Remote"],
      targetEmploymentTypes: ["Full-time", "Permanent"],
      excludedCompanies: ["SpamCorp"]
    };

    sqliteDb.prepare(`
      INSERT INTO search_plans (id, tenant_id, person_id, title, status, criteria_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(PLAN_A, TENANT_A, PERSON_A, "Executive Tech Leadership", JSON.stringify(criteriaA));

    // Register Snapshot & Evaluation Context for Tenant A
    const snapshotHashA = "snap_hash_m10_a";
    sqliteDb.prepare(`
      INSERT INTO search_plan_snapshots (id, search_plan_id, tenant_id, person_id, snapshot_hash, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run("sps_m10_a", PLAN_A, TENANT_A, PERSON_A, snapshotHashA, JSON.stringify(executiveProfileA));

    contextFingerprintA = computeEvaluationContextFingerprint({
      tenantId: TENANT_A,
      personId: PERSON_A,
      searchPlanSnapshotId: "sps_m10_a",
      ontologyVersion: "2.1.0",
      ontologyFingerprint: "ont_fp_m10",
      policyVersion: "v4_strict",
      profileVersion: "prof_v1_m10"
    });

    sqliteDb.prepare(`
      INSERT INTO evaluation_contexts (
        context_fingerprint, tenant_id, person_id, search_plan_snapshot_id,
        ontology_version, ontology_fingerprint, policy_version, profile_version, created_at
      ) VALUES (?, ?, ?, ?, '2.1.0', 'ont_fp_m10', 'v4_strict', 'prof_v1_m10', CURRENT_TIMESTAMP)
    `).run(contextFingerprintA, TENANT_A, PERSON_A, "sps_m10_a");

    const candidateProjectionA = {
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

    sqliteDb.prepare(`
      INSERT INTO career_profiles (
        id, person_id, timeline, skills, projection_json, projection_generated_at,
        current_title, years_experience, archetype, preferred_work_model, created_at, updated_at
      ) VALUES (?, ?, '[]', '[]', ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run("cp_m10_a", PERSON_A, JSON.stringify(candidateProjectionA), "VP of Engineering & AI", 18, "Engineering & AI Leader", "HYBRID");
  });

  // ===========================================================================
  // M10.1 — CANONICAL ACQUISITION & EVALUATION PROJECTION PROOFS
  // ===========================================================================

  test("M10.1: Full acquisition flow - Global Identity, Versioning, Attention Gate & Queue Enqueueing", async () => {
    const ingestionService = new CanonicalIngestionService(adapter);

    const scrapedPayload = {
      sourcePortal: "LinkedIn",
      sourceJobId: "li-job-vp-ai-9001",
      canonicalUrl: "https://www.linkedin.com/jobs/view/9001",
      jobTitle: "VP of Engineering & AI Platforms",
      companyName: "HyperScale Tech",
      location: "Bengaluru, India (Hybrid)",
      employmentType: "Full-time",
      postedAt: "2026-08-20T10:00:00Z",
      postedPrecision: "EXACT" as const,
      rawContent: "HyperScale Tech is hiring a VP of Engineering & AI Platforms in Bengaluru to lead our next-generation AI infrastructure..."
    };

    const res = await ingestionService.ingestOpportunity(scrapedPayload);

    // 1. Identity & Versioning
    const expectedCanonicalId = computeCanonicalJobId({ source: "LinkedIn", sourceJobId: "li-job-vp-ai-9001" });
    expect(res.canonicalJobId).toBe(expectedCanonicalId);
    expect(res.isNewOpportunity).toBe(true);
    expect(res.isNewVersion).toBe(true);
    expect(res.plansEvaluated).toBe(1);
    expect(res.candidatesProjected).toBe(1);
    expect(res.candidateDecisions[PLAN_A]).toBe("CANDIDATE");
    expect(res.jobsEnqueued).toBe(1);

    // 2. Database Lineage Verifications
    const canonicalRow = await adapter.one<any>(
      `SELECT * FROM canonical_opportunities WHERE id = ?`,
      [expectedCanonicalId]
    );
    expect(canonicalRow).not.toBeNull();
    expect(canonicalRow.source).toBe("LinkedIn");
    expect(canonicalRow.source_job_id).toBe("li-job-vp-ai-9001");
    expect(canonicalRow.company_name).toBe("HyperScale Tech");

    const versionRow = await adapter.one<any>(
      `SELECT * FROM opportunity_versions WHERE canonical_job_id = ? AND id = ?`,
      [expectedCanonicalId, res.opportunityVersion]
    );
    expect(versionRow).not.toBeNull();
    expect(versionRow.job_title).toBe("VP of Engineering & AI Platforms");
    expect(versionRow.posted_precision).toBe("EXACT");

    // 3. SearchPlanCandidates Projection
    const candidateRow = await adapter.one<any>(
      `SELECT * FROM search_plan_candidates WHERE tenant_id = ? AND person_id = ? AND search_plan_id = ? AND canonical_job_id = ?`,
      [TENANT_A, PERSON_A, PLAN_A, expectedCanonicalId]
    );
    expect(candidateRow).not.toBeNull();
    expect(candidateRow.attention_decision).toBe("CANDIDATE");

    // 4. Work Queue Job Enqueued
    const jobRow = await adapter.one<any>(
      `SELECT * FROM evaluation_jobs WHERE tenant_id = ? AND canonical_job_id = ? AND search_plan_id = ?`,
      [TENANT_A, expectedCanonicalId, PLAN_A]
    );
    expect(jobRow).not.toBeNull();
    expect(jobRow.status).toBe("pending");
    expect(jobRow.evaluation_context_fingerprint).toBe(contextFingerprintA);
  });

  test("M10.1: Idempotency on repeated ingest - Zero duplicate opportunities, versions, candidates, or jobs", async () => {
    const ingestionService = new CanonicalIngestionService(adapter);

    const scrapedPayload = {
      sourcePortal: "LinkedIn",
      sourceJobId: "li-job-vp-ai-9001",
      canonicalUrl: "https://www.linkedin.com/jobs/view/9001",
      jobTitle: "VP of Engineering & AI Platforms",
      companyName: "HyperScale Tech",
      location: "Bengaluru, India (Hybrid)",
      employmentType: "Full-time",
      rawContent: "HyperScale Tech is hiring a VP of Engineering & AI Platforms..."
    };

    // First Ingestion
    const firstRes = await ingestionService.ingestOpportunity(scrapedPayload);
    expect(firstRes.isNewOpportunity).toBe(true);
    expect(firstRes.isNewVersion).toBe(true);
    expect(firstRes.jobsEnqueued).toBe(1);

    // Second Ingestion (Exact duplicate payload)
    const secondRes = await ingestionService.ingestOpportunity(scrapedPayload);
    expect(secondRes.canonicalJobId).toBe(firstRes.canonicalJobId);
    expect(secondRes.opportunityVersion).toBe(firstRes.opportunityVersion);
    expect(secondRes.isNewOpportunity).toBe(false);
    expect(secondRes.isNewVersion).toBe(false);
    expect(secondRes.jobsEnqueued).toBe(0); // Deduplicated by ON CONFLICT DO NOTHING

    // Assert counts in database
    const oppCount = await adapter.one<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM canonical_opportunities`);
    const verCount = await adapter.one<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM opportunity_versions`);
    const candCount = await adapter.one<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM search_plan_candidates`);
    const jobCount = await adapter.one<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM evaluation_jobs`);

    expect(oppCount?.cnt).toBe(1);
    expect(verCount?.cnt).toBe(1);
    expect(candCount?.cnt).toBe(1);
    expect(jobCount?.cnt).toBe(1);
  });

  test("M10.1: Content mutation creates exactly one new OpportunityVersion and enqueues new EvaluationJob", async () => {
    const ingestionService = new CanonicalIngestionService(adapter);

    const basePayload = {
      sourcePortal: "Indeed",
      sourceJobId: "ind-job-head-eng-555",
      canonicalUrl: "https://indeed.com/viewjob?jk=555",
      jobTitle: "Head of Engineering",
      companyName: "RapidGrowth Inc",
      location: "Bengaluru",
      employmentType: "Full-time",
      rawContent: "Version 1 description: leading cloud platform."
    };

    const res1 = await ingestionService.ingestOpportunity(basePayload);
    expect(res1.isNewOpportunity).toBe(true);
    expect(res1.isNewVersion).toBe(true);

    // Mutate content (e.g. updated JD text with new requirements)
    const updatedPayload = {
      ...basePayload,
      rawContent: "Version 2 description: leading cloud platform AND expanding GenAI initiative."
    };

    const res2 = await ingestionService.ingestOpportunity(updatedPayload);
    expect(res2.canonicalJobId).toBe(res1.canonicalJobId);
    expect(res2.isNewOpportunity).toBe(false);
    expect(res2.isNewVersion).toBe(true);
    expect(res2.opportunityVersion).not.toBe(res1.opportunityVersion);
    expect(res2.jobsEnqueued).toBe(1);

    // Verify 1 canonical opportunity, 2 versions, 2 jobs
    const oppCount = await adapter.one<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM canonical_opportunities`);
    const verCount = await adapter.one<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM opportunity_versions WHERE canonical_job_id = ?`, [res1.canonicalJobId]);
    const jobCount = await adapter.one<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM evaluation_jobs WHERE canonical_job_id = ?`, [res1.canonicalJobId]);

    expect(oppCount?.cnt).toBe(1);
    expect(verCount?.cnt).toBe(2);
    expect(jobCount?.cnt).toBe(2);
  });

  test("M10.1: AttentionGate rejects non-qualifying opportunity - No evaluation job enqueued", async () => {
    const ingestionService = new CanonicalIngestionService(adapter);

    const nonQualifyingPayload = {
      sourcePortal: "Naukri",
      sourceJobId: "naukri-junior-intern-001",
      canonicalUrl: "https://naukri.com/job-001",
      jobTitle: "Junior Software Intern",
      companyName: "Acme Software",
      location: "Bengaluru",
      employmentType: "Internship",
      rawContent: "Entry-level internship for fresh graduates."
    };

    const res = await ingestionService.ingestOpportunity(nonQualifyingPayload);
    expect(res.isNewOpportunity).toBe(true);
    expect(res.candidateDecisions[PLAN_A]).toBe("NOT_CANDIDATE");
    expect(res.jobsEnqueued).toBe(0);

    const candidateRow = await adapter.one<any>(
      `SELECT * FROM search_plan_candidates WHERE canonical_job_id = ?`,
      [res.canonicalJobId]
    );
    expect(candidateRow.attention_decision).toBe("NOT_CANDIDATE");

    const jobRow = await adapter.one<any>(
      `SELECT * FROM evaluation_jobs WHERE canonical_job_id = ?`,
      [res.canonicalJobId]
    );
    expect(jobRow).toBeNull();
  });

  test("M10.1: Missing posting date defaults to NULL with UNKNOWN precision", async () => {
    const ingestionService = new CanonicalIngestionService(adapter);

    const payloadWithoutDate = {
      sourcePortal: "LinkedIn",
      sourceJobId: "li-no-date-111",
      canonicalUrl: "https://linkedin.com/jobs/111",
      jobTitle: "VP Technology",
      companyName: "UnknownDate Corp",
      location: "Bengaluru",
      rawContent: "VP Technology role description."
    };

    const res = await ingestionService.ingestOpportunity(payloadWithoutDate);
    const ver = await adapter.one<any>(
      `SELECT posted_at, posted_precision FROM opportunity_versions WHERE id = ?`,
      [res.opportunityVersion]
    );

    expect(ver.posted_at).toBeNull();
    expect(ver.posted_precision).toBe("UNKNOWN");
  });

  // ===========================================================================
  // M10.2 — EVALUATION WORKER EXECUTION, CONCURRENCY & RELIABILITY PROOFS
  // ===========================================================================

  test("M10.2: EvaluationWorker claims job, locks lease, executes fit evaluation, and writes materialized read model", async () => {
    const ingestionService = new CanonicalIngestionService(adapter);
    const ingestRes = await ingestionService.ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "li-worker-test-01",
      canonicalUrl: "https://linkedin.com/jobs/worker-01",
      jobTitle: "Chief Technology Officer",
      companyName: "Enterprise Global Cloud",
      location: "Bengaluru",
      employmentType: "Full-time",
      rawContent: JSON.stringify({
        jobHash: "li-worker-test-01",
        role: "Chief Technology Officer",
        company: "Enterprise Global Cloud",
        location: "Bengaluru",
        rawDescription: "Seeking a Chief Technology Officer with 15+ years experience in Enterprise Cloud and AI scaling."
      })
    });

    const worker1 = new EvaluationWorker("worker_alpha", { adapter });
    const worker2 = new EvaluationWorker("worker_beta", { adapter });

    // Worker 1 claims the pending job
    const claimedJob = await worker1.claimNextJob();
    expect(claimedJob).not.toBeNull();
    expect(claimedJob?.canonicalJobId).toBe(ingestRes.canonicalJobId);
    expect(claimedJob?.tenantId).toBe(TENANT_A);

    // Concurrency Check: Worker 2 attempts to claim while Worker 1 holds active lease
    const concurrentClaim = await worker2.claimNextJob();
    expect(concurrentClaim).toBeNull(); // Concurrency lease safety verified

    // Worker 1 processes the claimed job
    const processRes = await worker1.processJob(claimedJob!);
    expect(processRes.status).toBe("completed");
    expect(processRes.decision).toBeDefined();

    // Check evaluation_jobs status
    const finishedJob = await adapter.one<any>(
      `SELECT * FROM evaluation_jobs WHERE id = ?`,
      [claimedJob!.id]
    );
    expect(finishedJob.status).toBe("completed");
    expect(finishedJob.completed_at).not.toBeNull();

    // Check materialized_evaluations read model
    const matRow = await adapter.one<any>(
      `SELECT * FROM materialized_evaluations WHERE canonical_job_id = ? AND evaluation_context_fingerprint = ?`,
      [ingestRes.canonicalJobId, contextFingerprintA]
    );
    expect(matRow).not.toBeNull();
    expect(matRow.tenant_id).toBe(TENANT_A);
    expect(matRow.person_id).toBe(PERSON_A);
    expect(["PURSUE", "CONSIDER", "PASS"]).toContain(matRow.decision);
    expect(matRow.quality_score).toBeGreaterThan(0);
    expect(matRow.evaluation_json).toContain("recommendation");
  });

  test("M10.2: Retry and Dead-Letter state machine handles transient worker errors and bounds max attempts", async () => {
    const ingestionService = new CanonicalIngestionService(adapter);
    const ingestRes = await ingestionService.ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "li-fail-test-02",
      canonicalUrl: "https://linkedin.com/jobs/fail-02",
      jobTitle: "VP AI Engineering",
      companyName: "FailCorp",
      location: "Bengaluru",
      employmentType: "Full-time",
      rawContent: "Simulated worker error content with FAIL_FOR_TEST trigger."
    });

    const worker = new EvaluationWorker("worker_retry_tester", { adapter });

    // Attempt 1: Should schedule retry
    const jobAttempt1 = await worker.claimNextJob();
    expect(jobAttempt1).not.toBeNull();
    const res1 = await worker.processJob(jobAttempt1!);
    expect(res1.status).toBe("retry_scheduled");
    expect(res1.nextAttemptInSeconds).toBe(5); // 5 * 2^0

    const jobAfterAttempt1 = await adapter.one<any>(`SELECT attempts, status FROM evaluation_jobs WHERE id = ?`, [jobAttempt1!.id]);
    expect(jobAfterAttempt1.attempts).toBe(1);
    expect(jobAfterAttempt1.status).toBe("pending");

    // Manually expedite next_attempt_at for testing Attempt 2
    sqliteDb.prepare(`UPDATE evaluation_jobs SET next_attempt_at = datetime('now', '-10 seconds') WHERE id = ?`).run(jobAttempt1!.id);

    // Attempt 2: Should schedule retry with exponential backoff (10s)
    const jobAttempt2 = await worker.claimNextJob();
    expect(jobAttempt2).not.toBeNull();
    expect(jobAttempt2?.attempts).toBe(1);
    const res2 = await worker.processJob(jobAttempt2!);
    expect(res2.status).toBe("retry_scheduled");
    expect(res2.nextAttemptInSeconds).toBe(10); // 5 * 2^1

    const jobAfterAttempt2 = await adapter.one<any>(`SELECT attempts, status FROM evaluation_jobs WHERE id = ?`, [jobAttempt1!.id]);
    expect(jobAfterAttempt2.attempts).toBe(2);

    // Manually expedite next_attempt_at for testing Attempt 3 (Terminal attempt)
    sqliteDb.prepare(`UPDATE evaluation_jobs SET next_attempt_at = datetime('now', '-10 seconds') WHERE id = ?`).run(jobAttempt1!.id);

    // Attempt 3: Exceeds max_attempts (3) -> Dead Letter Queue
    const jobAttempt3 = await worker.claimNextJob();
    expect(jobAttempt3).not.toBeNull();
    expect(jobAttempt3?.attempts).toBe(2);
    const res3 = await worker.processJob(jobAttempt3!);
    expect(res3.status).toBe("dead_letter");

    const jobAfterAttempt3 = await adapter.one<any>(`SELECT attempts, status, last_error FROM evaluation_jobs WHERE id = ?`, [jobAttempt1!.id]);
    expect(jobAfterAttempt3.attempts).toBe(3);
    expect(jobAfterAttempt3.status).toBe("dead_letter");
    expect(jobAfterAttempt3.last_error).toContain("Simulated worker processing failure");
  });

  // ===========================================================================
  // M10.3 — CANONICAL SERVING & EFFECTIVE DECISIONS PROOFS
  // ===========================================================================

  test("M10.3: Canonical Serving Store serves materialized opportunities and applies user decision overrides", async () => {
    // 1. Ingest & Process Opportunity
    const ingestionService = new CanonicalIngestionService(adapter);
    const ingestRes = await ingestionService.ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "li-serving-test-01",
      canonicalUrl: "https://linkedin.com/jobs/serving-01",
      jobTitle: "VP of Engineering & AI Platforms",
      companyName: "Enterprise Tier 1",
      location: "Bengaluru",
      employmentType: "Full-time",
      postedAt: "2026-08-20T08:00:00Z",
      postedPrecision: "EXACT",
      rawContent: JSON.stringify({
        jobHash: "li-serving-test-01",
        role: "VP of Engineering & AI Platforms",
        company: "Enterprise Tier 1",
        location: "Bengaluru",
        rawDescription: "Seeking VP of AI & Engineering with deep experience scaling LLMs and distributed systems."
      })
    });

    const worker = new EvaluationWorker("worker_serving_exec", { adapter });
    const processResult = await worker.pollAndProcessNext();
    expect(processResult?.status).toBe("completed");

    // 2. Query Serving Store for Tenant A / Person A Scope
    const servingStore = new SqliteCanonicalServingStore(adapter);
    const scopeA: AuthorizedPersonScope = {
      userId: USER_A,
      tenantId: TENANT_A,
      personId: PERSON_A,
      permissions: ["read:opportunity", "write:opportunity"]
    };

    const opps = await servingStore.listOpportunities(scopeA);
    expect(opps.length).toBe(1);

    const servedOpp = opps[0];
    expect(servedOpp.jobHash).toBe("li-serving-test-01");
    expect(servedOpp.role).toBe("VP of Engineering & AI Platforms");
    expect(servedOpp.company).toBe("Enterprise Tier 1");
    expect(servedOpp.location).toBe("Bengaluru");
    expect(servedOpp.postedRelative).toBeDefined();
    expect(["PURSUE", "CONSIDER", "PASS", "SPARSE_SPEC"]).toContain(servedOpp.decision);
    expect(servedOpp.effectiveDecision).toBeDefined();

    // 3. User records explicit PASS decision
    sqliteDb.prepare(`
      INSERT INTO canonical_decisions (
        person_id, tenant_id, canonical_job_id, action, reason, created_at, updated_at
      ) VALUES (?, ?, ?, 'PASS', 'Location preference changed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(PERSON_A, TENANT_A, ingestRes.canonicalJobId);

    // 4. Re-query Serving Store: User decision MUST take precedence in effectiveDecision
    const updatedOpps = await servingStore.listOpportunities(scopeA);
    expect(updatedOpps.length).toBe(1);
    expect(updatedOpps[0].userDecision?.userAction).toBe("PASS");
    expect(updatedOpps[0].effectiveDecision).toBe("USER_PASSED");

    // 5. Tenant Isolation Verification: Person B in Tenant B MUST NOT see Tenant A opportunities
    const scopeB: AuthorizedPersonScope = {
      userId: USER_B,
      tenantId: TENANT_B,
      personId: PERSON_B,
      permissions: ["read:opportunity", "write:opportunity"]
    };
    const oppsB = await servingStore.listOpportunities(scopeB);
    expect(oppsB.length).toBe(0); // Tenant isolation strictly verified
  });

  test("M10.2: Stale lease reclamation recovers abandoned jobs after timeout", async () => {
    const ingestionService = new CanonicalIngestionService(adapter);
    const ingestRes = await ingestionService.ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "li-stale-lease-01",
      canonicalUrl: "https://linkedin.com/jobs/stale-01",
      jobTitle: "VP of Engineering & AI Platforms",
      companyName: "CloudScale Co",
      location: "Bengaluru",
      employmentType: "Full-time",
      rawContent: JSON.stringify({
        jobHash: "li-stale-lease-01",
        role: "VP of Engineering & AI Platforms",
        company: "CloudScale Co",
        location: "Bengaluru",
        rawDescription: "Engineering VP role"
      })
    });

    const workerA = new EvaluationWorker("worker_abandoner", { adapter });
    const workerB = new EvaluationWorker("worker_rescuer", { adapter });

    // Worker A claims the job
    const job = await workerA.claimNextJob();
    expect(job).not.toBeNull();

    // Simulate crash / passage of 350 seconds (>300s timeout)
    sqliteDb.prepare(`
      UPDATE evaluation_jobs 
      SET locked_at = datetime('now', '-350 seconds') 
      WHERE id = ?
    `).run(job!.id);

    // Worker B claims the abandoned job via stale lease reclamation
    const rescuedJob = await workerB.claimNextJob();
    expect(rescuedJob).not.toBeNull();
    expect(rescuedJob?.id).toBe(job!.id);

    // Worker B finishes processing
    const processRes = await workerB.processJob(rescuedJob!);
    expect(processRes.status).toBe("completed");

    const finalRow = await adapter.one<any>(`SELECT status, locked_by FROM evaluation_jobs WHERE id = ?`, [job!.id]);
    expect(finalRow.status).toBe("completed");
    expect(finalRow.locked_by).toBe("worker_rescuer");
  });

  test("M10.2: EvaluationDaemon continuously polls and drains enqueued jobs", async () => {
    const { EvaluationDaemon } = await import("@/lib/intelligence/EvaluationDaemon");
    const ingestionService = new CanonicalIngestionService(adapter);

    await ingestionService.ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "li-daemon-job-01",
      canonicalUrl: "https://linkedin.com/jobs/daemon-01",
      jobTitle: "VP of Engineering & AI Platforms",
      companyName: "Daemon Tech 1",
      location: "Bengaluru",
      employmentType: "Full-time",
      rawContent: JSON.stringify({
        jobHash: "li-daemon-job-01",
        role: "VP of Engineering & AI Platforms",
        company: "Daemon Tech 1",
        location: "Bengaluru",
        rawDescription: "Engineering leadership role 1"
      })
    });

    await ingestionService.ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "li-daemon-job-02",
      canonicalUrl: "https://linkedin.com/jobs/daemon-02",
      jobTitle: "Head of Engineering",
      companyName: "Daemon Tech 2",
      location: "Bengaluru",
      employmentType: "Full-time",
      rawContent: JSON.stringify({
        jobHash: "li-daemon-job-02",
        role: "Head of Engineering",
        company: "Daemon Tech 2",
        location: "Bengaluru",
        rawDescription: "Engineering leadership role 2"
      })
    });

    // Verify 2 pending jobs
    const pendingBefore = await adapter.one<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM evaluation_jobs WHERE status = 'pending'`);
    expect(pendingBefore?.cnt).toBe(2);

    // Run daemon with fast polling
    const daemon = new EvaluationDaemon("test_daemon", 20, { adapter });
    daemon.start();

    // Poll until drained or timeout
    const startTime = Date.now();
    while (Date.now() - startTime < 3000) {
      const remaining = await adapter.one<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM evaluation_jobs WHERE status = 'pending'`);
      if (remaining?.cnt === 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    daemon.stop();

    const pendingAfter = await adapter.one<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM evaluation_jobs WHERE status = 'pending'`);
    const completedAfter = await adapter.one<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM evaluation_jobs WHERE status = 'completed'`);
    const materializedCount = await adapter.one<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM materialized_evaluations`);

    expect(pendingAfter?.cnt).toBe(0);
    expect(completedAfter?.cnt).toBe(2);
    expect(materializedCount?.cnt).toBe(2);
  });

  test("M10.2: Historical materialized evaluations remain immutable when new context is created", async () => {
    const ingestionService = new CanonicalIngestionService(adapter);
    const ingestRes = await ingestionService.ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "li-immutability-01",
      canonicalUrl: "https://linkedin.com/jobs/immutability-01",
      jobTitle: "VP of Engineering & AI Platforms",
      companyName: "Stability Corp",
      location: "Bengaluru",
      employmentType: "Full-time",
      rawContent: JSON.stringify({
        jobHash: "li-immutability-01",
        role: "VP of Engineering & AI Platforms",
        company: "Stability Corp",
        location: "Bengaluru",
        rawDescription: "VP of Engineering role"
      })
    });

    const worker = new EvaluationWorker("worker_immutability", { adapter });
    await worker.pollAndProcessNext();

    const initialMat = await adapter.one<any>(
      `SELECT * FROM materialized_evaluations WHERE canonical_job_id = ? AND evaluation_context_fingerprint = ?`,
      [ingestRes.canonicalJobId, contextFingerprintA]
    );
    expect(initialMat).not.toBeNull();

    // Now register a new evaluation context (Context B) for the same tenant/person
    const contextFingerprintB = computeEvaluationContextFingerprint({
      tenantId: TENANT_A,
      personId: PERSON_A,
      searchPlanSnapshotId: "sps_m10_b",
      ontologyVersion: "2.2.0",
      ontologyFingerprint: "ont_fp_m10_b",
      policyVersion: "v5_beta",
      profileVersion: "prof_v2_m10"
    });

    sqliteDb.prepare(`
      INSERT INTO search_plan_snapshots (id, search_plan_id, tenant_id, person_id, snapshot_hash, payload_json, created_at)
      VALUES ('sps_m10_b', ?, ?, ?, 'snap_hash_b', '{}', CURRENT_TIMESTAMP)
    `).run(PLAN_A, TENANT_A, PERSON_A);

    sqliteDb.prepare(`
      INSERT INTO evaluation_contexts (
        context_fingerprint, tenant_id, person_id, search_plan_snapshot_id,
        ontology_version, ontology_fingerprint, policy_version, profile_version, created_at
      ) VALUES (?, ?, ?, 'sps_m10_b', '2.2.0', 'ont_fp_m10_b', 'v5_beta', 'prof_v2_m10', CURRENT_TIMESTAMP)
    `).run(contextFingerprintB, TENANT_A, PERSON_A);

    // Verify original evaluation under Context A is completely untouched
    const historicalMat = await adapter.one<any>(
      `SELECT * FROM materialized_evaluations WHERE canonical_job_id = ? AND evaluation_context_fingerprint = ?`,
      [ingestRes.canonicalJobId, contextFingerprintA]
    );
    expect(historicalMat.id).toBe(initialMat.id);
    expect(historicalMat.decision).toBe(initialMat.decision);
    expect(historicalMat.quality_score).toBe(initialMat.quality_score);
    expect(historicalMat.evaluation_json).toBe(initialMat.evaluation_json);
  });

  test("M10.2: Successful materialization is idempotent across repeated worker processing", async () => {
    const ingestionService = new CanonicalIngestionService(adapter);
    const ingestRes = await ingestionService.ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "li-idempotency-mat-01",
      canonicalUrl: "https://linkedin.com/jobs/idempotency-mat-01",
      jobTitle: "VP Engineering & Platform Architecture",
      companyName: "HyperScale Inc",
      location: "Bengaluru",
      employmentType: "Full-time",
      rawContent: JSON.stringify({
        jobHash: "li-idempotency-mat-01",
        role: "VP Engineering & Platform Architecture",
        company: "HyperScale Inc",
        location: "Bengaluru",
        rawDescription: "Lead global platform architecture"
      })
    });

    // 1. Initial worker execution
    const worker1 = new EvaluationWorker("worker_idemp_1", { adapter });
    const res1 = await worker1.pollAndProcessNext();
    expect(res1?.status).toBe("completed");

    // 2. Verify exactly 1 materialized row
    const countBefore = await adapter.one<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM materialized_evaluations 
       WHERE canonical_job_id = ? AND opportunity_version = ? AND evaluation_context_fingerprint = ?`,
      [ingestRes.canonicalJobId, ingestRes.opportunityVersion, contextFingerprintA]
    );
    expect(countBefore?.cnt).toBe(1);

    const matRow1 = await adapter.one<any>(
      `SELECT id, decision, quality_score, materialized_at FROM materialized_evaluations 
       WHERE canonical_job_id = ? AND opportunity_version = ? AND evaluation_context_fingerprint = ?`,
      [ingestRes.canonicalJobId, ingestRes.opportunityVersion, contextFingerprintA]
    );
    expect(matRow1).not.toBeNull();

    // 3. Reset job state to 'pending' to simulate duplicate execution attempt
    await adapter.execute(
      `UPDATE evaluation_jobs 
       SET status = 'pending', locked_by = NULL, lease_token = NULL, locked_at = NULL 
       WHERE canonical_job_id = ? AND opportunity_version = ? AND evaluation_context_fingerprint = ?`,
      [ingestRes.canonicalJobId, ingestRes.opportunityVersion, contextFingerprintA]
    );

    // 4. Re-exercise worker processing on the same logical boundary
    const worker2 = new EvaluationWorker("worker_idemp_2", { adapter });
    const res2 = await worker2.pollAndProcessNext();
    expect(res2?.status).toBe("completed");

    // 5. Verify COUNT(materialized_evaluations) remains EXACTLY 1 and uncorrupted
    const countAfter = await adapter.one<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM materialized_evaluations 
       WHERE canonical_job_id = ? AND opportunity_version = ? AND evaluation_context_fingerprint = ?`,
      [ingestRes.canonicalJobId, ingestRes.opportunityVersion, contextFingerprintA]
    );
    expect(countAfter?.cnt).toBe(1);

    const matRow2 = await adapter.one<any>(
      `SELECT id, decision, quality_score, materialized_at FROM materialized_evaluations 
       WHERE canonical_job_id = ? AND opportunity_version = ? AND evaluation_context_fingerprint = ?`,
      [ingestRes.canonicalJobId, ingestRes.opportunityVersion, contextFingerprintA]
    );
    expect(matRow2?.id).toBe(matRow1?.id);
    expect(matRow2?.decision).toBe(matRow1?.decision);
    expect(matRow2?.quality_score).toBe(matRow1?.quality_score);
  });
});
