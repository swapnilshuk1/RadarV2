import { getDatabaseAdapter } from "../src/data/database/index.js";

async function inspectColumns() {
  const db = getDatabaseAdapter();

  const cOppsInfo = await db.many<any>(`PRAGMA table_info(canonical_opportunities)`);
  console.log("canonical_opportunities columns:", cOppsInfo.map(c => c.name));

  const cVersionsInfo = await db.many<any>(`PRAGMA table_info(canonical_opportunity_versions)`);
  console.log("canonical_opportunity_versions columns:", cVersionsInfo.map(c => c.name));
}

inspectColumns().catch(console.error);
