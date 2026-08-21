import { getDatabaseAdapter } from "../src/data/database/index.js";

async function verifyAll427Decisions() {
  const db = getDatabaseAdapter();

  console.log("=== VERIFYING ALL 427 CANONICAL DECISIONS ===");

  const res = await db.many<any>(`
    SELECT
      cd.id as canonical_decision_id,
      cd.tenant_id,
      cd.person_id,
      cd.canonical_job_id,
      cd.action as canonical_action,
      co.source,
      co.source_job_id,
      co.company_name,
      d.id as legacy_decision_id,
      d.opportunity_id as legacy_opportunity_id,
      d.action as legacy_action
    FROM canonical_decisions cd
    JOIN canonical_opportunities co ON cd.canonical_job_id = co.id
    LEFT JOIN decisions d ON (
      d.person_id = cd.person_id AND
      (d.opportunity_id = cd.canonical_job_id OR d.opportunity_id = co.source_job_id OR d.opportunity_id = ('j-' || co.source_job_id))
    )
  `);

  console.log(`Total canonical decisions checked: ${res.length}`);

  let matchedWithLegacy = 0;
  let unmatchedWithLegacy = 0;
  let actionMismatches = 0;

  for (const row of res) {
    if (row.legacy_decision_id) {
      matchedWithLegacy++;
      if (row.canonical_action !== row.legacy_action) {
        actionMismatches++;
        console.log("Action mismatch:", row);
      }
    } else {
      unmatchedWithLegacy++;
      console.log("Canonical decision without legacy match:", row);
    }
  }

  console.log(`Matched with legacy: ${matchedWithLegacy}`);
  console.log(`Unmatched with legacy: ${unmatchedWithLegacy}`);
  console.log(`Action mismatches: ${actionMismatches}`);
}

verifyAll427Decisions().catch(console.error);
