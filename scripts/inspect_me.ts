import { getDatabaseAdapter } from "../src/data/database/index.js";

async function main() {
  const db = getDatabaseAdapter();
  
  const evals = await db.many(`
    SELECT me.id, me.canonical_job_id, me.decision, me.quality_score, me.rationale, me.evaluation_json, ov.raw_content, ov.job_title
    FROM materialized_evaluations me
    JOIN opportunity_versions ov ON ov.id = me.opportunity_version
    LIMIT 10
  `);
  
  console.log("Sample Materialized Evaluations:");
  for (const e of evals) {
    const rawParsed = JSON.parse(e.evaluation_json || "{}");
    const words = (ov_raw: string) => (ov_raw || "").trim().split(/\s+/).filter(Boolean).length;
    console.log(`\nEval ${e.canonical_job_id}:`);
    console.log(`  Title: ${e.job_title}`);
    console.log(`  Decision in ME: ${e.decision}`);
    console.log(`  Quality Score: ${e.quality_score}`);
    console.log(`  Raw Content Word Count: ${words(e.raw_content)} words (${(e.raw_content || "").length} chars)`);
    console.log(`  Engine Verdict in JSON:`, rawParsed.engineRecommendation?.engineVerdict);
    console.log(`  Decision in JSON:`, rawParsed.decision);
    console.log(`  EvaluationStatus in JSON:`, rawParsed.evaluationStatus);
    console.log(`  Rationale:`, e.rationale);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
