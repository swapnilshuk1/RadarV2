/**
 * scripts/benchmarks/test_controlled_scrape.ts
 *
 * Controlled Ingestion Verification Harness:
 * Executes a controlled multi-portal scrape (LinkedIn, Naukri, Indeed)
 * with a constrained query set to certify that Canonical Ingestion succeeds
 * with ZERO foreign key errors.
 */

import { CanonicalIngestionService } from "../../src/lib/acquisition/CanonicalIngestionService";
import { getDatabaseAdapter } from "../../src/data/database/index";

async function runControlledIngestionAudit() {
  console.log("================================================================================");
  console.log("          RADAR CONTROLLED CANONICAL INGESTION CERTIFICATION");
  console.log("================================================================================");

  const db = getDatabaseAdapter();
  const service = new CanonicalIngestionService(db);

  // 1. Audit Test Payloads across all 3 portals
  const testPayloads = [
    {
      sourcePortal: "LinkedIn",
      sourceJobId: "li-controlled-audit-001",
      canonicalUrl: "https://www.linkedin.com/jobs/view/4455145562",
      jobTitle: "Chief Marketing Officer",
      companyName: "Acme Global India",
      location: "Bengaluru, Karnataka, India",
      employmentType: "Full-time",
      rawContent: "Acme Global is hiring an executive Chief Marketing Officer to lead end-to-end brand, performance, and commercial growth across APAC. P&L responsibility for $50M+ marketing budget.",
      postedAt: new Date().toISOString(),
    },
    {
      sourcePortal: "Naukri",
      sourceJobId: "nk-controlled-audit-002",
      canonicalUrl: "https://www.naukri.com/job-listings-cmo-nk-002",
      jobTitle: "Vice President - Growth & Marketing",
      companyName: "TechSphere Solutions",
      location: "Mumbai / Pune, India",
      employmentType: "Full-time",
      rawContent: "TechSphere seeks a VP Growth & Marketing with 15+ years experience scaling high-growth digital businesses and leading marketing transformation.",
      postedAt: new Date().toISOString(),
    },
    {
      sourcePortal: "Indeed",
      sourceJobId: "ind-controlled-audit-003",
      canonicalUrl: "https://in.indeed.com/viewjob?jk=ind003",
      jobTitle: "Head of Marketing",
      companyName: "FinTech Prime",
      location: "Gurugram, Haryana, India",
      employmentType: "Full-time",
      rawContent: "FinTech Prime is looking for an experienced Head of Marketing to oversee brand positioning, customer acquisition, and CRM lifecycle marketing.",
      postedAt: new Date().toISOString(),
    },
  ];

  let discovered = testPayloads.length;
  let ingested = 0;
  let reused = 0;
  let ingestionFailures = 0;
  let candidatesProjected = 0;
  let evaluationJobsQueued = 0;

  console.log(`\n[Test Phase 1] Ingesting ${discovered} fresh multi-portal opportunities...`);

  for (const payload of testPayloads) {
    try {
      const res = await service.ingestOpportunity(payload);
      if (res.isNewOpportunity) {
        ingested++;
      } else {
        reused++;
      }
      candidatesProjected += res.candidatesProjected;
      evaluationJobsQueued += res.jobsEnqueued;
      console.log(`  ✓ Ingested ${payload.sourcePortal} [${payload.sourceJobId}]: version=${res.opportunityVersion.slice(0, 12)}... candidates=${res.candidatesProjected}, jobs=${res.jobsEnqueued}`);
    } catch (err: any) {
      ingestionFailures++;
      console.error(`  ✗ FAILED ${payload.sourcePortal} [${payload.sourceJobId}]: ${err.message}`);
    }
  }

  console.log(`\n[Test Phase 2] Testing Idempotent Re-Ingestion (DO NOTHING Path)...`);
  for (const payload of testPayloads) {
    try {
      const res = await service.ingestOpportunity(payload);
      if (!res.isNewOpportunity) {
        reused++;
      }
      console.log(`  ✓ Re-Ingested ${payload.sourcePortal} [${payload.sourceJobId}]: isNew=${res.isNewOpportunity}, isNewVer=${res.isNewVersion}, version=${res.opportunityVersion.slice(0, 12)}...`);
    } catch (err: any) {
      ingestionFailures++;
      console.error(`  ✗ Re-Ingest FAILED ${payload.sourcePortal} [${payload.sourceJobId}]: ${err.message}`);
    }
  }

  // 2. Referential Lineage Invariant Verification
  const orphans = await db.many<{ canonical_job_id: string }>(
    `SELECT spc.canonical_job_id 
     FROM search_plan_candidates spc
     LEFT JOIN opportunity_versions ov 
       ON spc.canonical_job_id = ov.canonical_job_id 
      AND spc.opportunity_version = ov.id
     WHERE ov.id IS NULL`
  );

  console.log("\n================================================================================");
  console.log("                     CONTROLLED AUDIT METRICS SUMMARY");
  console.log("================================================================================");
  console.log(`Discovered Opportunities   : ${discovered}`);
  console.log(`Fresh Ingestions           : ${ingested}`);
  console.log(`Idempotent Re-Ingestions   : ${reused}`);
  console.log(`Ingestion Failures         : ${ingestionFailures}`);
  console.log(`Candidates Projected       : ${candidatesProjected}`);
  console.log(`Evaluation Jobs Queued     : ${evaluationJobsQueued}`);
  console.log(`Orphaned Foreign Keys      : ${orphans.length}`);
  console.log("================================================================================");

  if (ingestionFailures > 0 || orphans.length > 0) {
    console.error("❌ INGESTION CERTIFICATION FAILED");
    process.exit(1);
  } else {
    console.log("✅ INGESTION CERTIFICATION PASSED (Zero FK Errors, 100% Referential Soundness)");
  }
}

runControlledIngestionAudit().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
