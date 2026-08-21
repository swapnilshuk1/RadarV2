import { getDatabaseAdapter } from "../src/data/database/index.js";

async function inspect12() {
  const db = getDatabaseAdapter();

  const legacyDecisions = await db.many<any>(`SELECT * FROM decisions`);
  const canonicalDecisions = await db.many<any>(`SELECT * FROM canonical_decisions`);
  const canonicalOpps = await db.many<any>(`SELECT * FROM canonical_opportunities`);

  const canonicalBySourceJobId = new Map(canonicalOpps.map(o => [o.source_job_id, o]));
  const canonicalById = new Map(canonicalOpps.map(o => [o.id, o]));
  const canonDecMap = new Map(canonicalDecisions.map(cd => [`${cd.person_id}:${cd.canonical_job_id}`, cd]));

  for (const dec of legacyDecisions) {
    let canon = canonicalById.get(dec.opportunity_id) || canonicalBySourceJobId.get(dec.opportunity_id);
    if (!canon) {
      const stripped = dec.opportunity_id.replace(/^j-/, "");
      canon = canonicalBySourceJobId.get(stripped);
    }
    if (canon) {
      const key = `${dec.person_id}:${canon.id}`;
      if (!canonDecMap.has(key)) {
        console.log("Unmapped decision:", dec, "Matched canonical opp:", { id: canon.id, source: canon.source, source_job_id: canon.source_job_id });
      }
    }
  }
}

inspect12().catch(console.error);
