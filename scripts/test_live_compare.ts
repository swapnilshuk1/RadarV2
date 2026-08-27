import { getDatabaseAdapter } from '../src/data/database';

async function main() {
  const db = getDatabaseAdapter();

  const opps = await db.many<any>(`
    SELECT o.*,
           d.content as doc_content,
           disc.source_name as disc_source
    FROM opportunities o
    LEFT JOIN documents d ON d.opportunity_id = o.id
    LEFT JOIN opportunity_discoveries disc ON disc.opportunity_id = o.id
    ORDER BY o.created_at DESC
    LIMIT 10
  `);

  console.log(`Found ${opps.length} recent opportunities:`);
  for (const o of opps) {
    console.log(`\nID: ${o.id}`);
    console.log(`Title: ${o.canonical_title}`);
    console.log(`Company ID: ${o.company_id}`);
    console.log(`Location: ${o.location}`);
    console.log(`Created At: ${o.created_at}`);
    console.log(`Provenance: ${o.provenance}`);
    console.log(`Disc Source: ${o.disc_source}`);
    console.log(`Doc Content length: ${o.doc_content ? o.doc_content.length : 0}`);
    if (o.doc_content) {
      console.log(`Doc sample: ${o.doc_content.slice(0, 150)}...`);
    }
  }
}

main().catch(console.error);
