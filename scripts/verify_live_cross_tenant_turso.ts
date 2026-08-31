import { getDatabaseAdapter } from "../src/data/database";
import { EvaluationWorker } from "../src/lib/intelligence/EvaluationWorker";
import { TenantScopedPersonStore } from "../src/data/sqlite/repositories/TenantScopedPersonStore";
import { TenantIsolationError } from "../src/lib/security/auth";
import type { CandidateProjection } from "../src/lib/domain/candidate_projection";
import { computeEvaluationContextFingerprint } from "../src/lib/domain/evaluation_fingerprint";

async function runLiveCrossTenantVerification() {
  const db = getDatabaseAdapter();
  const now = Date.now();
  console.log("=== RADAR TURSO LIVE CROSS-TENANT & MULTI-JOB VERIFICATION ===");
  console.log(`Execution Timestamp: ${now}`);

  const tenantAlpha = `tenant_live_alpha_${now}`;
  const tenantBeta = `tenant_live_beta_${now}`;
  const userAlpha = `user_live_alpha_${now}`;
  const userBeta = `user_live_beta_${now}`;
  const planAlpha = `plan_live_alpha_${now}`;
  const planBeta = `plan_live_beta_${now}`;

  // 1. Seed Tenants
  await db.execute(`INSERT INTO tenants (id, status) VALUES (?, 'active')`, [tenantAlpha]);
  await db.execute(`INSERT INTO tenants (id, status) VALUES (?, 'active')`, [tenantBeta]);

  // 2. Seed People
  await db.execute(`INSERT INTO people (id, email, tenant_id) VALUES (?, ?, ?)`, [userAlpha, `alpha_${now}@radar.internal`, tenantAlpha]);
  await db.execute(`INSERT INTO people (id, email, tenant_id) VALUES (?, ?, ?)`, [userBeta, `beta_${now}@radar.internal`, tenantBeta]);

  // 3. Projections for Alpha (CCO) and Beta (CTO)
  const projectionCCO: CandidateProjection = {
    operatingLevel: { value: "STRATEGIC", confidence: 0.95, evidenceIds: ["ev_cco_1"] },
    workNature: { value: "STRATEGIC_WORK", confidence: 0.95, evidenceIds: ["ev_cco_2"] },
    decisionAuthority: { value: "ENTERPRISE", confidence: 0.95, evidenceIds: ["ev_cco_3"] },
    commercialScope: { value: "ENTERPRISE", confidence: 0.95, evidenceIds: ["ev_cco_4"] },
    yearsOfExperience: 22,
    coreCapabilities: ["COMMERCIAL_GROWTH", "GLOBAL_GTM", "MARKETING_LEADERSHIP", "P_AND_L_MANAGEMENT"],
    preferredLocations: ["Bengaluru", "Remote"],
    preferredWorkModel: "HYBRID",
    executiveThemes: ["commercial_growth", "gtm_scale"],
    attentionWindow: 6,
    headspaceCapacityPerMonth: 4,
  };

  const projectionCTO: CandidateProjection = {
    operatingLevel: { value: "STRATEGIC", confidence: 0.95, evidenceIds: ["ev_cto_1"] },
    workNature: { value: "STRATEGIC_WORK", confidence: 0.95, evidenceIds: ["ev_cto_2"] },
    decisionAuthority: { value: "ENTERPRISE", confidence: 0.95, evidenceIds: ["ev_cto_3"] },
    commercialScope: { value: "NONE", confidence: 0.95, evidenceIds: ["ev_cto_4"] },
    yearsOfExperience: 18,
    coreCapabilities: ["SOFTWARE_ENGINEERING", "SYSTEM_ARCHITECTURE", "CLOUD_INFRASTRUCTURE", "TECH_LEADERSHIP"],
    preferredLocations: ["San Francisco", "Remote"],
    preferredWorkModel: "REMOTE",
    executiveThemes: ["cloud_infrastructure", "engineering_scale"],
    attentionWindow: 4,
    headspaceCapacityPerMonth: 2,
  };

  // 4. Save projections to career_profiles via TenantScopedPersonStore
  const storeAlpha = new TenantScopedPersonStore(db, { tenantId: tenantAlpha, personId: userAlpha });
  const storeBeta = new TenantScopedPersonStore(db, { tenantId: tenantBeta, personId: userBeta });

  await storeAlpha.saveProjection(userAlpha, projectionCCO);
  await storeBeta.saveProjection(userBeta, projectionCTO);

  console.log("✅ Projections saved in Turso career_profiles for Alpha (CCO) and Beta (CTO).");

  // 5. Test Cross-Tenant Isolation
  console.log("\n--- Testing Cross-Tenant Isolation ---");
  try {
    await storeAlpha.getLatestProjection(userBeta);
    console.error("❌ Isolation failed: storeAlpha was able to request userBeta!");
    process.exit(1);
  } catch (e: any) {
    if (e instanceof TenantIsolationError || e.message.includes("Access denied")) {
      console.log(`✅ Cross-tenant access blocked as expected: ${e.message}`);
    } else {
      console.error("❌ Unexpected error during isolation check:", e);
      process.exit(1);
    }
  }

  // 6. Seed Search Plans
  await db.execute(
    `INSERT INTO search_plans (id, tenant_id, person_id, status, title, criteria_json) VALUES (?, ?, ?, 'active', 'Alpha Plan', '{}')`,
    [planAlpha, tenantAlpha, userAlpha]
  );
  await db.execute(
    `INSERT INTO search_plans (id, tenant_id, person_id, status, title, criteria_json) VALUES (?, ?, ?, 'active', 'Beta Plan', '{}')`,
    [planBeta, tenantBeta, userBeta]
  );

  // 7. Pick 3 real canonical opportunities from Turso
  const realOpps = await db.many<any>(
    `SELECT co.id, ov.id as version_id, ov.job_title, ov.company_name
     FROM canonical_opportunities co
     JOIN opportunity_versions ov ON co.id = ov.canonical_job_id
     LIMIT 3`
  );

  if (realOpps.length < 3) {
    throw new Error(`Expected at least 3 opportunities in Turso, found ${realOpps.length}`);
  }

  const opp1 = realOpps[0];
  const opp2 = realOpps[1];
  const opp3 = realOpps[2];

  console.log(`\nSelected Opportunities:`);
  console.log(`Opp 1: ${opp1.job_title} @ ${opp1.company_name} (${opp1.id})`);
  console.log(`Opp 2: ${opp2.job_title} @ ${opp2.company_name} (${opp2.id})`);
  console.log(`Opp 3: ${opp3.job_title} @ ${opp3.company_name} (${opp3.id})`);

  // 8. Helper to enqueue jobs
  async function enqueueJob(
    jobId: string,
    tenantId: string,
    personId: string,
    planId: string,
    opp: any,
    snapshotPayload: Record<string, any>
  ) {
    const snapId = `snap_${jobId}`;
    const snapHash = `snap_hash_${jobId}`;
    const ctxFp = computeEvaluationContextFingerprint({
      tenantId,
      personId,
      searchPlanSnapshotId: snapId,
      ontologyVersion: "1.0",
      ontologyFingerprint: "ont_fp",
      policyVersion: "1.0",
      profileVersion: "prof_v1",
    });

    await db.execute(
      `INSERT INTO search_plan_snapshots (id, search_plan_id, tenant_id, person_id, snapshot_hash, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [snapId, planId, tenantId, personId, snapHash, JSON.stringify(snapshotPayload)]
    );

    await db.execute(
      `INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version)
       VALUES (?, ?, ?, ?, '1.0', 'ont_fp', '1.0', 'prof_v1')`,
      [ctxFp, tenantId, personId, snapId]
    );

    await db.execute(
      `INSERT OR IGNORE INTO search_plan_candidates (search_plan_id, tenant_id, person_id, canonical_job_id, opportunity_version, attention_decision)
       VALUES (?, ?, ?, ?, ?, 'CANDIDATE')`,
      [planId, tenantId, personId, opp.id, opp.version_id]
    );

    await db.execute(
      `INSERT INTO evaluation_jobs (
         id, tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version,
         evaluation_context_fingerprint, status, locked_by, lease_token, attempts, max_attempts
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, 0, 3)`,
      [jobId, tenantId, personId, planId, opp.id, opp.version_id, ctxFp]
    );
  }

  // 4 Test Jobs:
  // Job 1: Tenant Alpha (CCO) on Opp 1 with empty `{}` snapshot
  const job1Id = `job_live_alpha_opp1_${now}`;
  await enqueueJob(job1Id, tenantAlpha, userAlpha, planAlpha, opp1, {});

  // Job 2: Tenant Beta (CTO) on SAME Opp 1 with empty `{}` snapshot
  const job2Id = `job_live_beta_opp1_${now}`;
  await enqueueJob(job2Id, tenantBeta, userBeta, planBeta, opp1, {});

  // Job 3: Tenant Alpha (CCO) on Opp 2 with criteria-only snapshot
  const job3Id = `job_live_alpha_opp2_${now}`;
  await enqueueJob(job3Id, tenantAlpha, userAlpha, planAlpha, opp2, { criteria: { functions: ["Growth", "Commercial"] } });

  // Job 4: Tenant Alpha (CCO) on Opp 3 with queries-only snapshot
  const job4Id = `job_live_alpha_opp3_${now}`;
  await enqueueJob(job4Id, tenantAlpha, userAlpha, planAlpha, opp3, { queries: ["VP Commercial", "Chief Revenue Officer"] });

  console.log(`\n✅ Enqueued 4 evaluation jobs into Turso:`);
  console.log(`- Job 1: ${job1Id} (Tenant Alpha, User Alpha, Opp 1, snapshot: {})`);
  console.log(`- Job 2: ${job2Id} (Tenant Beta, User Beta, Opp 1, snapshot: {})`);
  console.log(`- Job 3: ${job3Id} (Tenant Alpha, User Alpha, Opp 2, snapshot: criteria-only)`);
  console.log(`- Job 4: ${job4Id} (Tenant Alpha, User Alpha, Opp 3, snapshot: queries-only)`);

  // 9. Execute worker claim and process
  const worker = new EvaluationWorker("cert_worker_live", { adapter: db });
  console.log("\nExecuting worker claim & processing loop...");

  for (let i = 0; i < 4; i++) {
    const claimed = await worker.claimNextJob(tenantAlpha);
    const claimedBeta = claimed ? null : await worker.claimNextJob(tenantBeta);
    const jobToProcess = claimed || claimedBeta;

    if (!jobToProcess) {
      console.log(`No job claimed on iteration ${i + 1}`);
      continue;
    }

    console.log(`Claimed job: ${jobToProcess.id} (tenant: ${jobToProcess.tenantId}, person: ${jobToProcess.personId})`);
    const res = await worker.processJob(jobToProcess);
    console.log(`-> Result for ${jobToProcess.id}: status=${res.status}, decision=${res.decision}`);
  }

  // 10. Audit Turso DB State for the 4 jobs
  const jobResults = await db.many<any>(
    `SELECT id, tenant_id, person_id, status, attempts, last_error, locked_by
     FROM evaluation_jobs
     WHERE id IN (?, ?, ?, ?)`,
    [job1Id, job2Id, job3Id, job4Id]
  );

  console.log("\n--- Final Turso evaluation_jobs Status ---");
  for (const j of jobResults) {
    console.log(`Job ${j.id}: status=${j.status}, attempts=${j.attempts}, last_error=${j.last_error}`);
    if (j.status !== "completed" || j.attempts !== 0 || j.last_error !== null) {
      console.error(`❌ Job ${j.id} did not complete cleanly!`);
      process.exit(1);
    }
  }

  // 11. Audit Materialized Evaluations in Turso
  console.log("\n--- Materialized Evaluations Verification ---");
  const matResults = await db.many<any>(
    `SELECT id, tenant_id, person_id, canonical_job_id, decision, quality_score, evaluation_json
     FROM materialized_evaluations
     WHERE tenant_id IN (?, ?)`,
    [tenantAlpha, tenantBeta]
  );

  console.log(`Total materialized evaluations found: ${matResults.length}`);
  for (const m of matResults) {
    console.log(`\nMaterialized Evaluation ID: ${m.id}`);
    console.log(`Tenant: ${m.tenant_id}, Person: ${m.person_id}`);
    console.log(`Canonical Job: ${m.canonical_job_id}, Decision: ${m.decision}, Quality Score: ${m.quality_score}`);
    
    // Verify JSON payload
    const evalData = JSON.parse(m.evaluation_json);
    expectDefined(evalData, "Evaluation JSON payload");
  }

  console.log("\n============================================================");
  console.log("🎉 ALL LIVE TURSO CROSS-TENANT & MULTI-JOB TESTS PASSED (100%)");
  console.log("============================================================");
}

function expectDefined(val: any, label: string) {
  if (!val) {
    throw new Error(`Assertion failed: ${label} is undefined`);
  }
}

runLiveCrossTenantVerification().catch((err) => {
  console.error("FATAL ERROR in live verification:", err);
  process.exit(1);
});
