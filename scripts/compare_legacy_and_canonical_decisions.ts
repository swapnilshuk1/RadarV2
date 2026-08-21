import { getDatabaseAdapter } from "../src/data/database/index.js";

async function compareDecisions() {
  const db = getDatabaseAdapter();

  const legacyDecisions = await db.many<any>(`SELECT * FROM decisions`);
  const canonicalDecisions = await db.many<any>(`SELECT * FROM canonical_decisions`);
  const canonicalOpps = await db.many<any>(`SELECT * FROM canonical_opportunities`);

  const canonicalBySourceJobId = new Map(canonicalOpps.map(o => [o.source_job_id, o]));
  const canonicalById = new Map(canonicalOpps.map(o => [o.id, o]));

  const legacyMappedToCanonId = new Map<string, any>();
  for (const dec of legacyDecisions) {
    let canon = canonicalById.get(dec.opportunity_id) || canonicalBySourceJobId.get(dec.opportunity_id);
    if (!canon) {
      const stripped = dec.opportunity_id.replace(/^j-/, "");
      canon = canonicalBySourceJobId.get(stripped);
    }
    if (canon) {
      legacyMappedToCanonId.set(canon.id, dec);
    }
  }

  const canonInLegacy = [];
  const canonNotInLegacy = [];

  for (const cd of canonicalDecisions) {
    if (legacyMappedToCanonId.has(cd.canonical_job_id)) {
      canonInLegacy.push(cd);
    } else {
      canonNotInLegacy.push(cd);
    }
  }

  console.log(`Canonical decisions count: ${canonicalDecisions.length}`);
  console.log(`Canonical decisions mapped from legacy: ${canonInLegacy.length}`);
  console.log(`Canonical decisions NOT in legacy: ${canonNotInLegacy.length}`);
  if (canonNotInLegacy.length > 0) {
    console.log("Details of canonical decisions not in legacy:", canonNotInLegacy);
  }
}

compareDecisions().catch(console.error);
