import { getDatabaseAdapter } from "../src/data/database/index.js";

async function main() {
  const db = getDatabaseAdapter();

  console.log("Fetching null/Unknown company opportunities...");
  const rows = await db.many<{
    canonical_job_id: string;
    opportunity_version: string;
    evaluation_json: string;
  }>(
    `SELECT 
       spc.canonical_job_id,
       spc.opportunity_version,
       me.evaluation_json
     FROM search_plan_candidates spc
     JOIN canonical_opportunities co ON co.id = spc.canonical_job_id
     JOIN materialized_evaluations me ON me.canonical_job_id = spc.canonical_job_id 
       AND me.tenant_id = spc.tenant_id 
       AND me.person_id = spc.person_id
     WHERE (co.company_name IS NULL OR co.company_name = 'Unknown' OR co.company_name = 'Unknown Company')
       AND me.evaluation_json IS NOT NULL`
  );

  console.log(`Found ${rows.length} candidates needing company name backfill.`);

  let updatedCount = 0;
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.evaluation_json);
      const company = parsed.company || parsed.opportunity?.company || parsed.record?.company;
      if (company && company !== "Unknown" && company !== "Unknown Company") {
        await db.execute(
          `UPDATE canonical_opportunities SET company_name = ? WHERE id = ? AND (company_name IS NULL OR company_name = 'Unknown' OR company_name = 'Unknown Company')`,
          [company, r.canonical_job_id]
        );
        await db.execute(
          `UPDATE opportunity_versions SET company_name = ? WHERE id = ? AND (company_name IS NULL OR company_name = 'Unknown' OR company_name = 'Unknown Company')`,
          [company, r.opportunity_version]
        );
        updatedCount++;
      }
    } catch (e) {
      console.error(`Failed to parse/update for ${r.canonical_job_id}:`, e);
    }
  }

  console.log(`Successfully backfilled ${updatedCount} canonical & version company names in Turso DB!`);
}

main().catch(console.error);
