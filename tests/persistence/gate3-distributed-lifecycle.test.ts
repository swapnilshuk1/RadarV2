import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { setupLineageTestFixture, activateLineageTestContext } from "./lineage_fixture";
import { SqliteScrapeRunStore } from "../../src/data/sqlite/repositories/SqliteScrapeRunStore";
import { CanonicalIngestionService } from "../../src/lib/acquisition/CanonicalIngestionService";
import { EnrichmentQueue } from "../../scripts/scraper/persist/queue";
import { EvaluationWorker } from "../../src/lib/intelligence/EvaluationWorker";
import { RunReconciliationService } from "../../src/lib/intelligence/RunReconciliationService";

const scopeA = { tenantId: "tenant_A", personId: "person_A", roles: [] };
const scopeB = { tenantId: "tenant_B", personId: "person_B", roles: [] };

describe("Gate 3: Distributed Lifecycle, Version-Aware Work & Queue Decoupling Contract", () => {
  let db: SqliteAdapter;
  let runStore: SqliteScrapeRunStore;
  let enrichmentQueue: EnrichmentQueue;
  let reconciler: RunReconciliationService;
  let canonicalIngest: CanonicalIngestionService;

  beforeEach(async () => {
    db = new SqliteAdapter(new Database(":memory:"));
    await setupLineageTestFixture(db);
    await activateLineageTestContext(db);

    // Setup snapshot and evaluation context for scopeB as well
    await db.execute(
      `INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["sps_B", "tenant_B", "person_B", "plan_B", "hashB", "{}"]
    );
    await db.execute(
      `INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["fingerprint_B", "tenant_B", "person_B", "sps_B", "v1", "hash_ontology", "v1", "v1"]
    );
    await db.execute(
      `INSERT INTO evaluation_context_scopes (context_fingerprint, tenant_id, person_id, search_plan_id)
       VALUES (?, ?, ?, ?)`,
      ["fingerprint_B", "tenant_B", "person_B", "plan_B"]
    );
    await db.execute(
      `INSERT INTO active_evaluation_contexts (tenant_id, person_id, search_plan_id, context_fingerprint, activated_by)
       VALUES (?, ?, ?, ?, ?)`,
      ["tenant_B", "person_B", "plan_B", "fingerprint_B", "test-fixture"]
    );

    runStore = new SqliteScrapeRunStore(db);
    enrichmentQueue = new EnrichmentQueue(db);
    reconciler = new RunReconciliationService(db);
    canonicalIngest = new CanonicalIngestionService(db);

    // Create companies fixture
    await db.execute(`INSERT OR IGNORE INTO companies (id, name) VALUES (?, ?)`, [
      "comp_tech_corp",
      "Tech Corp",
    ]);

    // Create authoritative candidate projections in career_profiles
    const candidateProj = {
      operatingLevel: { value: "STRATEGIC", confidence: 0.95, evidenceIds: ["ev_1"] },
      workNature: { value: "STRATEGIC_WORK", confidence: 0.95, evidenceIds: ["ev_2"] },
      decisionAuthority: { value: "ENTERPRISE", confidence: 0.95, evidenceIds: ["ev_3"] },
      commercialScope: { value: "ENTERPRISE", confidence: 0.95, evidenceIds: ["ev_4"] },
      yearsOfExperience: 20,
      coreCapabilities: ["TECH_LEADERSHIP", "SOFTWARE_ENGINEERING"],
      preferredLocations: ["Bengaluru", "Remote"],
      preferredWorkModel: "HYBRID",
      executiveThemes: ["engineering_scale"],
      attentionWindow: 6,
      headspaceCapacityPerMonth: 4,
    };

    await db.execute(
      `INSERT OR IGNORE INTO career_profiles (
         id, person_id, timeline, skills, projection_json, projection_generated_at,
         current_title, years_experience, archetype, preferred_work_model, created_at, updated_at
       ) VALUES (?, ?, '[]', '[]', ?, CURRENT_TIMESTAMP, 'VP Engineering', 20, 'engineering_scale', 'HYBRID', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ["prof_A", "person_A", JSON.stringify(candidateProj)]
    );

    await db.execute(
      `INSERT OR IGNORE INTO career_profiles (
         id, person_id, timeline, skills, projection_json, projection_generated_at,
         current_title, years_experience, archetype, preferred_work_model, created_at, updated_at
       ) VALUES (?, ?, '[]', '[]', ?, CURRENT_TIMESTAMP, 'VP Engineering', 20, 'engineering_scale', 'HYBRID', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ["prof_B", "person_B", JSON.stringify(candidateProj)]
    );
  });

  it("1. Pre-Enrichment Gating: Canonical admission creates WAITING_ENRICHMENT requirement; EvaluationWorker cannot claim until READY", async () => {
    // 1. Create an active scrape run in 'running' state
    const run = await runStore.createRun(scopeA, {
      id: "run-gate3-1",
      searchPlanId: "plan_A",
      portalTargets: ["LinkedIn"],
    });
    await runStore.updateRunStatus(scopeA, run.id, "running");

    // 2. Perform canonical admission for an opportunity with runId attached
    const ingestRes = await canonicalIngest.ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "li-gate3-1",
      canonicalUrl: "https://www.linkedin.com/jobs/view/100001",
      jobTitle: "VP of Engineering",
      companyName: "Tech Corp",
      location: "Bengaluru",
      rawContent: "Leadership opportunity managing 50+ engineers in distributed systems.",
    }, {
      tenantId: "tenant_A",
      personId: "person_A",
      searchPlanId: "plan_A",
      runId: run.id,
    });

    expect(ingestRes.isNewOpportunity).toBe(true);
    expect(ingestRes.canonicalJobId).toBeDefined();
    expect(ingestRes.opportunityVersion).toBeDefined();

    // 3. Invariant: evaluation_requirements has status WAITING_ENRICHMENT
    const req = await db.one<{ id: string; status: string; canonical_job_id: string }>(
      `SELECT * FROM evaluation_requirements WHERE canonical_job_id = ? AND opportunity_version = ?`,
      [ingestRes.canonicalJobId, ingestRes.opportunityVersion]
    );
    expect(req).not.toBeNull();
    expect(req?.status).toBe("WAITING_ENRICHMENT");

    // 4. Invariant: Bound to scrape_run_evaluation_requirements
    const binding = await db.one<{ run_id: string }>(
      `SELECT run_id FROM scrape_run_evaluation_requirements WHERE run_id = ? AND evaluation_requirement_id = ?`,
      [run.id, req!.id]
    );
    expect(binding?.run_id).toBe(run.id);

    // 5. Invariant: evaluation_jobs has NO pending rows created yet
    const pendingJobs = await db.many<{ id: string }>(
      `SELECT id FROM evaluation_jobs WHERE canonical_job_id = ?`,
      [ingestRes.canonicalJobId]
    );
    expect(pendingJobs).toHaveLength(0);

    // 6. Invariant: EvaluationWorker claims nothing
    const worker = new EvaluationWorker("test_worker", { adapter: db });
    const claimed = await worker.claimNextJob();
    expect(claimed).toBeNull();
  });

  it("2. Version-Aware Enrichment & Multi-Run Binding: deduplicates work and binds all referencing runs", async () => {
    // 1. Create two concurrent runs (across different scopes / plans)
    const run1 = await runStore.createRun(scopeA, {
      id: "run-multi-1",
      searchPlanId: "plan_A",
      portalTargets: ["LinkedIn"],
    });
    await db.execute(`UPDATE scrape_runs SET status = 'enriching' WHERE id = ?`, [run1.id]);

    const run2 = await runStore.createRun(scopeB, {
      id: "run-multi-2",
      searchPlanId: "plan_B",
      portalTargets: ["Indeed"],
    });
    await db.execute(`UPDATE scrape_runs SET status = 'enriching' WHERE id = ?`, [run2.id]);

    // Ingest the same canonical job into both plans/runs
    const oppPayload = {
      sourcePortal: "LinkedIn",
      sourceJobId: "li-dedupe-100",
      canonicalUrl: "https://www.linkedin.com/jobs/view/100002",
      jobTitle: "VP of Engineering",
      companyName: "Tech Corp",
      location: "Bengaluru",
      rawContent: "Shared canonical job posting across tenants and plans.",
    };

    const ingest1 = await canonicalIngest.ingestOpportunity(oppPayload, {
      tenantId: "tenant_A",
      personId: "person_A",
      searchPlanId: "plan_A",
      runId: run1.id,
    });

    const ingest2 = await canonicalIngest.ingestOpportunity(oppPayload, {
      tenantId: "tenant_B",
      personId: "person_B",
      searchPlanId: "plan_B",
      runId: run2.id,
    });

    expect(ingest1.canonicalJobId).toBe(ingest2.canonicalJobId);
    expect(ingest1.opportunityVersion).toBe(ingest2.opportunityVersion);

    const canonicalJobId = ingest1.canonicalJobId!;
    const opportunityVersion = ingest1.opportunityVersion!;
    const pipelineVersion = "1.0.0";

    // 2. Run 1 enqueues enrichment
    const job1Id = "job_multi_1";
    await enrichmentQueue.enqueue(
      job1Id,
      "cardhash_multi_1",
      "/snapshots/multi_1.json",
      pipelineVersion,
      { runId: run1.id },
      10,
      0,
      "snapshots/multi_1.json",
      canonicalJobId,
      opportunityVersion
    );

    // 3. Run 2 enqueues identical canonical opportunity & version
    const job2Id = "job_multi_2";
    await enrichmentQueue.enqueue(
      job2Id,
      "cardhash_multi_2",
      "/snapshots/multi_2.json",
      pipelineVersion,
      { runId: run2.id },
      10,
      0,
      "snapshots/multi_2.json",
      canonicalJobId,
      opportunityVersion
    );

    // Invariant: Only 1 row in enrichment_jobs (reused across runs)
    const allEnrichJobs = await db.many<{ id: string }>(
      `SELECT id FROM enrichment_jobs WHERE canonical_job_id = ? AND opportunity_version = ?`,
      [canonicalJobId, opportunityVersion]
    );
    expect(allEnrichJobs).toHaveLength(1);
    const sharedJobId = allEnrichJobs[0].id;
    expect(sharedJobId).toBe(job1Id);

    // Invariant: Both runs bound in scrape_run_enrichment_requirements to the single shared job
    const run1Binding = await db.one<{ run_id: string }>(
      `SELECT run_id FROM scrape_run_enrichment_requirements WHERE run_id = ? AND enrichment_job_id = ?`,
      [run1.id, sharedJobId]
    );
    const run2Binding = await db.one<{ run_id: string }>(
      `SELECT run_id FROM scrape_run_enrichment_requirements WHERE run_id = ? AND enrichment_job_id = ?`,
      [run2.id, sharedJobId]
    );
    expect(run1Binding?.run_id).toBe(run1.id);
    expect(run2Binding?.run_id).toBe(run2.id);

    // Both runs report the enrichment job in their progress stats
    const stats1 = await enrichmentQueue.getRunStats(run1.id);
    const stats2 = await enrichmentQueue.getRunStats(run2.id);
    expect(stats1.total).toBe(1);
    expect(stats2.total).toBe(1);
  });

  it("3. Enrichment Completion Releases Requirements & Drives Reconciler to Completed", async () => {
    // 1. Setup run, candidate admission, and enrichment queueing
    const run = await runStore.createRun(scopeA, {
      id: "run-lifecycle-1",
      searchPlanId: "plan_A",
      portalTargets: ["LinkedIn"],
    });
    await db.execute(`UPDATE scrape_runs SET status = 'running' WHERE id = ?`, [run.id]);

    const ingestRes = await canonicalIngest.ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "li-lifecycle-1",
      canonicalUrl: "https://www.linkedin.com/jobs/view/200001",
      jobTitle: "Chief Technology Officer",
      companyName: "Tech Corp",
      location: "Bengaluru",
      rawContent: "Executive engineering leadership opportunity overseeing global engineering teams.",
    }, {
      tenantId: "tenant_A",
      personId: "person_A",
      searchPlanId: "plan_A",
      runId: run.id,
    });

    const enrichJobId = "job_life_1";
    await enrichmentQueue.enqueue(
      enrichJobId,
      "cardhash_life_1",
      "/snapshots/life.json",
      "1.0.0",
      { runId: run.id },
      10,
      0,
      "snapshots/life.json",
      ingestRes.canonicalJobId,
      ingestRes.opportunityVersion
    );

    // 2. Scraper finishes acquisition loop and transitions run to 'enriching'
    await db.execute(`UPDATE scrape_runs SET status = 'enriching' WHERE id = ?`, [run.id]);

    // Check pre-condition: requirement is WAITING_ENRICHMENT
    const reqBefore = await db.one<{ status: string }>(
      `SELECT status FROM evaluation_requirements WHERE canonical_job_id = ? AND opportunity_version = ?`,
      [ingestRes.canonicalJobId, ingestRes.opportunityVersion]
    );
    expect(reqBefore?.status).toBe("WAITING_ENRICHMENT");

    // 3. Enrichment completes (simulating radar-enrich worker)
    await enrichmentQueue.markCompleted(enrichJobId);

    // Invariant: requirement released to READY
    const reqAfter = await db.one<{ status: string }>(
      `SELECT status FROM evaluation_requirements WHERE canonical_job_id = ? AND opportunity_version = ?`,
      [ingestRes.canonicalJobId, ingestRes.opportunityVersion]
    );
    expect(reqAfter?.status).toBe("READY");

    // Invariant: evaluation_jobs row created with status 'pending'
    const evalJob = await db.one<{ id: string; status: string }>(
      `SELECT id, status FROM evaluation_jobs WHERE canonical_job_id = ? AND opportunity_version = ?`,
      [ingestRes.canonicalJobId, ingestRes.opportunityVersion]
    );
    expect(evalJob).not.toBeNull();
    expect(evalJob?.status).toBe("pending");

    // 4. Reconciler runs: enrichment is complete, so run transitions to 'completing'
    const rec1 = await reconciler.reconcileRun(run.id);
    expect(rec1.newStatus).toBe("completing");

    // 5. Evaluation worker claims and executes the job
    const worker = new EvaluationWorker("eval_worker_life", { adapter: db });
    const claimedJob = await worker.claimNextJob();
    expect(claimedJob).not.toBeNull();
    expect(claimedJob?.id).toBe(evalJob!.id);

    const processRes = await worker.processJob(claimedJob!);
    expect(processRes.status).toBe("completed");

    // Invariant: Centralized materialization updated evaluation_requirements to 'SATISFIED'
    const reqSatisfied = await db.one<{ status: string }>(
      `SELECT status FROM evaluation_requirements WHERE canonical_job_id = ? AND opportunity_version = ?`,
      [ingestRes.canonicalJobId, ingestRes.opportunityVersion]
    );
    expect(reqSatisfied?.status).toBe("SATISFIED");

    // 6. Reconciler runs again: all evaluations satisfied -> run transitions to 'completed'
    const rec2 = await reconciler.reconcileRun(run.id);
    expect(rec2.newStatus).toBe("completed");

    const finalRun = await runStore.systemGetRun(run.id);
    expect(finalRun?.status).toBe("completed");
  });

  it("4. Fail-Closed Semantics: Dead-letter evaluation fails the requirement and the referencing scrape run", async () => {
    const run = await runStore.createRun(scopeA, {
      id: "run-failclosed-1",
      searchPlanId: "plan_A",
      portalTargets: ["LinkedIn"],
    });
    await db.execute(`UPDATE scrape_runs SET status = 'completing' WHERE id = ?`, [run.id]);

    const ingestRes = await canonicalIngest.ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "li-fail-1",
      canonicalUrl: "https://www.linkedin.com/jobs/view/300001",
      jobTitle: "VP of Product",
      companyName: "Tech Corp",
      location: "Bengaluru",
      rawContent: "Product executive role overseeing strategic product portfolios.",
    }, {
      tenantId: "tenant_A",
      personId: "person_A",
      searchPlanId: "plan_A",
      runId: run.id,
    });

    const canonicalJobId = ingestRes.canonicalJobId!;
    const opportunityVersion = ingestRes.opportunityVersion!;

    // Release evaluation requirements to READY so evaluation_jobs is created
    await enrichmentQueue.releaseEvaluationRequirements(canonicalJobId, opportunityVersion);

    // Update attempts to max_attempts - 1 so the next failure triggers dead_letter
    await db.execute(
      `UPDATE evaluation_jobs SET attempts = 2, max_attempts = 3
       WHERE canonical_job_id = ? AND opportunity_version = ?`,
      [canonicalJobId, opportunityVersion]
    );

    // Claim the job
    const worker = new EvaluationWorker("worker_fail", { adapter: db });
    const claimed = await worker.claimNextJob();
    expect(claimed).not.toBeNull();

    // Simulate fatal unrecoverable processing error by corrupting raw_content
    await db.execute(`UPDATE opportunity_versions SET raw_content = 'FAIL_FOR_TEST' WHERE canonical_job_id = ?`, [canonicalJobId]);

    const result = await worker.processJob(claimed!);
    expect(result.status).toBe("dead_letter");

    // Invariant: evaluation_requirements status = FAILED
    const reqStatus = await db.one<{ status: string; blocked_reason: string }>(
      `SELECT status, blocked_reason FROM evaluation_requirements
       WHERE canonical_job_id = ? AND opportunity_version = ?`,
      [canonicalJobId, opportunityVersion]
    );
    expect(reqStatus?.status).toBe("FAILED");
    expect(reqStatus?.blocked_reason).toContain("EVALUATION_DEAD_LETTER");

    // Invariant: referencing scrape run is immediately transitioned to 'failed' (Fail-Closed)
    const runState = await runStore.systemGetRun(run.id);
    expect(runState?.status).toBe("failed");
    expect(runState?.errorMessage).toContain("EVALUATION_DEAD_LETTER");
  });

  it("5. Worker Crash & Restart Convergence: Leases expire, second worker recovers and completes", async () => {
    const run = await runStore.createRun(scopeA, {
      id: "run-crash-1",
      searchPlanId: "plan_A",
      portalTargets: ["LinkedIn"],
    });
    await db.execute(`UPDATE scrape_runs SET status = 'enriching' WHERE id = ?`, [run.id]);

    const ingestRes = await canonicalIngest.ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "li-crash-1",
      canonicalUrl: "https://www.linkedin.com/jobs/view/400001",
      jobTitle: "Director of Platform",
      companyName: "Tech Corp",
      location: "Bengaluru",
      rawContent: "Platform engineering leadership overseeing cloud scale.",
    }, {
      tenantId: "tenant_A",
      personId: "person_A",
      searchPlanId: "plan_A",
      runId: run.id,
    });

    const enrichJobId = "job_crash_1";
    await enrichmentQueue.enqueue(
      enrichJobId,
      "cardhash_crash_1",
      "/snapshots/crash.json",
      "1.0.0",
      { runId: run.id },
      10,
      0,
      "snapshots/crash.json",
      ingestRes.canonicalJobId,
      ingestRes.opportunityVersion
    );

    // Simulate Worker 1 leasing the job and crashing:
    // Update job to LEASED with lease timestamp expired in the past (> 300 seconds ago)
    await db.execute(
      `UPDATE enrichment_jobs
       SET status = 'LEASED', lease_owner = 'crashed_worker',
           lease_expires_at = datetime('now', '-300 seconds')
       WHERE id = ?`,
      [enrichJobId]
    );

    // Worker 2 starts up, recovers expired leases, and leases the job
    const recovered = await enrichmentQueue.recoverExpiredLeases();
    expect(recovered).toBeGreaterThanOrEqual(1);

    const leasedJobs = await enrichmentQueue.leaseJobs("worker_survivor", 1);
    expect(leasedJobs).toHaveLength(1);
    expect(leasedJobs[0].id).toBe(enrichJobId);

    // Worker 2 marks it completed
    await enrichmentQueue.markCompleted(leasedJobs[0].id);

    // Evaluation worker claims and completes
    const evalWorker = new EvaluationWorker("eval_worker_crash", { adapter: db });
    const claimed = await evalWorker.claimNextJob();
    expect(claimed).not.toBeNull();
    const evalRes = await evalWorker.processJob(claimed!);
    expect(evalRes.status).toBe("completed");

    // Check that run progresses cleanly through reconciler to completed
    const progress = await reconciler.getRunProgress(run.id);
    expect(progress?.enrichment.completed).toBe(1);
    expect(progress?.enrichment.failed).toBe(0);
    expect(progress?.evaluation.satisfied).toBe(1);

    // Transition from enriching -> completing -> completed
    await reconciler.reconcileRun(run.id);
    const recResult = await reconciler.reconcileRun(run.id);
    expect(recResult.newStatus).toBe("completed");
  });

  it("6. Legacy Work Migration Semantics: Pending jobs without proof are gated as waiting_enrichment", async () => {
    // 1. Ingest an opportunity and release it to create a valid evaluation job row
    const ingestRes = await canonicalIngest.ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "li-legacy-1",
      canonicalUrl: "https://www.linkedin.com/jobs/view/500001",
      jobTitle: "VP of Infrastructure",
      companyName: "Tech Corp",
      location: "Bengaluru",
      rawContent: "Infrastructure leadership role.",
    }, {
      tenantId: "tenant_A",
      personId: "person_A",
      searchPlanId: "plan_A",
    });

    await enrichmentQueue.releaseEvaluationRequirements(
      ingestRes.canonicalJobId!,
      ingestRes.opportunityVersion!
    );

    // 2. Set the status to 'waiting_enrichment' (as migration 042 does for unproven legacy jobs)
    await db.execute(
      `UPDATE evaluation_jobs SET status = 'waiting_enrichment' WHERE canonical_job_id = ?`,
      [ingestRes.canonicalJobId]
    );

    // 3. EvaluationWorker attempts to claim work
    const worker = new EvaluationWorker("worker_legacy", { adapter: db });
    const claimed = await worker.claimNextJob();
    expect(claimed).toBeNull(); // Legacy unproven work is never prematurely claimed!
  });

  it("7. Fail-Closed Semantics: Permanent enrichment failure marks requirement FAILED and fails referencing scrape runs", async () => {
    const run = await runStore.createRun(scopeA, {
      id: "run-enrich-fail-1",
      searchPlanId: "plan_A",
      portalTargets: ["LinkedIn"],
    });
    await db.execute(`UPDATE scrape_runs SET status = 'enriching' WHERE id = ?`, [run.id]);

    const ingestRes = await canonicalIngest.ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "li-perm-fail-1",
      canonicalUrl: "https://www.linkedin.com/jobs/view/600001",
      jobTitle: "Head of Infrastructure",
      companyName: "Tech Corp",
      location: "Bengaluru",
      rawContent: "Infrastructure leadership role.",
    }, {
      tenantId: "tenant_A",
      personId: "person_A",
      searchPlanId: "plan_A",
      runId: run.id,
    });

    const enrichJobId = "job_enrich_fail_1";
    await enrichmentQueue.enqueue(
      enrichJobId,
      "cardhash_perm_fail_1",
      "/snapshots/fail.json",
      "1.0.0",
      { runId: run.id },
      10,
      0,
      "snapshots/fail.json",
      ingestRes.canonicalJobId,
      ingestRes.opportunityVersion
    );

    // Simulate permanent enrichment failure (e.g. 404 page removed)
    await enrichmentQueue.markFailed(enrichJobId, "PERMANENT_HTTP_404", "Page returned HTTP 404 Not Found");

    // Invariant 1: enrichment_jobs status is FAILED
    const enrichJob = await db.one<{ status: string; last_error: string }>(
      `SELECT status, last_error FROM enrichment_jobs WHERE id = ?`,
      [enrichJobId]
    );
    expect(enrichJob?.status).toBe("FAILED");

    // Invariant 2: dependent evaluation_requirements status is FAILED
    const req = await db.one<{ status: string; blocked_reason: string }>(
      `SELECT status, blocked_reason FROM evaluation_requirements
       WHERE canonical_job_id = ? AND opportunity_version = ?`,
      [ingestRes.canonicalJobId, ingestRes.opportunityVersion]
    );
    expect(req?.status).toBe("FAILED");
    expect(req?.blocked_reason).toBe("ENRICHMENT_FAILED");

    // Invariant 3: referencing scrape run is immediately transitioned to 'failed' (Fail-Closed)
    const runState = await runStore.systemGetRun(run.id);
    expect(runState?.status).toBe("failed");
    expect(runState?.errorMessage).toContain("ENRICHMENT_FAILED");
  });

  it("8. End-to-End Multi-Tenant Pipeline Convergence: Two concurrent runs discovering same opportunity converge independently", async () => {
    // 1. Two runs from different tenants
    const run1 = await runStore.createRun(scopeA, {
      id: "run-e2e-tenantA",
      searchPlanId: "plan_A",
      portalTargets: ["LinkedIn"],
    });
    const run2 = await runStore.createRun(scopeB, {
      id: "run-e2e-tenantB",
      searchPlanId: "plan_B",
      portalTargets: ["Indeed"],
    });

    const oppPayload = {
      sourcePortal: "LinkedIn",
      sourceJobId: "li-shared-e2e",
      canonicalUrl: "https://www.linkedin.com/jobs/view/700001",
      jobTitle: "VP Engineering",
      companyName: "Tech Corp",
      location: "Bengaluru",
      rawContent: "Engineering executive role.",
    };

    // Both ingest the same posting
    const ingest1 = await canonicalIngest.ingestOpportunity(oppPayload, {
      tenantId: "tenant_A",
      personId: "person_A",
      searchPlanId: "plan_A",
      runId: run1.id,
    });
    const ingest2 = await canonicalIngest.ingestOpportunity(oppPayload, {
      tenantId: "tenant_B",
      personId: "person_B",
      searchPlanId: "plan_B",
      runId: run2.id,
    });

    // Both enqueue enrichment -> Reused single enrichment job
    const enrichId = "job_shared_e2e_1";
    await enrichmentQueue.enqueue(
      enrichId,
      "cardhash_e2e_1",
      "/snapshots/e2e.json",
      "1.0.0",
      { runId: run1.id },
      10,
      0,
      "snapshots/e2e.json",
      ingest1.canonicalJobId,
      ingest1.opportunityVersion
    );
    await enrichmentQueue.enqueue(
      "job_shared_e2e_2_should_reuse",
      "cardhash_e2e_1",
      "/snapshots/e2e.json",
      "1.0.0",
      { runId: run2.id },
      10,
      0,
      "snapshots/e2e.json",
      ingest2.canonicalJobId,
      ingest2.opportunityVersion
    );

    // Both runs move to 'enriching'
    await db.execute(`UPDATE scrape_runs SET status = 'enriching' WHERE id IN (?, ?)`, [run1.id, run2.id]);

    // Worker enriches and marks completed
    await enrichmentQueue.markCompleted(enrichId);

    // Both runs advance to 'completing' via reconciler
    const recRun1_step1 = await reconciler.reconcileRun(run1.id);
    const recRun2_step1 = await reconciler.reconcileRun(run2.id);
    expect(recRun1_step1.newStatus).toBe("completing");
    expect(recRun2_step1.newStatus).toBe("completing");

    // There are now 2 evaluation jobs (one per tenant)
    const evalWorker = new EvaluationWorker("worker_e2e", { adapter: db });

    // Process evaluation for tenant A
    const jobA = await evalWorker.claimNextJob();
    expect(jobA).not.toBeNull();
    await evalWorker.processJob(jobA!);

    // Reconciler on run 1 should now advance run 1 to completed
    const recRun1_step2 = await reconciler.reconcileRun(run1.id);
    expect(recRun1_step2.newStatus).toBe("completed");

    // Run 2 is still completing because Tenant B job is not yet processed
    const run2Check = await runStore.systemGetRun(run2.id);
    expect(run2Check?.status).toBe("completing");

    // Process evaluation for tenant B
    const jobB = await evalWorker.claimNextJob();
    expect(jobB).not.toBeNull();
    await evalWorker.processJob(jobB!);

    // Reconciler on run 2 now advances run 2 to completed
    const recRun2_step2 = await reconciler.reconcileRun(run2.id);
    expect(recRun2_step2.newStatus).toBe("completed");

    // Both runs independently completed without leaking or missing work!
    const run1Final = await runStore.systemGetRun(run1.id);
    const run2Final = await runStore.systemGetRun(run2.id);
    expect(run1Final?.status).toBe("completed");
    expect(run2Final?.status).toBe("completed");
  });

  it("9. Two-Pipeline Dependency: pipeline-v1 completion does NOT release requirement requiring pipeline-v2; pipeline-v2 completion DOES", async () => {
    const run = await runStore.createRun(scopeA, {
      id: "run-pipe-dep-1",
      searchPlanId: "plan_A",
      portalTargets: ["LinkedIn"],
    });

    const ingest = await canonicalIngest.ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "li-two-pipe-1",
      canonicalUrl: "https://www.linkedin.com/jobs/view/999001",
      jobTitle: "VP of Data",
      companyName: "Tech Corp",
      location: "Bengaluru",
      rawContent: "VP of Data leading enterprise platforms.",
    }, {
      tenantId: "tenant_A",
      personId: "person_A",
      searchPlanId: "plan_A",
      runId: run.id,
    });

    const canonicalJobId = ingest.canonicalJobId!;
    const opportunityVersion = ingest.opportunityVersion!;

    // Explicitly set requirement to require pipeline-v2 (e.g. 2.0.0)
    await db.execute(
      `UPDATE evaluation_requirements
       SET required_enrichment_pipeline_version = '2.0.0', status = 'WAITING_ENRICHMENT'
       WHERE canonical_job_id = ? AND opportunity_version = ?`,
      [canonicalJobId, opportunityVersion]
    );

    // Enqueue two enrichment jobs for same canonical/version: pipeline 1.0.0 and pipeline 2.0.0
    const jobV1Id = "job_v1_pipe";
    const jobV2Id = "job_v2_pipe";

    await enrichmentQueue.enqueue(
      jobV1Id,
      "cardhash_v1",
      "/snapshots/v1.json",
      "1.0.0",
      { runId: run.id },
      10,
      0,
      "snapshots/v1.json",
      canonicalJobId,
      opportunityVersion
    );

    await enrichmentQueue.enqueue(
      jobV2Id,
      "cardhash_v2",
      "/snapshots/v2.json",
      "2.0.0",
      { runId: run.id },
      10,
      0,
      "snapshots/v2.json",
      canonicalJobId,
      opportunityVersion
    );

    // Both jobs exist in enrichment_jobs under different pipeline versions
    const jobs = await db.many<any>(
      `SELECT id, pipeline_version, status FROM enrichment_jobs WHERE canonical_job_id = ? AND opportunity_version = ?`,
      [canonicalJobId, opportunityVersion]
    );
    expect(jobs).toHaveLength(2);

    // Step 1: Complete pipeline 1.0.0
    await enrichmentQueue.markCompleted(jobV1Id);

    // Requirement requiring 2.0.0 MUST STILL BE WAITING_ENRICHMENT
    const reqAfterV1 = await db.one<any>(
      `SELECT status FROM evaluation_requirements WHERE canonical_job_id = ? AND opportunity_version = ?`,
      [canonicalJobId, opportunityVersion]
    );
    expect(reqAfterV1?.status).toBe("WAITING_ENRICHMENT");

    // Evaluation jobs must NOT be created/pending yet
    const evalJobAfterV1 = await db.one<any>(
      `SELECT status FROM evaluation_jobs WHERE canonical_job_id = ? AND opportunity_version = ?`,
      [canonicalJobId, opportunityVersion]
    );
    expect(evalJobAfterV1).toBeNull();

    // Step 2: Complete pipeline 2.0.0
    await enrichmentQueue.markCompleted(jobV2Id);

    // Requirement requiring 2.0.0 MUST NOW BE RELEASED to READY
    const reqAfterV2 = await db.one<any>(
      `SELECT status FROM evaluation_requirements WHERE canonical_job_id = ? AND opportunity_version = ?`,
      [canonicalJobId, opportunityVersion]
    );
    expect(reqAfterV2?.status).toBe("READY");

    // Evaluation job is created and pending
    const evalJobAfterV2 = await db.one<any>(
      `SELECT status FROM evaluation_jobs WHERE canonical_job_id = ? AND opportunity_version = ?`,
      [canonicalJobId, opportunityVersion]
    );
    expect(evalJobAfterV2?.status).toBe("pending");
  });

  it("10. Dead-Letter Invariant: Dead-letter evaluation jobs are never resurrected to pending", async () => {
    const run = await runStore.createRun(scopeA, {
      id: "run-dead-letter-1",
      searchPlanId: "plan_A",
      portalTargets: ["LinkedIn"],
    });

    const ingest = await canonicalIngest.ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "li-dead-letter-1",
      canonicalUrl: "https://www.linkedin.com/jobs/view/999002",
      jobTitle: "VP of Security",
      companyName: "Tech Corp",
      location: "Bengaluru",
      rawContent: "VP of Security leading CISO initiatives.",
    }, {
      tenantId: "tenant_A",
      personId: "person_A",
      searchPlanId: "plan_A",
      runId: run.id,
    });

    const canonicalJobId = ingest.canonicalJobId!;
    const opportunityVersion = ingest.opportunityVersion!;

    // Release to READY and insert evaluation job in dead_letter status
    await enrichmentQueue.releaseEvaluationRequirements(canonicalJobId, opportunityVersion, "1.0.0");
    await db.execute(
      `UPDATE evaluation_jobs SET status = 'dead_letter', attempts = 3
       WHERE canonical_job_id = ? AND opportunity_version = ?`,
      [canonicalJobId, opportunityVersion]
    );

    // Call releaseEvaluationRequirements again (simulating duplicate/late event)
    await enrichmentQueue.releaseEvaluationRequirements(canonicalJobId, opportunityVersion, "1.0.0");

    // Evaluation job must NOT have been resurrected to pending
    const jobAfterRelease = await db.one<any>(
      `SELECT status FROM evaluation_jobs WHERE canonical_job_id = ? AND opportunity_version = ?`,
      [canonicalJobId, opportunityVersion]
    );
    expect(jobAfterRelease?.status).toBe("dead_letter");

    // Reconciler repairDanglingWork must also NOT resurrect dead_letter jobs
    await reconciler.repairDanglingWork();

    const jobAfterRepair = await db.one<any>(
      `SELECT status FROM evaluation_jobs WHERE canonical_job_id = ? AND opportunity_version = ?`,
      [canonicalJobId, opportunityVersion]
    );
    expect(jobAfterRepair?.status).toBe("dead_letter");
  });

  it("11. Self-Healing: Dangling WAITING_ENRICHMENT requirement healed to READY across crash windows", async () => {
    const run = await runStore.createRun(scopeA, {
      id: "run-heal-1",
      searchPlanId: "plan_A",
      portalTargets: ["LinkedIn"],
    });

    const ingest = await canonicalIngest.ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "li-healing-1",
      canonicalUrl: "https://www.linkedin.com/jobs/view/999003",
      jobTitle: "VP of Architecture",
      companyName: "Tech Corp",
      location: "Bengaluru",
      rawContent: "VP of Architecture leading global platform modernization.",
    }, {
      tenantId: "tenant_A",
      personId: "person_A",
      searchPlanId: "plan_A",
      runId: run.id,
    });

    const canonicalJobId = ingest.canonicalJobId!;
    const opportunityVersion = ingest.opportunityVersion!;

    // Enqueue enrichment job and complete it, BUT simulate a crash window where requirement stayed WAITING_ENRICHMENT
    const enrichId = "job_heal_1";
    await enrichmentQueue.enqueue(
      enrichId,
      "cardhash_heal",
      "/snapshots/heal.json",
      "1.0.0",
      { runId: run.id },
      10,
      0,
      "snapshots/heal.json",
      canonicalJobId,
      opportunityVersion
    );

    // Complete the enrichment job directly without calling release
    await db.execute(
      `UPDATE enrichment_jobs SET status = 'COMPLETE', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [enrichId]
    );

    // Requirement is currently dangling in WAITING_ENRICHMENT
    const reqBefore = await db.one<any>(
      `SELECT status FROM evaluation_requirements WHERE canonical_job_id = ? AND opportunity_version = ?`,
      [canonicalJobId, opportunityVersion]
    );
    expect(reqBefore?.status).toBe("WAITING_ENRICHMENT");

    // Reconciler repairs dangling work
    const repaired = await reconciler.repairDanglingWork();
    expect(repaired.requirementsHealed).toBeGreaterThanOrEqual(1);

    // Invariant: requirement is now healed to READY
    const reqAfter = await db.one<any>(
      `SELECT status FROM evaluation_requirements WHERE canonical_job_id = ? AND opportunity_version = ?`,
      [canonicalJobId, opportunityVersion]
    );
    expect(reqAfter?.status).toBe("READY");

    // Invariant: evaluation_job is enqueued as pending
    const evalJob = await db.one<any>(
      `SELECT status FROM evaluation_jobs WHERE canonical_job_id = ? AND opportunity_version = ?`,
      [canonicalJobId, opportunityVersion]
    );
    expect(evalJob?.status).toBe("pending");
  });

  it("12. Scraper Lifecycle: zero newly ingested opportunities but pending work transitions to enriching and reconciles properly", async () => {
    const run = await runStore.createRun(scopeA, {
      id: "run-zero-ingest-1",
      searchPlanId: "plan_A",
      portalTargets: ["LinkedIn"],
    });

    // Ingest an existing opportunity before the run
    const ingest = await canonicalIngest.ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "li-zero-ingest-1",
      canonicalUrl: "https://www.linkedin.com/jobs/view/999004",
      jobTitle: "VP of Platform",
      companyName: "Tech Corp",
      location: "Bengaluru",
      rawContent: "VP of Platform leading foundational infrastructure.",
    }, {
      tenantId: "tenant_A",
      personId: "person_A",
      searchPlanId: "plan_A",
      runId: run.id,
    });

    // Run has 0 newly ingested items in this run's discovery loop, but has pending enrichment work bound
    const enrichId = "job_zero_ingest_1";
    await enrichmentQueue.enqueue(
      enrichId,
      "cardhash_zero",
      "/snapshots/zero.json",
      "1.0.0",
      { runId: run.id },
      10,
      0,
      "snapshots/zero.json",
      ingest.canonicalJobId!,
      ingest.opportunityVersion!
    );

    // Simulate scraper transitioning run to enriching even when ingestedCount === 0
    await runStore.updateRunStatus(scopeA, run.id, "enriching");
    const runStatus = await runStore.getRun(scopeA, run.id);
    expect(runStatus?.status).toBe("enriching");

    // Reconcile: run must NOT complete yet because enrichment is still pending
    const recCheck = await reconciler.reconcileRun(run.id);
    expect(recCheck.newStatus).toBe("enriching");

    // Worker completes enrichment
    await enrichmentQueue.markCompleted(enrichId);

    // Reconcile: advances to completing
    const recCompleting = await reconciler.reconcileRun(run.id);
    expect(recCompleting.newStatus).toBe("completing");

    // Complete evaluation
    const evalWorker = new EvaluationWorker("eval_worker_zero", { adapter: db });
    const job = await evalWorker.claimNextJob();
    expect(job).not.toBeNull();
    await evalWorker.processJob(job!);

    // Reconcile: advances to completed
    const recFinal = await reconciler.reconcileRun(run.id);
    expect(recFinal.newStatus).toBe("completed");
  });
});

