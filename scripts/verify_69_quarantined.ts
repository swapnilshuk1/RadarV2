import { getDatabaseAdapter } from "../src/data/database/index.js";

async function verify69Quarantined() {
  const db = getDatabaseAdapter();

  console.log("=== VERIFYING 69 QUARANTINED SYNTHETIC DECISIONS ===");

  const legacyDecisions = await db.many<any>(`
    SELECT d.id, d.person_id, d.opportunity_id, d.action
    FROM decisions d
    LEFT JOIN (
      SELECT DISTINCT person_id, cd.canonical_job_id, co.source_job_id
      FROM canonical_decisions cd
      JOIN canonical_opportunities co ON cd.canonical_job_id = co.id
    ) cdm ON (
      d.person_id = cdm.person_id AND
      (d.opportunity_id = cdm.canonical_job_id OR d.opportunity_id = cdm.source_job_id OR d.opportunity_id = ('j-' || cdm.source_job_id))
    )
    WHERE cdm.canonical_job_id IS NULL
  `);

  console.log(`Total non-migrated (quarantined) legacy decisions: ${legacyDecisions.length}`);

  const categories: Record<string, any[]> = {};
  for (const d of legacyDecisions) {
    let category = "other";
    if (d.opportunity_id.startsWith("op-test-")) category = "op-test-fixtures";
    else if (d.opportunity_id.startsWith("job_rev_")) category = "job-revision-determinism-fixtures";
    else if (d.opportunity_id.startsWith("test-")) category = "test-prefix-fixtures";
    else if (d.opportunity_id.startsWith("job_")) category = "job-id-unit-test-fixtures";
    else if (d.person_id.startsWith("test-user-")) category = "test-user-fixtures";
    else if (d.person_id.startsWith("usr_case_b_")) category = "user-case-fixtures";
    else if (d.person_id.startsWith("p")) category = "short-p-id-test-fixtures";

    categories[category] = categories[category] || [];
    categories[category].push(d);
  }

  for (const [cat, rows] of Object.entries(categories)) {
    console.log(`\nCategory [${cat}] (Count: ${rows.length}):`);
    console.log(rows.slice(0, 5));
  }
}

verify69Quarantined().catch(console.error);
