import { getDatabaseAdapter } from "../src/data/database/index.js";

async function run() {
  const db = getDatabaseAdapter();
  const job = await db.many("SELECT * FROM evaluation_jobs WHERE canonical_job_id LIKE '%dfe2b1c58eba9140%' OR canonical_job_id LIKE '%a4d9ae9184aa599d%'");
  console.log("Evaluation Jobs:", job);
  
  const acq = await db.many("SELECT * FROM acquisition_ledger WHERE source_job_id LIKE '%dfe2b1c58eba9140%' OR source_job_id LIKE '%a4d9ae9184aa599d%'");
  console.log("Acquisition Ledger:", acq);
}

run().catch(console.error);
