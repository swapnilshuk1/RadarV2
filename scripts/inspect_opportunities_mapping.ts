import { getDatabaseAdapter } from "../src/data/database/index.js";

async function inspectOpportunitiesMapping() {
  const db = getDatabaseAdapter();

  const allOpps = await db.many<any>("SELECT id, canonical_title, company_id, location, created_at, fingerprint FROM opportunities");
  const canonicals = await db.many<any>("SELECT id, source, source_job_id, canonical_url, company_name FROM canonical_opportunities");
  const docs = await db.many<any>("SELECT opportunity_id, content FROM documents WHERE payload_type = 'Structured'");

  const canonicalBySourceJobId = new Map<string, any>();
  const canonicalByPrefixed = new Map<string, any>();
  for (const c of canonicals) {
    canonicalBySourceJobId.set(c.source_job_id, c);
    canonicalByPrefixed.set(`${c.source}:${c.source_job_id}`, c);
  }

  const docJobHashMap = new Map<string, string>();
  for (const d of docs) {
    try {
      const parsed = JSON.parse(d.content);
      if (parsed.jobHash) {
        docJobHashMap.set(d.opportunity_id, parsed.jobHash);
      }
    } catch {}
  }

  let mappedDirect = 0;
  let mappedViaDoc = 0;
  let unmapped = 0;
  const unmappedList: any[] = [];

  for (const opp of allOpps) {
    if (canonicalBySourceJobId.has(opp.id) || canonicalByPrefixed.has(opp.id)) {
      mappedDirect++;
    } else if (docJobHashMap.has(opp.id)) {
      const jobHash = docJobHashMap.get(opp.id)!;
      if (canonicalBySourceJobId.has(jobHash) || canonicalByPrefixed.has(jobHash)) {
        mappedViaDoc++;
      } else {
        unmapped++;
        unmappedList.push({ id: opp.id, reason: "jobHash not in canonical_opportunities", jobHash });
      }
    } else {
      unmapped++;
      unmappedList.push({ id: opp.id, reason: "no jobHash / direct match", title: opp.canonical_title });
    }
  }

  console.log({
    totalLegacyOpportunities: allOpps.length,
    mappedDirect,
    mappedViaDoc,
    totalMapped: mappedDirect + mappedViaDoc,
    unmapped,
    sampleUnmapped: unmappedList.slice(0, 10),
    unmappedBreakdown: unmappedList.reduce((acc, u) => {
      acc[u.reason] = (acc[u.reason] || 0) + 1;
      return acc;
    }, {})
  });
}

inspectOpportunitiesMapping().catch(console.error);
