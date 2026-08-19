import { getDatabaseAdapter } from "../src/data/database/index";

async function main() {
  const adapter = getDatabaseAdapter();

  console.log("============================================================");
  console.log("        M4.5 OPERATIONAL RECONCILIATION AUDIT (DUAL-WRITE)  ");
  console.log("============================================================");

  // Measure acquisition count (legacy)
  const legacyCount = await adapter.one<{count: number}>("SELECT COUNT(*) as count FROM opportunities");
  // Unique canonical jobs
  const canonicalCount = await adapter.one<{count: number}>("SELECT COUNT(*) as count FROM canonical_opportunities");
  // Version count
  const versionCount = await adapter.one<{count: number}>("SELECT COUNT(*) as count FROM opportunity_versions");
  // Candidate count
  const candidateCount = await adapter.one<{count: number}>("SELECT COUNT(*) as count FROM search_plan_candidates");

  console.log(`Legacy Opportunities Total : ${legacyCount?.count || 0}`);
  console.log(`Canonical Unique Jobs      : ${canonicalCount?.count || 0}`);
  console.log(`Opportunity Versions Total : ${versionCount?.count || 0}`);
  console.log(`Search Plan Candidates     : ${candidateCount?.count || 0}`);

  console.log("------------------------------------------------------------");
  
  if ((canonicalCount?.count || 0) > 0) {
      console.log("✅ Dual-write is actively projecting to canonical schema.");
  } else {
      console.log("⚠️ Dual-write schema is empty (Expected if no dual-write scrapes have run yet).");
  }

  // Cross-check: Every canonical job should have at least 1 version
  const orphanedJobs = await adapter.one<{count: number}>(`
    SELECT COUNT(*) as count 
    FROM canonical_opportunities c 
    LEFT JOIN opportunity_versions v ON c.id = v.canonical_job_id 
    WHERE v.id IS NULL
  `);

  if ((orphanedJobs?.count || 0) === 0) {
      console.log("✅ No orphaned canonical jobs (100% version coverage).");
  } else {
      console.log(`❌ FAILED: Found ${orphanedJobs?.count} orphaned canonical jobs without a version.`);
  }

  // Cross-check: Ensure Search Plan Candidates map to valid versions
  const orphanedCandidates = await adapter.one<{count: number}>(`
    SELECT COUNT(*) as count 
    FROM search_plan_candidates c 
    LEFT JOIN opportunity_versions v ON c.opportunity_version = v.id 
    WHERE v.id IS NULL
  `);

  if ((orphanedCandidates?.count || 0) === 0) {
      console.log("✅ No orphaned search plan candidates (100% version referential integrity).");
  } else {
      console.log(`❌ FAILED: Found ${orphanedCandidates?.count} candidates pointing to missing versions.`);
  }

  console.log("============================================================");
  console.log("M4.5 Operational Reconciliation Completed.");
}

main().catch(console.error);
