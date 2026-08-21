import { getDatabaseAdapter } from "../src/data/database/index.js";

async function checkDocs() {
  const db = getDatabaseAdapter();

  const docRows = await db.many<any>(`
    SELECT 
      opportunity_id,
      json_extract(content, '$.jobHash') as job_hash,
      json_extract(content, '$.url') as url,
      json_extract(content, '$.source') as source,
      json_extract(content, '$.sourcePortal') as source_portal,
      json_extract(content, '$.portal') as portal
    FROM documents 
    WHERE payload_type = 'Structured' AND opportunity_id LIKE 'o_%'
  `);

  let countNoSource = 0;
  const samplesNoSource = [];
  for (const d of docRows) {
    const s = d.source || d.source_portal || d.portal || (d.url?.includes("naukri") ? "naukri" : d.url?.includes("linkedin") ? "linkedin" : d.url?.includes("indeed") ? "indeed" : null);
    if (!s) {
      countNoSource++;
      if (samplesNoSource.length < 5) samplesNoSource.push(d);
    }
  }

  console.log("Docs without source:", countNoSource);
  console.log("Samples:", samplesNoSource);
}

checkDocs().catch(console.error);
