import { getDatabaseAdapter } from "../src/data/database/index.js";

async function refinedAudit() {
  const db = getDatabaseAdapter();

  const canonicals = await db.many<any>("SELECT id, source, source_job_id, canonical_url, company_name FROM canonical_opportunities");
  const canonicalById = new Map<string, any>();
  const canonicalBySourceJobId = new Map<string, any>();
  for (const c of canonicals) {
    canonicalById.set(c.id, c);
    canonicalBySourceJobId.set(c.source_job_id, c);
    canonicalBySourceJobId.set(c.source_job_id.toLowerCase(), c);
    canonicalBySourceJobId.set(`${c.source}:${c.source_job_id}`.toLowerCase(), c);
  }

  const legacyOpps = await db.many<any>("SELECT o.id, o.canonical_title, o.company_id, o.location, o.created_at, o.employment_type, c.name as company_name FROM opportunities o LEFT JOIN companies c ON o.company_id = c.id");

  const docRows = await db.many<any>(`
    SELECT 
      opportunity_id,
      json_extract(content, '$.jobHash') as job_hash,
      json_extract(content, '$.url') as url,
      json_extract(content, '$.title') as title,
      json_extract(content, '$.company') as company,
      json_extract(content, '$.location') as location,
      json_extract(content, '$.source') as source
    FROM documents 
    WHERE payload_type = 'Structured'
  `);

  const docMap = new Map<string, any>();
  for (const d of docRows) {
    docMap.set(d.opportunity_id, d);
  }

  let exactMatches = 0;
  const newCanonicalCandidates = [];
  const orphanLegacyOpps = [];

  for (const opp of legacyOpps) {
    let sourceJobId = "";
    let source = "";

    if (opp.id.startsWith("o_")) {
      const doc = docMap.get(opp.id);
      if (doc && doc.job_hash) {
        sourceJobId = doc.job_hash;
        source = doc.source || "legacy_document";
      }
    } else if (opp.id.includes(":")) {
      const parts = opp.id.split(":");
      source = parts[0];
      sourceJobId = parts.slice(1).join(":");
    } else {
      sourceJobId = opp.id;
      source = "legacy";
    }

    const matched = canonicalBySourceJobId.get(sourceJobId) || 
                    canonicalBySourceJobId.get(sourceJobId.toLowerCase()) ||
                    canonicalBySourceJobId.get(opp.id) ||
                    canonicalBySourceJobId.get(opp.id.toLowerCase());

    if (matched) {
      exactMatches++;
    } else {
      if (sourceJobId) {
        newCanonicalCandidates.push({
          legacyId: opp.id,
          source: source || (opp.id.includes(":") ? opp.id.split(":")[0] : "legacy"),
          sourceJobId,
          title: opp.canonical_title,
          company: opp.company_name,
          location: opp.location
        });
      } else {
        orphanLegacyOpps.push(opp);
      }
    }
  }

  console.log("=== EXACT OPPORTUNITY RECONCILIATION ===");
  console.log(`Total Legacy Opportunities: ${legacyOpps.length}`);
  console.log(`Exact Matches to existing canonical_opportunities: ${exactMatches}`);
  console.log(`New Canonical Opportunities to create: ${newCanonicalCandidates.length}`);
  console.log(`Orphans (no source_job_id identifiable): ${orphanLegacyOpps.length}`);
  console.log(`Sum check: ${exactMatches + newCanonicalCandidates.length + orphanLegacyOpps.length} === ${legacyOpps.length}`);

  if (newCanonicalCandidates.length > 0) {
    console.log("Sample new canonical candidates (first 5):", newCanonicalCandidates.slice(0, 5));
  }
}

refinedAudit().catch(console.error);
