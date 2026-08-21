import { getDatabaseAdapter } from "../src/data/database/index.js";

async function inspectCandidateProfileTables() {
  const db = getDatabaseAdapter();

  const tables = await db.many<any>("SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE '%candidate%' OR name LIKE '%profile%')");
  console.log("Candidate/profile tables:", tables);

  for (const t of tables) {
    const count = await db.one<any>(`SELECT COUNT(*) as c FROM ${t.name}`);
    console.log(`Table ${t.name} count:`, count?.c);
    const sample = await db.many<any>(`SELECT * FROM ${t.name} LIMIT 2`);
    console.log(`Sample from ${t.name}:`, sample);
  }
}

inspectCandidateProfileTables().catch(console.error);
