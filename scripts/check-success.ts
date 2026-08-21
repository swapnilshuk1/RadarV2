import { getDatabaseAdapter } from "../src/data/database/index.js";

async function run() {
  const db = getDatabaseAdapter();
  // job_00c58b90_39c82d29_fbcfc83c is the eval job id. Let's find the canonical_job_id from evaluation_jobs.
  const evalJob = await db.one("SELECT * FROM evaluation_jobs WHERE id = 'job_00c58b90_39c82d29_fbcfc83c'");
  if (!evalJob) {
    console.log("job_00c58b90_39c82d29_fbcfc83c not found in evaluation_jobs");
    return;
  }
  const job = await db.one("SELECT * FROM opportunity_versions WHERE canonical_job_id = ?", [evalJob.canonical_job_id]);
  console.log("job_title:", job.job_title);
  console.log("raw_content length:", job.raw_content.length);
  try {
    const p = JSON.parse(job.raw_content);
    console.log("Parsed keys:", Object.keys(p));
  } catch (err: any) {
    console.log("JSON parse error:", err.message);
  }
}

run().catch(console.error);
