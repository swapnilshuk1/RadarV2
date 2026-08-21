import { getDatabaseAdapter } from "../src/data/database/index.js";
import { computeCanonicalJobId } from "../src/lib/domain/canonical_identity.js";

async function verifyAll2904Opportunities() {
  const db = getDatabaseAdapter();

  console.log("=== COMPREHENSIVE 2,904 OPPORTUNITY RECONCILIATION ===");

  const legacyOpps = await db.many<any>(`SELECT id, canonical_title, company_id FROM opportunities`);
  const canonicalOpps = await db.many<any>(`SELECT id, source, source_job_id, canonical_url FROM canonical_opportunities`);

  const canonicalById = new Map(canonicalOpps.map(c => [c.id, c]));
  const canonicalBySourceKey = new Map(canonicalOpps.map(c => [`${c.source.toLowerCase()}:${c.source_job_id}`, c]));
  const canonicalBySourceJobId = new Map(canonicalOpps.map(c => [c.source_job_id, c]));

  // Query documents in batches
  const docToJobHash = new Map<string, { jobHash?: string; source?: string }>();
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
            source: parsed.source
          });
        } catch {}
      }
    }
    offset += docs.length;
  }

  let matchedExactId = 0;
  let matchedColonPrefix = 0;
  let matchedDocJobHash = 0;
  let matchedSourceJobId = 0;
  let unmapped = 0;

  const legacyToCanon = new Map<string, string>();

  for (const opp of legacyOpps) {
    let matchedId: string | null = null;

    // 1. Direct ID match in canonical_opportunities
    if (canonicalById.has(opp.id)) {
      matchedId = opp.id;
      matchedExactId++;
    }

    // 2. Colon prefix (e.g. naukri:123, linkedin:456)
    if (!matchedId && opp.id.includes(':')) {
      const [src, sJobId] = opp.id.split(':');
      const key = `${src.toLowerCase()}:${sJobId}`;
      if (canonicalBySourceKey.has(key)) {
        matchedId = canonicalBySourceKey.get(key)!.id;
        matchedColonPrefix++;
      } else {
        const sourceName = src.toLowerCase() === 'naukri' ? 'Naukri' : 'LinkedIn';
        const computed = computeCanonicalJobId({ source: sourceName, sourceJobId: sJobId });
        if (canonicalById.has(computed)) {
          matchedId = computed;
          matchedColonPrefix++;
        }
      }
    }

    // 3. Document payload jobHash
    if (!matchedId && docToJobHash.has(opp.id)) {
      const doc = docToJobHash.get(opp.id)!;
      if (doc.jobHash) {
        if (canonicalBySourceJobId.has(doc.jobHash)) {
          matchedId = canonicalBySourceJobId.get(doc.jobHash)!.id;
          matchedDocJobHash++;
        } else if (doc.source) {
          const computed = computeCanonicalJobId({ source: doc.source, sourceJobId: doc.jobHash });
          if (canonicalById.has(computed)) {
            matchedId = computed;
            matchedDocJobHash++;
          }
        }
      }
    }

    // 4. Fallback sourceJobId lookup
    if (!matchedId) {
      if (canonicalBySourceJobId.has(opp.id)) {
        matchedId = canonicalBySourceJobId.get(opp.id)!.id;
        matchedSourceJobId++;
      }
    }

    if (matchedId) {
      legacyToCanon.set(opp.id, matchedId);
    } else {
      unmapped++;
    }
  }

  console.log(`\nReconciliation Results:`);
  console.log(`Total Legacy Opportunities:     ${legacyOpps.length}`);
  console.log(`Matched via Exact Canonical ID: ${matchedExactId}`);
  console.log(`Matched via Colon Prefix:       ${matchedColonPrefix}`);
  console.log(`Matched via Document Payload:   ${matchedDocJobHash}`);
  console.log(`Matched via Source Job ID:      ${matchedSourceJobId}`);
  console.log(`Total Successfully Mapped:      ${legacyToCanon.size}`);
  console.log(`Unmapped / Missing:             ${unmapped}`);
}

verifyAll2904Opportunities().catch(console.error);
