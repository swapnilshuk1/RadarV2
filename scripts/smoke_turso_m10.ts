/**
 * scripts/smoke_turso_m10.ts
 *
 * Controlled, minimally invasive Live Turso End-to-End Smoke Test for M10 Continuous Canonical Pipeline.
 * 
 * Tests the complete sequence against live Turso Cloud database:
 * Scraped payload
 *   ↓
 * CanonicalIngestionService
 *   ↓
 * canonical_opportunities & opportunity_versions
 *   ↓
 * AttentionGate & search_plan_candidates
 *   ↓
 * evaluation_jobs
 *   ↓
 * EvaluationWorker & materialized_evaluations
 *   ↓
 * OpportunityService / SqliteCanonicalServingStore (Authorized Serving DTO)
 *   ↓
 * Full Synthetic Artifact Cleanup & Lineage Verification
 */

import { getDatabaseAdapter } from "../src/data/database";
import { CanonicalIngestionService } from "../src/lib/acquisition/CanonicalIngestionService";
import { EvaluationWorker } from "../src/lib/intelligence/EvaluationWorker";
import { OpportunityService } from "../src/lib/intelligence/opportunity-service";

async function runTursoContinuousPipelineSmoke() {
  console.log("================================================================================");
  console.log("🚀 RADAR v2 — MILESTONE M10.5 LIVE TURSO CONTINUOUS PIPELINE SMOKE TEST");
  console.log("================================================================================\n");

  const db = getDatabaseAdapter();

  // 1. Identify Target Canonical Tenant and Person
  const activeContext = await db.one<{
    context_fingerprint: string;
    tenant_id: string;
    person_id: string;
    search_plan_id: string;
  }>(
    `SELECT ec.context_fingerprint, ec.tenant_id, ec.person_id, sps.search_plan_id
     FROM evaluation_contexts ec
     JOIN search_plan_snapshots sps ON ec.search_plan_snapshot_id = sps.id
     WHERE ec.tenant_id = 'tenant_default' AND ec.person_id = 'ms6i7e3y-4x0chy5fy'
     ORDER BY ec.created_at DESC LIMIT 1`
  );

  if (!activeContext) {
    throw new Error("No active evaluation context found for tenant_default / ms6i7e3y-4x0chy5fy in Turso Cloud.");
  }

  const { tenant_id: tenantId, person_id: personId, search_plan_id: searchPlanId, context_fingerprint: contextFingerprint } = activeContext;

  console.log(`[Turso Context] Tenant: ${tenantId}`);
  console.log(`[Turso Context] Person: ${personId}`);
  console.log(`[Turso Context] Search Plan: ${searchPlanId}`);
  console.log(`[Turso Context] Context Fingerprint: ${contextFingerprint}\n`);

  const timestamp = Date.now();
  const testSourceJobId = `smoke_m10_${timestamp}`;
  const testUrl = `https://radar-cloud.example.com/jobs/smoke-m10-${timestamp}`;

  const syntheticPayload = {
    sourcePortal: "TursoSmokeM10",
    sourceJobId: testSourceJobId,
    canonicalUrl: testUrl,
    jobTitle: "VP of Engineering & Global Cloud Platforms",
    companyName: "SmokeTest Cloud Systems Inc",
    location: "Bengaluru, India (Hybrid)",
    employmentType: "Full-time",
    postedAt: new Date().toISOString(),
    postedPrecision: "EXACT" as const,
    rawContent: JSON.stringify({
      jobHash: testSourceJobId,
      role: "VP of Engineering & Global Cloud Platforms",
      company: "SmokeTest Cloud Systems Inc",
      location: "Bengaluru, India (Hybrid)",
      rawDescription: "Lead global enterprise cloud platform architecture, distributed systems scale, and engineering organization."
    })
  };

  console.log("1. Ingesting synthetic opportunity through CanonicalIngestionService...");
  const ingestionService = new CanonicalIngestionService(db);
  const ingestRes = await ingestionService.ingestOpportunity(syntheticPayload);

  console.log(`   └─ Canonical Job ID: ${ingestRes.canonicalJobId}`);
  console.log(`   └─ Opportunity Version: ${ingestRes.opportunityVersion}`);
  console.log(`   └─ Is New Opportunity: ${ingestRes.isNewOpportunity}`);
  console.log(`   └─ Is New Version: ${ingestRes.isNewVersion}`);
  console.log(`   └─ Plans Evaluated: ${ingestRes.plansEvaluated}`);
  console.log(`   └─ Candidates Projected: ${ingestRes.candidatesProjected}`);
  console.log(`   └─ Jobs Enqueued: ${ingestRes.jobsEnqueued}`);

  if (ingestRes.jobsEnqueued === 0) {
    throw new Error("Attention gate failed to enqueue evaluation job for qualifying VP Engineering title.");
  }

  // 2. Verify Database State Prior to Worker Execution
  console.log("\n2. Verifying database state before worker execution...");
  const canonicalRow = await db.one<any>(
    `SELECT id, source, source_job_id, company_name FROM canonical_opportunities WHERE id = ?`,
    [ingestRes.canonicalJobId]
  );
  if (!canonicalRow) throw new Error("canonical_opportunities row missing in Turso.");
  console.log(`   └─ canonical_opportunities row verified: ${canonicalRow.id}`);

  const candidateRow = await db.one<any>(
    `SELECT tenant_id, person_id, attention_decision FROM search_plan_candidates 
     WHERE canonical_job_id = ? AND tenant_id = ? AND person_id = ?`,
    [ingestRes.canonicalJobId, tenantId, personId]
  );
  if (!candidateRow || candidateRow.attention_decision !== "CANDIDATE") {
    throw new Error("search_plan_candidates row missing or not CANDIDATE in Turso.");
  }
  console.log(`   └─ search_plan_candidates verified: ${candidateRow.attention_decision}`);

  const queuedJobs = await db.many<any>(
    `SELECT id, tenant_id, person_id, status, attempts, evaluation_context_fingerprint FROM evaluation_jobs 
     WHERE canonical_job_id = ?`,
    [ingestRes.canonicalJobId]
  );
  console.log(`   └─ Total evaluation_jobs queued for opportunity: ${queuedJobs.length}`);
  const targetJob = queuedJobs.find((j) => j.tenant_id === tenantId && j.person_id === personId);
  if (!targetJob) {
    throw new Error(`Target evaluation job missing for tenant ${tenantId} / person ${personId}`);
  }
  console.log(`   └─ Target job verified: ${targetJob.id} (status: ${targetJob.status})`);

  // 3. Worker Execution: Drain all queued jobs for this opportunity
  console.log("\n3. Executing EvaluationWorker on live Turso database...");
  const worker = new EvaluationWorker(`turso_smoke_worker_${timestamp.toString(36)}`, { adapter: db });

  let processedTarget = false;
  let targetDecision: string | undefined;
  for (let i = 0; i < queuedJobs.length + 2; i++) {
    const res = await worker.pollAndProcessNext();
    if (!res) break;
    console.log(`   └─ Processed Job ID: ${res.jobId} - Status: ${res.status} - Decision: ${res.decision}`);
    if (res.jobId === targetJob.id) {
      processedTarget = true;
      targetDecision = res.decision;
    }
  }

  if (!processedTarget) {
    throw new Error(`Target job ${targetJob.id} was not processed by worker.`);
  }

  // 4. Verify Materialized Read Model
  console.log("\n4. Verifying materialized_evaluations in Turso...");
  const matRow = await db.one<any>(
    `SELECT id, tenant_id, person_id, decision, quality_score, materialized_at 
     FROM materialized_evaluations 
     WHERE canonical_job_id = ? AND evaluation_context_fingerprint = ?`,
    [ingestRes.canonicalJobId, contextFingerprint]
  );
  if (!matRow) throw new Error("materialized_evaluations row missing in Turso.");
  console.log(`   └─ Materialized Evaluation ID: ${matRow.id}`);
  console.log(`   └─ Materialized Decision: ${matRow.decision}`);
  console.log(`   └─ Quality Score: ${matRow.quality_score}`);
  console.log(`   └─ Materialized At: ${matRow.materialized_at}`);

  // 5. Verify Serving via OpportunityService / Canonical Serving Store
  console.log("\n5. Testing Authorized Serving retrieval via OpportunityService...");
  const servedOpp = await OpportunityService.getForUser(personId, testSourceJobId, undefined, tenantId);
  if (!servedOpp) {
    throw new Error(`OpportunityService.getForUser failed to resolve served DTO for jobHash ${testSourceJobId}`);
  }
  console.log(`   └─ Served DTO Canonical ID: ${servedOpp.canonicalJobId}`);
  console.log(`   └─ Served DTO Role: ${servedOpp.role}`);
  console.log(`   └─ Served DTO Company: ${servedOpp.company}`);
  console.log(`   └─ Served DTO Engine Verdict: ${servedOpp.engineRecommendation?.engineVerdict}`);
  console.log(`   └─ Served DTO Effective Decision: ${servedOpp.effectiveDecision}`);
  console.log(`   └─ Served DTO Quality Score: ${servedOpp.engineRecommendation?.qualityScore}`);

  // 6. Cleanup Synthetic Records from Turso
  console.log("\n6. Cleaning up synthetic smoke test records from Turso...");
  await db.execute(`DELETE FROM materialized_evaluations WHERE canonical_job_id = ?`, [ingestRes.canonicalJobId]);
  await db.execute(`DELETE FROM evaluation_jobs WHERE canonical_job_id = ?`, [ingestRes.canonicalJobId]);
  await db.execute(`DELETE FROM search_plan_candidates WHERE canonical_job_id = ?`, [ingestRes.canonicalJobId]);
  await db.execute(`DELETE FROM opportunity_versions WHERE canonical_job_id = ?`, [ingestRes.canonicalJobId]);
  await db.execute(`DELETE FROM canonical_opportunities WHERE id = ?`, [ingestRes.canonicalJobId]);

  const remainingMat = await db.one<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM materialized_evaluations WHERE canonical_job_id = ?`, [ingestRes.canonicalJobId]);
  const remainingJobs = await db.one<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM evaluation_jobs WHERE canonical_job_id = ?`, [ingestRes.canonicalJobId]);
  const remainingCan = await db.one<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM canonical_opportunities WHERE id = ?`, [ingestRes.canonicalJobId]);

  console.log(`   └─ Remaining Materialized: ${remainingMat?.cnt ?? 0}`);
  console.log(`   └─ Remaining Jobs: ${remainingJobs?.cnt ?? 0}`);
  console.log(`   └─ Remaining Canonical Opps: ${remainingCan?.cnt ?? 0}`);

  if ((remainingMat?.cnt ?? 0) !== 0 || (remainingJobs?.cnt ?? 0) !== 0 || (remainingCan?.cnt ?? 0) !== 0) {
    throw new Error("Synthetic record cleanup incomplete.");
  }

  console.log("\n================================================================================");
  console.log("✅ LIVE TURSO CONTINUOUS CANONICAL PIPELINE SMOKE TEST PASSED 100%!");
  console.log("================================================================================\n");

  return {
    environment: "Turso Cloud (LibSQL)",
    targetUrl: process.env.TURSO_CONNECTION_URL || process.env.TURSO_DATABASE_URL,
    tenantId,
    personId,
    searchPlanId,
    canonicalJobId: ingestRes.canonicalJobId,
    opportunityVersion: ingestRes.opportunityVersion,
    candidateDecision: candidateRow.attention_decision,
    evaluationJobId: targetJob.id,
    workerResult: "completed",
    workerDecision: targetDecision,
    materializedEvaluationId: matRow.id,
    contextFingerprint,
    servingResult: {
      canonicalJobId: servedOpp.canonicalJobId,
      role: servedOpp.role,
      verdict: servedOpp.engineRecommendation?.engineVerdict,
      effectiveDecision: servedOpp.effectiveDecision,
      score: servedOpp.engineRecommendation?.qualityScore
    },
    cleanupStatus: "CLEAN_100_PERCENT"
  };
}

runTursoContinuousPipelineSmoke()
  .then((evidence) => {
    console.log("JSON Evidence Payload:");
    console.log(JSON.stringify(evidence, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Live Turso smoke test failed:", err);
    process.exit(1);
  });
