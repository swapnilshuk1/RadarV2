import { getDatabaseAdapter } from "../../src/data/database";

async function checkAndamenVersion() {
  const db = await getDatabaseAdapter();

  const rows = await db.many<any>(
    `SELECT ov.id, ov.job_title, ov.company_name, length(ov.raw_content) as raw_len, 
            substr(ov.raw_content, 1, 300) as preview,
            me.decision, me.quality_score, me.vetoed, me.evaluation_state, me.evaluation_json
     FROM opportunity_versions ov
     LEFT JOIN materialized_evaluations me ON ov.canonical_job_id = me.canonical_job_id
     WHERE ov.job_title LIKE '%Andamen%' OR ov.company_name LIKE '%Andamen%'`
  );

  console.log("Andamen rows in database:", rows.length);
  for (const r of rows) {
    console.log(`Version ID: ${r.id} | Title: "${r.job_title}" | Company: "${r.company_name}"`);
    console.log(`raw_content length in DB: ${r.raw_len} bytes`);
    console.log(`raw_content preview: "${r.preview}"`);
    console.log(`Evaluation: Decision=${r.decision}, Score=${r.quality_score}, Vetoed=${r.vetoed}, State=${r.evaluation_state}`);
    if (r.evaluation_json) {
      try {
        const e = JSON.parse(r.evaluation_json);
        console.log(`Eval JSON summary: verdict=${e.verdict || e.effectiveDecision}, score=${e.qualityScore || e.quality_score}, dims=${JSON.stringify(e.dimensions || e.jobProjection?.dimensions || {})}`);
      } catch (err) {}
    }
  }
}

checkAndamenVersion().catch(console.error);
