import { getDatabaseAdapter } from "../src/data/database/index.js";

async function inspectSchema() {
  const db = getDatabaseAdapter();
  const info = await db.many("PRAGMA table_info(opportunities)");
  console.log("opportunities columns:", info.map(c => c.name));
}

inspectSchema().catch(console.error);
