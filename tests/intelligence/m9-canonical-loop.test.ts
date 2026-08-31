/**
 * tests/intelligence/m9-canonical-loop.test.ts
 *
 * Phase M9 Integration Test Suite: Canonical Production Loop
 *
 * Tests the complete end-to-end loop:
 * Scraper Ingestion Interceptor -> Canonical Tables & Versions
 *   -> Deterministic Attention Gate
 *   -> SearchPlanCandidates
 *   -> Evaluation Queue (evaluation_jobs)
 *   -> Evaluation Worker (EvaluationWorker.pollAndProcessNext)
 *   -> Materialized Evaluations (materialized_evaluations)
 *   -> Canonical Executive Serving (SqliteCanonicalServingStore)
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { CanonicalIngestionService } from "../../src/lib/acquisition/CanonicalIngestionService";
import { EvaluationWorker } from "../../src/lib/intelligence/EvaluationWorker";
import { SqliteCanonicalServingStore } from "../../src/data/sqlite/repositories/SqliteCanonicalServingStore";
import { computeCanonicalJobId } from "../../src/lib/domain/canonical_identity";

describe("Milestone M9 — Close Canonical Production Loop", () => {
  let sqliteDb: Database.Database;
  let db: SqliteAdapter;
  let ingestionService: CanonicalIngestionService;
  let servingStore: SqliteCanonicalServingStore;
  let worker: EvaluationWorker;

  const tenantId = "tenant_default";
  const personId = "person_swapnil";
  const scope = { tenantId, personId };

  beforeEach(() => {
    sqliteDb = new Database(":memory:");
    sqliteDb.pragma("foreign_keys = ON");
    db = new SqliteAdapter(sqliteDb);
    ingestionService = new CanonicalIngestionService(db);
    servingStore = new SqliteCanonicalServingStore(db);
    worker = new EvaluationWorker("test_worker_1", { adapter: db });

    const migrationFiles = [
      "001_initial_schema.sql",
      "002_event_sourcing.sql",
      "006_recreate_decisions.sql",
      "007_auth_tables.sql",
      "009_profile_queryable_columns.sql",
      "018_multi_tenant_foundation.sql",
      "019_evaluation_context_and_read_model.sql",
      "020_canonical_acquisition.sql",
      "023_canonical_posted_at.sql",
      "024_canonical_posting_precision.sql",
      "025_canonical_decisions.sql",
      "021_evaluation_work_queue.sql",
      "026_canonical_acquisition_integrity.sql",
      "027_materialized_evaluations_nullable_decision.sql",
      "028_active_evaluation_context_pointers.sql",
      "029_materialized_evaluations_vetoed.sql",
    ];

    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(process.cwd(), "src/data/sqlite/migrations", file), "utf-8");
      sqliteDb.exec(sql);
    }

    // Seed tenants, users, people, memberships
    sqliteDb.exec(`
      INSERT INTO tenants (id, status) VALUES ('${tenantId}', 'active');
      INSERT INTO users (id, email) VALUES ('${personId}', 'swapnil@test.com');
      INSERT INTO people (id, email, tenant_id) VALUES ('${personId}', 'swapnil@test.com', '${tenantId}');
      INSERT INTO memberships (user_id, tenant_id, role, permissions, status) VALUES 
        ('${personId}', '${tenantId}', 'admin', '["read:evaluation","write:evaluation"]', 'active');


      -- Active search plan targeting executive CTO/VP roles
      INSERT INTO search_plans (id, tenant_id, person_id, title, criteria_json, status) VALUES 
        ('sp_1', '${tenantId}', '${personId}', 'Executive Search', '{"targetRoles":["CTO","VP Engineering","Chief Technology Officer"],"targetLocations":["Bengaluru","Remote"]}', 'active');

      INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES 
        ('sps_1', '${tenantId}', '${personId}', 'sp_1', 'snap_hash_1', '{"identity":{"currentTitle":"Executive","company":"Leadership"},"executiveIdentity":{"archetype":"Technology Executive","valueProposition":"Engineering Scale","executiveThemes":["Engineering Leadership"]},"experience":{"achievements":["Scaled platform 10x"],"yearsExperience":15},"evidence":[],"preferences":{"locations":["Bengaluru","Remote"]}}');

      INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version) VALUES 
        ('ctx_fp_1', '${tenantId}', '${personId}', 'sps_1', 'v2', 'ofp_1', 'v4.3', 'prof_1');
    `);
  });

  it("1. Intercepts validated scraper payload into canonical opportunities, versions, and queues matching candidates", async () => {
    const payload = {
      sourcePortal: "linkedin",
      sourceJobId: "job_cto_101",
      canonicalUrl: "https://linkedin.com/jobs/view/job_cto_101",
      jobTitle: "Chief Technology Officer",
      companyName: "Acme Cloud Corp",
      location: "Bengaluru",
      employmentType: "Full-time",
      rawContent: JSON.stringify({
        jobHash: "can_cto_101",
        role: "Chief Technology Officer",
        company: "Acme Cloud Corp",
        location: "Bengaluru",
        workType: "Hybrid",
        fitScore: 88,
        strategicFit: { score: 88, band: "High" },
        overallBand: "High",
        pros: ["Strong technical scale", "Direct founder reporting"],
        cons: ["High ambiguity"],
        verdict: "Pursue",
        executiveSummary: "High conviction CTO opportunity."
      }),
    };

    const res = await ingestionService.ingestOpportunity(payload, scope);
    expect(res.canonicalJobId).toBe(computeCanonicalJobId({ source: "linkedin", sourceJobId: "job_cto_101" }));
    expect(res.plansEvaluated).toBe(1);
    expect(res.candidatesProjected).toBe(1);
    expect(res.candidateDecisions["sp_1"]).toBe("CANDIDATE");
    expect(res.jobsEnqueued).toBe(1);

    // Verify canonical opportunities
    const opp = await db.one<any>(`SELECT * FROM canonical_opportunities WHERE id = ?`, [res.canonicalJobId]);
    expect(opp).toBeDefined();
    expect(opp.source).toBe("linkedin");
    expect(opp.source_job_id).toBe("job_cto_101");
    expect(opp.company_name).toBe("Acme Cloud Corp");
    expect(opp.canonical_url).toBe("https://linkedin.com/jobs/view/job_cto_101");

    // Verify opportunity version
    const ver = await db.one<any>(`SELECT * FROM opportunity_versions WHERE id = ?`, [res.opportunityVersion]);
    expect(ver).toBeDefined();
    expect(ver.job_title).toBe("Chief Technology Officer");

    // Verify candidate projection
    const candidate = await db.one<any>(
      `SELECT * FROM search_plan_candidates WHERE canonical_job_id = ? AND search_plan_id = 'sp_1'`,
      [res.canonicalJobId]
    );
    expect(candidate.attention_decision).toBe("CANDIDATE");

    // Verify evaluation job
    const job = await db.one<any>(
      `SELECT * FROM evaluation_jobs WHERE canonical_job_id = ? AND search_plan_id = 'sp_1'`,
      [res.canonicalJobId]
    );
    expect(job).toBeDefined();
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(0);
  });

  it("2. Filters non-matching jobs at Attention Gate with NOT_CANDIDATE and zero enqueued jobs", async () => {
    const nonMatchingPayload = {
      sourcePortal: "naukri",
      sourceJobId: "job_intern_202",
      canonicalUrl: "https://naukri.com/jobs/view/job_intern_202",
      jobTitle: "Junior Frontend Intern",
      companyName: "Small Shop",
      location: "Chennai",
      employmentType: "Internship",
      rawContent: "Junior HTML intern role",
    };

    const res = await ingestionService.ingestOpportunity(nonMatchingPayload, scope);
    expect(res.candidateDecisions["sp_1"]).toBe("NOT_CANDIDATE");
    expect(res.jobsEnqueued).toBe(0);

    const jobsCount = await db.one<{ count: number }>(
      `SELECT COUNT(*) as count FROM evaluation_jobs WHERE canonical_job_id = ?`,
      [res.canonicalJobId]
    );
    expect(jobsCount?.count).toBe(0);
  });

  it("3. End-to-end loop: Worker processes queue -> Materialized Evaluation -> Canonical Executive Serving", async () => {
    const payload = {
      sourcePortal: "linkedin",
      sourceJobId: "job_vp_303",
      canonicalUrl: "https://linkedin.com/jobs/view/job_vp_303",
      jobTitle: "VP Engineering",
      companyName: "HyperScale Tech",
      location: "Remote",
      employmentType: "Full-time",
      rawContent: JSON.stringify({
        jobHash: "can_vp_303",
        role: "VP Engineering",
        company: "HyperScale Tech",
        location: "Remote",
        workType: "Remote",
        fitScore: 92,
        strategicFit: { score: 92, band: "High" },
        overallBand: "High",
        pros: ["Proven scale-up leader", "P&L responsibility"],
        cons: [],
        verdict: "Pursue",
        executiveSummary: "Exceptional executive fit."
      }),
    };

    // 1. Ingest
    const ingestRes = await ingestionService.ingestOpportunity(payload, scope);
    expect(ingestRes.jobsEnqueued).toBe(1);

    // 2. Process via Worker
    const workResult = await worker.pollAndProcessNext();
    expect(workResult).toBeDefined();
    expect(workResult?.status).toBe("completed");

    // 3. Verify Job completed in DB
    const completedJob = await db.one<any>(
      `SELECT * FROM evaluation_jobs WHERE canonical_job_id = ?`,
      [ingestRes.canonicalJobId]
    );
    expect(completedJob.status).toBe("completed");
    expect(completedJob.completed_at).toBeTruthy();

    // 4. Verify Materialized Evaluation exists
    const matEval = await db.one<any>(
      `SELECT * FROM materialized_evaluations WHERE canonical_job_id = ?`,
      [ingestRes.canonicalJobId]
    );
    expect(matEval).toBeDefined();
    expect(matEval.tenant_id).toBe(tenantId);
    expect(matEval.person_id).toBe(personId);
    expect(matEval.quality_score).toBeGreaterThan(0);

    // 5. Query Canonical Serving Store — opportunity must be immediately retrievable!
    const opportunities = await servingStore.listOpportunities(scope);
    expect(opportunities.length).toBe(1);
    expect(opportunities[0].jobHash).toBe("job_vp_303");
    expect(opportunities[0].role).toBe("VP Engineering");
    expect(opportunities[0].company).toBe("HyperScale Tech");
    expect(opportunities[0].effectiveDecision).toBeDefined();
    expect(opportunities[0].userDecision).toBeNull();
  });

  it("4. Guarantees complete idempotency on repeated ingestion invocations", async () => {
    const payload = {
      sourcePortal: "linkedin",
      sourceJobId: "job_idempotent_404",
      canonicalUrl: "https://linkedin.com/jobs/view/404",
      jobTitle: "VP Engineering",
      companyName: "Stable Systems",
      location: "Bengaluru",
      employmentType: "Full-time",
      rawContent: JSON.stringify({
        jobHash: "job_404",
        role: "VP Engineering",
        company: "Stable Systems",
        location: "Bengaluru",
        fitScore: 85,
        verdict: "Consider"
      }),
    };

    // First ingestion
    const res1 = await ingestionService.ingestOpportunity(payload, scope);
    expect(res1.jobsEnqueued).toBe(1);

    // Second identical ingestion
    const res2 = await ingestionService.ingestOpportunity(payload, scope);
    expect(res2.canonicalJobId).toBe(res1.canonicalJobId);
    expect(res2.opportunityVersion).toBe(res1.opportunityVersion);
    expect(res2.jobsEnqueued).toBe(0); // Zero duplicate jobs enqueued

    // Verify DB counts
    const oppCount = await db.one<{ count: number }>(
      `SELECT COUNT(*) as count FROM canonical_opportunities WHERE id = ?`,
      [res1.canonicalJobId]
    );
    expect(oppCount?.count).toBe(1);

    const versionCount = await db.one<{ count: number }>(
      `SELECT COUNT(*) as count FROM opportunity_versions WHERE canonical_job_id = ?`,
      [res1.canonicalJobId]
    );
    expect(versionCount?.count).toBe(1);

    const queueCount = await db.one<{ count: number }>(
      `SELECT COUNT(*) as count FROM evaluation_jobs WHERE canonical_job_id = ?`,
      [res1.canonicalJobId]
    );
    expect(queueCount?.count).toBe(1);
  });
});
