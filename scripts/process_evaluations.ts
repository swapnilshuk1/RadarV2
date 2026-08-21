import { getDatabaseAdapter } from "../src/data/database/index.js";
import { EvaluationWorker } from "../src/lib/intelligence/EvaluationWorker.js";

async function processEvaluationQueue() {
  const db = getDatabaseAdapter();
  const worker = new EvaluationWorker("m9_4_migration_evaluator", { adapter: db });

  console.log("=== PROCESSING PENDING EVALUATION JOBS VIA EVALUATION WORKER ===");
  
  const initialPending = await db.one<any>(`
    SELECT COUNT(*) as count FROM evaluation_jobs WHERE status = 'pending'
  `);
  console.log(`Initial pending evaluation jobs: ${initialPending.count}`);

  const results: Record<string, number> = {
    completed: 0,
    retry_scheduled: 0,
    dead_letter: 0,
    stale_lease_lost: 0,
    authorization_failed: 0,
  };

  const processedList = [];

  let consecutiveEmpty = 0;
  while (consecutiveEmpty < 3) {
    const res = await worker.pollAndProcessNext();
    if (!res) {
      consecutiveEmpty++;
      await new Promise(r => setTimeout(r, 500));
      continue;
    }
    consecutiveEmpty = 0;
    results[res.status] = (results[res.status] || 0) + 1;
    processedList.push(res);
    console.log(`[Job: ${res.jobId}] Status: ${res.status} ${res.decision ? `(Decision: ${res.decision})` : ""} ${res.error ? `(Error: ${res.error})` : ""}`);
  }

  console.log("\n=== EVALUATION PROCESSING SUMMARY ===");
  console.log("Results Breakdown:", results);

  const finalJobCounts = await db.many<any>(`
    SELECT status, COUNT(*) as count FROM evaluation_jobs GROUP BY status
  `);
  console.log("Final evaluation_jobs by status:", finalJobCounts);

  const matCount = await db.one<any>(`
    SELECT COUNT(*) as count FROM materialized_evaluations
  `);
  console.log(`Total materialized_evaluations now: ${matCount.count}`);
}

processEvaluationQueue().catch(console.error);
