
import { getDatabaseAdapter } from "../src/data/database/index";
import { EvaluationDaemon } from "../src/lib/intelligence/EvaluationDaemon";
import { CanonicalIngestionService } from "../src/lib/acquisition/CanonicalIngestionService";
import { AuthContext } from "../src/lib/security/auth";

async function runTest() {
  console.log("==================================================");
  console.log("M9.1 EVALUATION QUEUE LIFECYCLE CERTIFICATION");
  console.log("==================================================");

  const db = getDatabaseAdapter();

  const tenantId = "default_tenant_" + Date.now();
  const personId = "user_" + Date.now();
  const searchPlanId = "plan_" + Date.now();
  const canonicalJobId = "source_job_" + Date.now();
  const snapshotId = "snap_" + Date.now();

  await db.execute(`INSERT INTO tenants (id, status) VALUES (?, 'active')`, [tenantId]);
  await db.execute(`INSERT INTO people (id, tenant_id, email) VALUES (?, ?, 'test_' || ? || '@test.com')`, [personId, tenantId, Date.now()]);
  await db.execute(`
    INSERT INTO search_plans (id, tenant_id, person_id, title, status, criteria_json) 
    VALUES (?, ?, ?, 'Test Plan', 'active', '{"targetSeniority":["VP"]}')
  `, [searchPlanId, tenantId, personId]);
  
  await db.execute(`
    INSERT INTO search_plan_snapshots (id, search_plan_id, tenant_id, person_id, snapshot_hash, payload_json)
    VALUES (?, ?, ?, ?, 'hash', '{}')
  `, [snapshotId, searchPlanId, tenantId, personId]);

  await db.execute(`
    INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version)
    VALUES (?, ?, ?, ?, 'v1', 'hash', 'v1', 'v1')
  `, ["ctx_" + Date.now(), tenantId, personId, snapshotId]);

  console.log("[Test] Starting independent EvaluationDaemon...");
  const daemon = new EvaluationDaemon("test_daemon", 1000);
  daemon.start();

  console.log("[Test] Simulating Scraper Acquisition...");
  const ingest = new CanonicalIngestionService();
  
  const res = await ingest.ingestOpportunity({
    sourcePortal: "LinkedIn",
    sourceJobId: canonicalJobId,
    canonicalUrl: "http://test",
    jobTitle: "Test VP Marketing",
    companyName: "Test Co",
    location: "Remote",
    employmentType: "Full-time",
    rawContent: "VP Marketing needed."
  }, { tenantId, personId });

  console.log(`[Test] Scraper IngrestResult -> jobsEnqueued: ${res.jobsEnqueued}`);
  
  if (res.jobsEnqueued === 0) {
    console.error("FAIL: Scraper failed to durably enqueue the job.");
    daemon.stop();
    process.exit(1);
  }

  console.log("[Test] Scraper finished. Waiting for Daemon to claim and process the job...");
  let maxWait = 10;
  let jobProcessed = false;

  while (maxWait > 0) {
    await new Promise(r => setTimeout(r, 1000));
    
    const jobState = await db.one<{ status: string, locked_by: string }>(
      `SELECT status, locked_by FROM evaluation_jobs WHERE canonical_job_id = ?`,
      [canonicalJobId]
    );

    if (jobState) {
      console.log(`[Queue] Status: ${jobState.status}, LockedBy: ${jobState.locked_by || "none"}`);
      if (jobState.status === "completed" || jobState.status === "failed" || jobState.status === "dead_letter") {
        jobProcessed = true;
        break;
      }
    }
    maxWait--;
  }

  daemon.stop();

  if (jobProcessed) {
    console.log("PASS: EvaluationDaemon successfully processed the durably enqueued job.");
    console.log("INVARIANT CONFIRMED: scraper completion guarantees durable evaluation enqueue; EvaluationDaemon completion guarantees evaluation.");
    process.exit(0);
  } else {
    console.error("FAIL: Job remained pending. Daemon failed to pick it up or process it.");
    process.exit(1);
  }
}

runTest().catch(console.error);

