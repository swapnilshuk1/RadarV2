import { getDatabaseAdapter } from "../src/data/database/index.js";

async function inspectEvalJobs() {
  const db = getDatabaseAdapter();

  const statuses = await db.many<any>(`SELECT status, count(*) as count FROM evaluation_jobs GROUP BY status`);
  console.log("Evaluation jobs status breakdown:", statuses);

  const sample = await db.many<any>(`SELECT id, canonical_job_id, status, error_message FROM evaluation_jobs LIMIT 5`);
  console.log("Sample evaluation jobs:", sample);
}

inspectEvalJobs().catch(console.error);
