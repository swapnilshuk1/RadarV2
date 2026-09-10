import { getDatabaseAdapter } from "../src/data/database";

async function main() {
  const db = getDatabaseAdapter();
  console.log("Checking current enrichment job status counts...");
  const before = await db.many("SELECT status, count(*) as count FROM enrichment_jobs GROUP BY status");
  console.log("Before:", before);

  const res = await db.execute(`
    UPDATE enrichment_jobs
    SET status = 'PENDING',
        attempts = 0,
        failure_type = NULL,
        last_error = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        next_retry_at = NULL
    WHERE status = 'FAILED'
  `);
  console.log(`Reset ${res.rowsAffected} failed jobs to PENDING.`);

  const after = await db.many("SELECT status, count(*) as count FROM enrichment_jobs GROUP BY status");
  console.log("After:", after);
}

main().catch(console.error);
