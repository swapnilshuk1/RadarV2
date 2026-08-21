import { getDatabaseAdapter } from "../src/data/database/index.js";

async function checkCanonicalSources() {
  const db = getDatabaseAdapter();

  const canonicals = await db.many<any>("SELECT source, count(*) as count FROM canonical_opportunities GROUP BY source");
  console.log("Canonical sources:", canonicals);

  const sampleCanonical = await db.many<any>("SELECT id, source, source_job_id FROM canonical_opportunities LIMIT 10");
  console.log("Sample canonicals:", sampleCanonical);
}

checkCanonicalSources().catch(console.error);
