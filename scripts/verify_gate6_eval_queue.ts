import { getDatabaseAdapter } from "../src/data/database/index.js";

async function verifyGate6EvalQueue() {
  const db = getDatabaseAdapter();

  console.log("=== GATE 6: EVALUATION QUEUE AND MATERIALIZATION AUDIT ===");

  const jobStats = await db.one<any>(`
    SELECT
      COUNT(*) as total_jobs,
      SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_jobs,
      SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending_jobs,
      SUM(CASE WHEN status = 'PROCESSING' THEN 1 ELSE 0 END) as processing_jobs,
      SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed_jobs,
      SUM(CASE WHEN status = 'DEAD_LETTER' THEN 1 ELSE 0 END) as dead_letter_jobs
    FROM evaluation_jobs
  `);

  console.log("Evaluation Jobs Stats:", jobStats);

  const evalStats = await db.one<any>(`
    SELECT
      COUNT(*) as total_materialized,
      COUNT(DISTINCT canonical_job_id) as unique_jobs_materialized,
      COUNT(DISTINCT person_id) as unique_persons,
      COUNT(DISTINCT tenant_id) as unique_tenants
    FROM materialized_evaluations
  `);

  console.log("Materialized Evaluations Stats:", evalStats);

  const dlqStats = await db.one<any>(`
    SELECT COUNT(*) as dlq_count FROM evaluation_dead_letter
  `);
  console.log("Dead Letter Queue Stats:", dlqStats);
}

verifyGate6EvalQueue().catch(console.error);
