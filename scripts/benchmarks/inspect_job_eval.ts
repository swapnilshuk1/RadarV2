import { getDatabaseAdapter } from "../../src/data/database";

async function inspectJobDetail() {
  const db = await getDatabaseAdapter();

  const row = await db.one<any>(
    `SELECT co.id, ov.job_title, ov.company_name, ov.raw_content, me.evaluation_json, me.rationale, me.decision, me.quality_score, me.vetoed
     FROM canonical_opportunities co
     JOIN opportunity_versions ov ON co.id = ov.canonical_job_id
     LEFT JOIN materialized_evaluations me ON co.id = me.canonical_job_id
     WHERE ov.job_title LIKE '%Head - Marketing - FinTech%'
     LIMIT 1`
  );

  if (row) {
    console.log("Job:", row.job_title, "Company:", row.company_name);
    console.log("Decision:", row.decision, "Score:", row.quality_score, "Vetoed:", row.vetoed);
    console.log("Rationale:", row.rationale);
    console.log("Evaluation JSON:\n", JSON.stringify(JSON.parse(row.evaluation_json || "{}"), null, 2));
    console.log("\nRaw Content Preview (first 1000 chars):\n", row.raw_content?.slice(0, 1000));
  } else {
    console.log("Job not found.");
  }
}

inspectJobDetail().catch(console.error);
