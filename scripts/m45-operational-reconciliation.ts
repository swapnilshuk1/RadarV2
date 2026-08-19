import { getDatabaseAdapter } from "../src/data/database/index";

async function main() {
  const adapter = getDatabaseAdapter();

  console.log("============================================================");
  console.log("    M4.5-R1 OPERATIONAL RECONCILIATION AUDIT (DUAL-WRITE)  ");
  console.log("============================================================");

  // 1. Basic Volume Metrics
  const legacyCount = (await adapter.one<{ count: number }>("SELECT COUNT(*) as count FROM opportunities"))?.count || 0;
  const canonicalCount = (await adapter.one<{ count: number }>("SELECT COUNT(*) as count FROM canonical_opportunities"))?.count || 0;
  const versionCount = (await adapter.one<{ count: number }>("SELECT COUNT(*) as count FROM opportunity_versions"))?.count || 0;
  const candidateCount = (await adapter.one<{ count: number }>("SELECT COUNT(*) as count FROM search_plan_candidates"))?.count || 0;

  console.log(`Legacy Opportunities Total : ${legacyCount}`);
  console.log(`Canonical Unique Jobs      : ${canonicalCount}`);
  console.log(`Opportunity Versions Total : ${versionCount}`);
  console.log(`Search Plan Candidates     : ${candidateCount}`);

  console.log("------------------------------------------------------------");

  // 2. Legacy -> Canonical Coverage Matching
  // Legacy opportunities match canonical opportunities via fingerprint = canonical_job_id
  const matched = (await adapter.one<{ count: number }>(`
    SELECT COUNT(*) as count
    FROM opportunities o
    INNER JOIN canonical_opportunities c ON o.fingerprint = c.id
  `))?.count || 0;

  const unmatchedLegacy = legacyCount - matched;
  const unmatchedCanonical = canonicalCount - matched;

  console.log(`Legacy-Canonical Matched   : ${matched}`);
  console.log(`Unmatched Legacy Jobs      : ${unmatchedLegacy} (Pre-M4 acquisitions or un-shadowed)`);
  console.log(`Unmatched Canonical Jobs   : ${unmatchedCanonical} (Direct M4 acquisitions)`);

  console.log("------------------------------------------------------------");

  // 3. Composite Relationship Invariant Audit
  // Composite FK Check: (canonical_job_id, opportunity_version) -> opportunity_versions(canonical_job_id, id)
  const orphanedCandidates = (await adapter.one<{ count: number }>(`
    SELECT COUNT(*) as count
    FROM search_plan_candidates c
    LEFT JOIN opportunity_versions v 
      ON v.canonical_job_id = c.canonical_job_id 
     AND v.id = c.opportunity_version
    WHERE v.id IS NULL
  `))?.count || 0;

  if (orphanedCandidates === 0) {
    console.log("✅ Composite candidate-version referential integrity verified (0 orphans).");
  } else {
    console.log(`❌ FAILED: Found ${orphanedCandidates} candidate projections violating composite (job_id, version_id) FK.`);
  }

  // Version-Job Invariant Check: Every canonical job has at least 1 version
  const orphanedJobs = (await adapter.one<{ count: number }>(`
    SELECT COUNT(*) as count 
    FROM canonical_opportunities c 
    LEFT JOIN opportunity_versions v ON c.id = v.canonical_job_id 
    WHERE v.id IS NULL
  `))?.count || 0;

  if (orphanedJobs === 0) {
    console.log("✅ Canonical job version coverage verified (0 versionless jobs).");
  } else {
    console.log(`❌ FAILED: Found ${orphanedJobs} canonical jobs without an associated version.`);
  }

  console.log("============================================================");
  console.log("M4.5 Operational Reconciliation Audit Completed Successfully.");
}

main().catch(console.error);
