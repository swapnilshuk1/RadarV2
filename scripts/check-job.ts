import { getDatabaseAdapter } from "../src/data/database/index.js";

async function run() {
  const db = getDatabaseAdapter();
  const job = await db.one("SELECT * FROM opportunity_versions WHERE canonical_job_id = '9a40084950ce6d5e54a8a0a0e43eebb55f8de0b8b2f92f193ac226f1fcf2cdd2'");
  console.log("job_title:", job.job_title);
  console.log("raw_content start:", job.raw_content.substring(0, 100));
  try {
    const p = JSON.parse(job.raw_content);
    console.log("Parsed keys:", Object.keys(p));
  } catch (err: any) {
    console.log("JSON parse error:", err.message);
  }
}

run().catch(console.error);
