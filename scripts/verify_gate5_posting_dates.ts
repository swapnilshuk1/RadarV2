import { getDatabaseAdapter } from "../src/data/database/index.js";

async function verifyGate5PostingDates() {
  const db = getDatabaseAdapter();

  console.log("=== GATE 5: POSTING DATE SEMANTIC INTEGRITY AUDIT ===");

  const canonOpps = await db.many<any>(`
    SELECT id, posted_at, first_seen_at
    FROM canonical_opportunities
  `);

  let nullPostedAt = 0;
  let populatedPostedAt = 0;
  let equalToFirstSeen = 0;

  for (const o of canonOpps) {
    if (o.posted_at === null || o.posted_at === undefined || o.posted_at === '') {
      nullPostedAt++;
    } else {
      populatedPostedAt++;
      if (o.posted_at === o.first_seen_at) {
        equalToFirstSeen++;
      }
    }
  }

  console.log(`Total canonical opportunities: ${canonOpps.length}`);
  console.log(`Null / Unknown posted_at:     ${nullPostedAt}`);
  console.log(`Populated posted_at:          ${populatedPostedAt}`);
  console.log(`posted_at === first_seen_at:  ${equalToFirstSeen}`);

  const versions = await db.many<any>(`
    SELECT COUNT(*) as total,
           COUNT(posted_at) as populated_posted_at
    FROM canonical_opportunity_versions
  `);
  console.log(`Canonical opportunity versions: total=${versions[0].total}, populated_posted_at=${versions[0].populated_posted_at}`);
}

verifyGate5PostingDates().catch(console.error);
