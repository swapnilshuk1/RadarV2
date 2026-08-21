import { getDatabaseAdapter } from "../src/data/database/index.js";

async function inspect56() {
  const db = getDatabaseAdapter();

  const canonicals = await db.many<any>("SELECT id, source, source_job_id FROM canonical_opportunities");
  const canonicalBySourceJobId = new Set(canonicals.map(c => c.source_job_id));
  const canonicalByPrefixed = new Set(canonicals.map(c => `${c.source}:${c.source_job_id}`));

  const legacyOpps = await db.many<any>("SELECT id, canonical_title, company_id, location, created_at, fingerprint FROM opportunities");
  const docs = await db.many<any>("SELECT opportunity_id, content FROM documents WHERE payload_type = 'Structured'");

  const docMap = new Map<string, any>();
  for (const d of docs) {
    try {
      docMap.set(d.opportunity_id, JSON.parse(d.content));
    } catch {}
  }

  const newItems = [];

  for (const opp of legacyOpps) {
    if (canonicalBySourceJobId.has(opp.id) || canonicalByPrefixed.has(opp.id)) {
      continue;
    }
    const doc = docMap.get(opp.id);
    if (doc?.jobHash) {
      if (canonicalBySourceJobId.has(doc.jobHash) || canonicalByPrefixed.has(doc.jobHash)) {
        continue;
      }
      newItems.push({
        sourceType: "doc_jobHash",
        legacyId: opp.id,
        sourceJobId: doc.jobHash,
        source: doc.source || (doc.url?.includes("naukri") ? "naukri" : doc.url?.includes("linkedin") ? "linkedin" : "indeed"),
        url: doc.url,
        title: doc.title || opp.canonical_title,
        company: doc.company,
        location: doc.location || opp.location,
        hasRawContent: !!doc.description || !!doc.raw_content
      });
    } else {
      const parts = opp.id.split(":");
      const source = parts[0];
      const sourceJobId = parts.slice(1).join(":");
      newItems.push({
        sourceType: "direct_prefixed_id",
        legacyId: opp.id,
        sourceJobId,
        source,
        url: doc?.url || null,
        title: doc?.title || opp.canonical_title,
        company: doc?.company || null,
        location: doc?.location || opp.location,
        hasRawContent: !!doc?.description || !!doc?.raw_content
      });
    }
  }

  console.log("Total new items:", newItems.length);
  console.log("Details of first 10 items:");
  console.dir(newItems.slice(0, 10), { depth: null });
}

inspect56().catch(console.error);
