import { getDatabaseAdapter } from "../src/data/database/index.js";
import { EvaluationWorker } from "../src/lib/intelligence/EvaluationWorker.js";

async function retryLastJob() {
  const db = getDatabaseAdapter();

  const deadJobs = await db.many<any>("SELECT * FROM evaluation_jobs WHERE status = 'dead_letter'");
  console.log("Dead letter jobs:", deadJobs);

  if (deadJobs.length > 0) {
    await db.execute(`
      UPDATE evaluation_jobs
      SET status = 'pending',
          attempts = 0,
          last_error = NULL,
          next_attempt_at = CURRENT_TIMESTAMP
      WHERE status = 'dead_letter'
    `);

    const worker = new EvaluationWorker("m9_4_migration_evaluator", { adapter: db });
    const res = await worker.pollAndProcessNext();
    console.log("Processed result:", res);
  }

  const finalJobCounts = await db.many<any>(`
    SELECT status, COUNT(*) as count FROM evaluation_jobs GROUP BY status
  `);
  console.log("Final evaluation_jobs by status:", finalJobCounts);

  const matCount = await db.one<any>(`
    SELECT COUNT(*) as count FROM materialized_evaluations
  `);
  console.log(`Total materialized_evaluations now: ${matCount.count}`);
}

retryLastJob().catch(console.error);
