import { getDatabaseAdapter } from "../src/data/database/index.js";

async function checkDocKeys() {
  const db = getDatabaseAdapter();

  const doc = await db.one<any>(`
    SELECT content
    FROM documents 
    WHERE payload_type = 'Structured' AND opportunity_id LIKE 'o_%'
    LIMIT 1
  `);

  console.log("Parsed sample document:", JSON.parse(doc.content));
}

checkDocKeys().catch(console.error);
