import { getDatabaseAdapter } from "../src/data/database/index.js";

async function runPostMigrationAudit() {
  const db = getDatabaseAdapter();

  console.log("==================================================");
  console.log(" M9.4 POST-MIGRATION RECONCILIATION & INTEGRITY AUDIT");
  console.log("==================================================");

  // 1. Table Counts
  const counts = await db.one<any>(`
    SELECT
      (SELECT COUNT(*) FROM opportunities) as legacy_opportunities,
      (SELECT COUNT(*) FROM documents) as legacy_documents,
      (SELECT COUNT(*) FROM decisions) as legacy_decisions,
      (SELECT COUNT(*) FROM candidate_evaluations) as legacy_evaluations,
      (SELECT COUNT(*) FROM canonical_opportunities) as canonical_opportunities,
      (SELECT COUNT(*) FROM opportunity_versions) as opportunity_versions,
      (SELECT COUNT(*) FROM search_plan_candidates) as search_plan_candidates,
      (SELECT COUNT(*) FROM evaluation_jobs) as evaluation_jobs,
      (SELECT COUNT(*) FROM evaluation_jobs WHERE status = 'completed') as completed_evaluation_jobs,
      (SELECT COUNT(*) FROM evaluation_jobs WHERE status = 'pending') as pending_evaluation_jobs,
      (SELECT COUNT(*) FROM evaluation_jobs WHERE status = 'dead_letter') as dead_letter_evaluation_jobs,
      (SELECT COUNT(*) FROM materialized_evaluations) as materialized_evaluations,
      (SELECT COUNT(*) FROM canonical_decisions) as canonical_decisions
  `);

  console.log("\n[1] Canonical Layer Inventory:");
  console.log(JSON.stringify(counts, null, 2));

  // 2. Check for Orphan Canonical Opportunities (Opportunities without versions)
  const orphanOpps = await db.one<any>(`
    SELECT COUNT(*) as count
    FROM canonical_opportunities co
    LEFT JOIN opportunity_versions ov ON co.id = ov.canonical_job_id
    WHERE ov.id IS NULL
  `);
  console.log(`\n[2] Orphan Canonical Opportunities (no versions): ${orphanOpps.count}`);

  // 3. Check for Orphan Versions (Versions without parent canonical_opportunities)
  const orphanVersions = await db.one<any>(`
    SELECT COUNT(*) as count
    FROM opportunity_versions ov
    LEFT JOIN canonical_opportunities co ON ov.canonical_job_id = co.id
    WHERE co.id IS NULL
  `);
  console.log(`[3] Orphan Opportunity Versions (no parent opp): ${orphanVersions.count}`);

  // 4. Check for Orphan Evaluation Jobs (Jobs without valid version or context)
  const orphanJobs = await db.one<any>(`
    SELECT COUNT(*) as count
    FROM evaluation_jobs ej
    LEFT JOIN opportunity_versions ov ON ej.canonical_job_id = ov.canonical_job_id AND ej.opportunity_version = ov.id
    LEFT JOIN evaluation_contexts ec ON ej.evaluation_context_fingerprint = ec.context_fingerprint
    WHERE ov.id IS NULL OR ec.context_fingerprint IS NULL
  `);
  console.log(`[4] Orphan Evaluation Jobs (invalid version or context): ${orphanJobs.count}`);

  // 5. Check for Orphan Materialized Evaluations
  const orphanMatEvals = await db.one<any>(`
    SELECT COUNT(*) as count
    FROM materialized_evaluations me
    LEFT JOIN canonical_opportunities co ON me.canonical_job_id = co.id
    LEFT JOIN opportunity_versions ov ON me.canonical_job_id = ov.canonical_job_id AND me.opportunity_version = ov.id
    WHERE co.id IS NULL OR ov.id IS NULL
  `);
  console.log(`[5] Orphan Materialized Evaluations (invalid canonical opp or version): ${orphanMatEvals.count}`);

  // 6. Check for Orphan Decisions
  const orphanDecisions = await db.one<any>(`
    SELECT COUNT(*) as count
    FROM canonical_decisions cd
    LEFT JOIN canonical_opportunities co ON cd.canonical_job_id = co.id
    WHERE co.id IS NULL
  `);
  console.log(`[6] Orphan Canonical Decisions (invalid canonical opp): ${orphanDecisions.count}`);

  // 7. Check for Cross-Tenant Violations
  const crossTenantViolations = await db.one<any>(`
    SELECT COUNT(*) as count
    FROM (
      SELECT cd.id FROM canonical_decisions cd
      JOIN people p ON cd.person_id = p.id
      WHERE cd.tenant_id != p.tenant_id
      UNION ALL
      SELECT ej.id FROM evaluation_jobs ej
      JOIN people p ON ej.person_id = p.id
      WHERE ej.tenant_id != p.tenant_id
      UNION ALL
      SELECT me.id FROM materialized_evaluations me
      JOIN people p ON me.person_id = p.id
      WHERE me.tenant_id != p.tenant_id
    )
  `);
  console.log(`[7] Cross-Tenant Violations: ${crossTenantViolations.count}`);

  // 8. Check for Duplicate Canonical Identities
  const duplicateCanonicals = await db.one<any>(`
    SELECT COUNT(*) as count
    FROM (
      SELECT source, source_job_id, COUNT(*) as c
      FROM canonical_opportunities
      GROUP BY source, source_job_id
      HAVING c > 1
    )
  `);
  console.log(`[8] Duplicate Canonical Opportunities (source, source_job_id): ${duplicateCanonicals.count}`);

  // 9. Posting Date Provenance Invariant Verification
  const postingPrecisionBreakdown = await db.many<any>(`
    SELECT posted_precision, COUNT(*) as count
    FROM opportunity_versions
    GROUP BY posted_precision
  `);
  console.log(`[9] Posting Precision Breakdown:`, postingPrecisionBreakdown);

  // 10. Legacy Reconciliation Coverage
  const legacyRecon = await db.one<any>(`
    SELECT
      (SELECT COUNT(*) FROM opportunities) as total_legacy,
      (SELECT COUNT(DISTINCT co.id) FROM canonical_opportunities co) as distinct_canonical,
      (SELECT COUNT(*) FROM canonical_decisions) as valid_canonical_decisions
  `);
  console.log(`[10] Final Reconciliation Verification Summary:`, legacyRecon);

  console.log("\n==================================================");
  console.log(" AUDIT VERDICT: " + (
    orphanOpps.count === 0 &&
    orphanVersions.count === 0 &&
    orphanJobs.count === 0 &&
    orphanMatEvals.count === 0 &&
    orphanDecisions.count === 0 &&
    crossTenantViolations.count === 0 &&
    duplicateCanonicals.count === 0
      ? "✅ 100% PASS - ZERO ANOMALIES"
      : "❌ FAIL - ANOMALIES DETECTED"
  ));
  console.log("==================================================");
}

runPostMigrationAudit().catch(console.error);
