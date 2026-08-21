import { getDatabaseAdapter } from "../src/data/database/index.js";

async function verifyGate5Semantics() {
  const db = getDatabaseAdapter();

  console.log("=== GATE 5: POSTING DATE SEMANTIC AUDIT IN OPPORTUNITY_VERSIONS ===");

  let res = null;
  for (let i = 0; i < 3; i++) {
    try {
      res = await db.one<any>(`
        SELECT
          COUNT(*) as total_versions,
          COUNT(posted_at) as populated_posted_at,
          SUM(CASE WHEN posted_at IS NULL THEN 1 ELSE 0 END) as null_posted_at,
          SUM(CASE WHEN posted_precision = 'UNKNOWN' THEN 1 ELSE 0 END) as unknown_precision,
          SUM(CASE WHEN posted_precision = 'EXACT' THEN 1 ELSE 0 END) as exact_precision,
          SUM(CASE WHEN posted_precision = 'APPROXIMATE' THEN 1 ELSE 0 END) as approx_precision,
          SUM(CASE WHEN posted_at = created_at THEN 1 ELSE 0 END) as same_as_created_at
        FROM opportunity_versions
      `);
      break;
    } catch (e: any) {
      console.log(`Attempt ${i+1} failed: ${e.message}, retrying...`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log("Posting Date Metrics:", res);

  const sampleUnknown = await db.many<any>(`SELECT id, canonical_job_id, posted_at, posted_precision, created_at FROM opportunity_versions WHERE posted_precision = 'UNKNOWN' LIMIT 3`);
  console.log("\nSample UNKNOWN records:", sampleUnknown);
}

verifyGate5Semantics().catch(console.error);
