import { getDatabaseAdapter } from "../src/data/database/index.js";
import { computeCanonicalJobId } from "../src/lib/domain/canonical_identity.js";

async function runAccurateGate4Reconciliation() {
  const db = getDatabaseAdapter();

  console.log("=== GATE 4: ACCURATE DOCUMENT-LINEAGE CANONICAL RECONCILIATION ===");

  const legacyOpps = await db.many<any>(`SELECT id, canonical_title, company_id FROM opportunities`);
  console.log(`Total legacy opportunities: ${legacyOpps.length}`);

  const canonicalOpps = await db.many<any>(`SELECT id, source, source_job_id, canonical_url FROM canonical_opportunities`);
  console.log(`Total canonical opportunities: ${canonicalOpps.length}`);

  const canonicalById = new Map(canonicalOpps.map(c => [c.id, c]));
  const canonicalBySourceKey = new Map(canonicalOpps.map(c => [`${c.source}:${c.source_job_id}`, c]));
  const canonicalBySourceJobId = new Map(canonicalOpps.map(c => [c.source_job_id, c]));

  // Query documents in batches of 500
  const docToJobHash = new Map<string, { jobHash?: string; source?: string; applyUrl?: string }>();
  let offset = 0;
  while (true) {
    const docs = await db.many<any>(`SELECT opportunity_id, content FROM documents LIMIT 500 OFFSET ${offset}`);
    if (docs.length === 0) break;
    for (const doc of docs) {
      if (doc.content) {
        try {
          const parsed = JSON.parse(doc.content);
          docToJobHash.set(doc.opportunity_id, {
            jobHash: parsed.jobHash,
            source: parsed.source,
            applyUrl: parsed.applyUrl
          });
        } catch {}
      }
    }
    offset += docs.length;
    console.log(`Processed ${offset} documents...`);
  }

  let matchedExactId = 0;
  let matchedDocJobHash = 0;
  let matchedDocUrl = 0;
  let matchedNormalizedId = 0;
  let unmatched = 0;
  const unmatchedList: any[] = [];

  for (const opp of legacyOpps) {
    let matchedId: string | null = null;
    let matchMethod = "";

    // 1. Direct ID match
    if (canonicalById.has(opp.id)) {
      matchedId = opp.id;
      matchMethod = "exact_id";
      matchedExactId++;
    } else if (canonicalBySourceJobId.has(opp.id)) {
      matchedId = canonicalBySourceJobId.get(opp.id)!.id;
      matchMethod = "source_job_id";
      matchedExactId++;
    }

    // 2. Document jobHash / source
    if (!matchedId && docToJobHash.has(opp.id)) {
      const doc = docToJobHash.get(opp.id)!;
      if (doc.jobHash) {
        if (canonicalBySourceJobId.has(doc.jobHash)) {
          matchedId = canonicalBySourceJobId.get(doc.jobHash)!.id;
          matchMethod = "doc_job_hash_direct";
          matchedDocJobHash++;
        } else if (doc.source) {
          const cid = computeCanonicalJobId(doc.source, doc.jobHash);
          if (canonicalById.has(cid)) {
            matchedId = cid;
            matchMethod = "doc_job_hash_computed";
            matchedDocJobHash++;
          }
        }
      }
    }

    if (!matchedId) {
      unmatched++;
      unmatchedList.push(opp);
    }
  }

  console.log("\n=== FINAL LINEAGE BREAKDOWN ===");
  console.log(`Total legacy opportunities: ${legacyOpps.length}`);
  console.log(`Matched via exact ID:      ${matchedExactId}`);
  console.log(`Matched via doc jobHash:   ${matchedDocJobHash}`);
  console.log(`Total matched:             ${matchedExactId + matchedDocJobHash}`);
  console.log(`Unmatched:                 ${unmatched}`);

  if (unmatchedList.length > 0) {
    console.log(`\nUnmatched count: ${unmatchedList.length}`);
    console.log("Sample unmatched:", unmatchedList.slice(0, 10));
  }
}

runAccurateGate4Reconciliation().catch(console.error);
