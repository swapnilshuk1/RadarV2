import { getDatabaseAdapter } from "../src/data/database/index.js";
import { EvaluationWorker } from "../src/lib/intelligence/EvaluationWorker.js";

async function run() {
  const db = getDatabaseAdapter();
  
  const job = await db.one(`SELECT * FROM evaluation_jobs WHERE id = ?`, ["job_9a400849_32734e3d_fbcfc83c"]);
  if (!job) {
    console.log("Job not found!");
    return;
  }
  
  console.log("Found job:", job);
  
  const worker = new EvaluationWorker("debug-worker");
  
  // Override db.execute to catch the update so we can see the exact error msg!
  const origExecute = db.execute.bind(db);
  db.execute = async (sql: string, params: any) => {
    if (sql.includes("UPDATE evaluation_jobs")) {
      console.log("UPDATE PARAMS:", params);
    }
    return origExecute(sql, params);
  };
  
  try {
    const mappedJob = {
      id: job.id,
      tenantId: job.tenant_id,
      personId: job.person_id,
      canonicalJobId: job.canonical_job_id,
      opportunityVersion: job.opportunity_version,
      evaluationContextFingerprint: job.evaluation_context_fingerprint,
      status: job.status,
      attempts: 0,
      maxAttempts: 3,
      leaseToken: "debug-token"
    };
    
    await origExecute(`UPDATE evaluation_jobs SET status = 'processing', locked_by = 'debug-worker', lease_token = 'debug-token' WHERE id = ?`, [job.id]);
    
    const res = await worker['processJob'](mappedJob as any);
    console.log("Result:", res);
  } catch (err: any) {
    console.error("Caught error:", err.message);
    console.error(err.stack);
  }
}

run().catch(console.error);
