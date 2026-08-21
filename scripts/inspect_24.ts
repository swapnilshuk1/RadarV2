import { getDatabaseAdapter } from "../src/data/database/index.js";

async function inspect24() {
  const db = getDatabaseAdapter();

  const canonicals = await db.many<any>("SELECT id, source, source_job_id FROM canonical_opportunities");
  const canonicalBySourceJobId = new Map<string, any>();
  for (const c of canonicals) {
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
      json_extract(content, '$.source') as source,
      json_extract(content, '$.normalizedText') as normalized_text,
      json_extract(content, '$.raw_content') as raw_content,
      json_extract(content, '$.description') as description,
      json_extract(content, '$.posted_at') as posted_at,
      json_extract(content, '$.posted_precision') as posted_precision
    FROM documents 
    WHERE payload_type = 'Structured'
  `);

  const docMap = new Map<string, any>();
  for (const d of docRows) {
    docMap.set(d.opportunity_id, d);
  }

  const new24 = [];

  for (const opp of legacyOpps) {
    let sourceJobId = "";
    let source = "";

    if (opp.id.startsWith("o_")) {
      const doc = docMap.get(opp.id);
      if (doc && doc.job_hash) {
        sourceJobId = doc.job_hash;
        source = doc.source || (doc.url?.includes("naukri") ? "Naukri" : doc.url?.includes("linkedin") ? "LinkedIn" : "Indeed");
      }
    } else if (opp.id.startsWith("opp_")) {
      sourceJobId = opp.id.replace(/^opp_/, "");
      source = "legacy_opp";
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

    if (!matched) {
      const doc = docMap.get(opp.id);
      new24.push({
        legacyId: opp.id,
        source: source || (doc?.url?.includes("naukri") ? "Naukri" : doc?.url?.includes("linkedin") ? "LinkedIn" : "Indeed"),
        sourceJobId,
        title: doc?.title || opp.canonical_title,
        company: doc?.company || opp.company_name,
        location: doc?.location || opp.location,
        url: doc?.url,
        hasNormalizedText: !!doc?.normalized_text,
        hasDescription: !!doc?.description,
        hasRawContent: !!doc?.raw_content,
        postedAt: doc?.posted_at || null,
        postedPrecision: doc?.posted_precision || "UNKNOWN"
      });
    }
  }

  console.log("All 24 items to migrate:");
  console.dir(new24, { depth: null });
}

inspect24().catch(console.error);
