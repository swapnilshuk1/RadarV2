import { getDatabaseAdapter } from "../src/data/database/index.js";
import { EvaluationWorker } from "../src/lib/intelligence/EvaluationWorker.js";

async function inspectError() {
  const db = getDatabaseAdapter();

  const jobs = await db.many<any>("SELECT id, canonical_job_id, opportunity_version, evaluation_context_fingerprint, attempts, last_error FROM evaluation_jobs WHERE status = 'pending' OR last_error IS NOT NULL");
  console.log("Failing jobs:", jobs);

  if (jobs.length > 0) {
    const job = jobs[0];
    const versionRow = await db.one<any>("SELECT raw_content, job_title, company_name, location FROM opportunity_versions WHERE canonical_job_id = ? AND id = ?", [job.canonical_job_id, job.opportunity_version]);
    console.log("Version Row:", versionRow);
  }
}

inspectError().catch(console.error);
