import { getDatabaseAdapter } from "../src/data/database/index.js";

async function inspectJMapping() {
  const db = getDatabaseAdapter();

  const jId = "j-29abec726b5b";
  console.log(`Checking mappings for ${jId}:`);

  const doc = await db.one<any>("SELECT * FROM documents WHERE content LIKE ? LIMIT 1", [`%${jId}%`]);
  console.log("Document matching jId:", doc ? { id: doc.id, opportunity_id: doc.opportunity_id } : "Not found");

  const canon = await db.one<any>("SELECT * FROM canonical_opportunities WHERE id = ? OR source_job_id = ? OR canonical_url LIKE ?", [jId, jId, `%${jId}%`]);
  console.log("Canonical opportunity matching jId:", canon);

  const canonDec = await db.one<any>("SELECT * FROM canonical_decisions WHERE id LIKE ? OR canonical_job_id LIKE ?", [`%${jId}%`, `%${jId}%`]);
  console.log("Canonical decision matching jId:", canonDec);
}

inspectJMapping().catch(console.error);
