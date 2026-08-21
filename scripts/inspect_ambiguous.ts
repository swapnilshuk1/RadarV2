import { getDatabaseAdapter } from "../src/data/database/index.js";

async function checkAmbiguous() {
  const db = getDatabaseAdapter();

  const docRows = await db.many<any>(`
    SELECT 
      opportunity_id,
      json_extract(content, '$.jobHash') as job_hash,
      content
    FROM documents 
    WHERE payload_type = 'Structured' AND opportunity_id LIKE 'o_%'
  `);

  const noJobHashDocs = docRows.filter(d => !d.job_hash);
  console.log("o_ docs count:", docRows.length);
  console.log("o_ docs missing job_hash:", noJobHashDocs.length);
  if (noJobHashDocs.length > 0) {
    console.log("Sample missing job_hash doc:", noJobHashDocs[0].opportunity_id, noJobHashDocs[0].content.substring(0, 300));
  }
}

checkAmbiguous().catch(console.error);
