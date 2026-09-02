/**
 * scripts/benchmarks/inspect_eval_json.ts
 */
import { getDatabaseAdapter } from "../../src/data/database/index";

async function main() {
  const db = getDatabaseAdapter();
  const row = await db.one<{ evaluation_json: string }>(
    `SELECT evaluation_json FROM materialized_evaluations 
     WHERE canonical_job_id = (SELECT id FROM canonical_opportunities WHERE source_job_id = 'li-cmo-enterprise-001')`
  );
  if (row?.evaluation_json) {
    const data = JSON.parse(row.evaluation_json);
    console.log("Evaluation JSON:", JSON.stringify(data, null, 2));
  } else {
    console.log("No evaluation json found.");
  }
}

main().catch(console.error);
