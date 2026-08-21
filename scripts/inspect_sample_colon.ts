import { getDatabaseAdapter } from "../src/data/database/index.js";

async function main() {
  const db = getDatabaseAdapter();
  const sampleLegacy = await db.many<any>(
    `SELECT o.id as legacy_id, o.canonical_title, d.id as doc_id, d.content as doc_content 
     FROM opportunities o 
     LEFT JOIN documents d ON d.opportunity_id = o.id 
     WHERE o.id LIKE '%:%' LIMIT 5`
  );

  for (const item of sampleLegacy) {
    const sJobId = item.legacy_id.split(':')[1];
    const matches = await db.many<any>(
      `SELECT id, source, source_job_id, company_name, canonical_url 
       FROM canonical_opportunities 
       WHERE canonical_url LIKE '%' || ? || '%' OR source_job_id LIKE '%' || ? || '%' OR id LIKE '%' || ? || '%'`,
      [sJobId, sJobId, sJobId]
    );
    console.log(`\nLegacy ID: ${item.legacy_id} | Title: ${item.canonical_title}`);
    console.log(`Doc ID: ${item.doc_id} | Doc Content preview:`, item.doc_content ? item.doc_content.slice(0, 150) : "NO DOC");
    console.log(`Canonical matches:`, matches);
  }
}

main().catch(console.error);
