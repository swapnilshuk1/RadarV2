import { getDatabaseAdapter } from "../src/data/database/index.js";

async function run() {
  const db = getDatabaseAdapter();

  console.log("1. Fetching canonical_opportunities...");
  const canonicals = await db.many<any>("SELECT id, source, source_job_id FROM canonical_opportunities");
  const canonicalBySourceJobId = new Map<string, any>();
  const canonicalByPrefixed = new Map<string, any>();
  for (const c of canonicals) {
    canonicalBySourceJobId.set(c.source_job_id, c);
    canonicalByPrefixed.set(`${c.source}:${c.source_job_id}`, c);
  }

  console.log("2. Fetching legacy opportunities...");
  const legacyOpps = await db.many<any>("SELECT id, canonical_title, company_id, location, created_at, fingerprint FROM opportunities");

  console.log("3. Fetching documents in chunks...");
  const docMap = new Map<string, { jobHash?: string; url?: string; title?: string; company?: string; location?: string; description?: string }>();
  const pageSize = 400;
  let offset = 0;
  while (true) {
    const batch = await db.many<any>(`SELECT opportunity_id, content FROM documents WHERE payload_type = 'Structured' LIMIT ${pageSize} OFFSET ${offset}`);
    if (!batch || batch.length === 0) break;
    for (const d of batch) {
      try {
        const parsed = JSON.parse(d.content);
        docMap.set(d.opportunity_id, {
          jobHash: parsed.jobHash,
          url: parsed.url,
          title: parsed.title,
          company: parsed.company,
          location: parsed.location,
          description: parsed.description
        });
      } catch (e) {
        docMap.set(d.opportunity_id, {});
      }
    }
    offset += batch.length;
    console.log(`Fetched ${offset} documents...`);
  }

  let exactMatchDirect = 0;
  let exactMatchDoc = 0;
  let newCanonicalFromDirect = 0;
  let newCanonicalFromDoc = 0;
  let unmappable = 0;

  const toCreateCanonical: any[] = [];
  const orphanLegacy: any[] = [];

  for (const opp of legacyOpps) {
    // Check direct match
    if (canonicalBySourceJobId.has(opp.id) || canonicalByPrefixed.has(opp.id)) {
      exactMatchDirect++;
      continue;
    }

    // Check doc match
    const docInfo = docMap.get(opp.id);
    if (docInfo?.jobHash) {
      if (canonicalBySourceJobId.has(docInfo.jobHash) || canonicalByPrefixed.has(docInfo.jobHash)) {
        exactMatchDoc++;
        continue;
      } else {
        // We have a doc with jobHash, but it's not in canonical_opportunities
        newCanonicalFromDoc++;
        toCreateCanonical.push({
          type: "FROM_DOC_JOBHASH",
          legacyId: opp.id,
          sourceJobId: docInfo.jobHash,
          docInfo
        });
      }
    } else {
      if (opp.id.startsWith("naukri:") || opp.id.startsWith("linkedin:") || opp.id.startsWith("indeed:")) {
        newCanonicalFromDirect++;
        toCreateCanonical.push({
          type: "FROM_DIRECT_ID",
          legacyId: opp.id,
          source: opp.id.split(":")[0],
          sourceJobId: opp.id.split(":").slice(1).join(":")
        });
      } else {
        unmappable++;
        orphanLegacy.push(opp);
      }
    }
  }

  console.log("=== RECONCILIATION SUMMARY ===");
  console.log(`Total Legacy Opportunities: ${legacyOpps.length}`);
  console.log(`Exact Matches (Direct ID match in canonical_opportunities): ${exactMatchDirect}`);
  console.log(`Exact Matches (via Document jobHash in canonical_opportunities): ${exactMatchDoc}`);
  console.log(`Total Matched to Existing Canonical: ${exactMatchDirect + exactMatchDoc}`);
  console.log(`New Canonical Needed (from Direct prefixed ID): ${newCanonicalFromDirect}`);
  console.log(`New Canonical Needed (from Doc jobHash): ${newCanonicalFromDoc}`);
  console.log(`Total New Canonical to Create: ${newCanonicalFromDirect + newCanonicalFromDoc}`);
  console.log(`Unmappable / True Orphans (no doc / no jobHash / unknown ID format): ${unmappable}`);

  if (orphanLegacy.length > 0) {
    console.log("Sample unmappable/orphan legacy opps:", orphanLegacy.slice(0, 5));
  }
  if (toCreateCanonical.length > 0) {
    console.log("Sample new canonical to create:", toCreateCanonical.slice(0, 5));
  }
}

run().catch(console.error);
