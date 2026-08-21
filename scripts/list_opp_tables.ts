import { getDatabaseAdapter } from "../src/data/database/index.js";

async function listOppTables() {
  const db = getDatabaseAdapter();

  const tables = await db.many<any>(`SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE '%opp%' OR name LIKE '%version%')`);
  console.log("Matching tables:", tables.map(t => t.name));

  for (const t of tables) {
    const info = await db.many<any>(`PRAGMA table_info(${t.name})`);
    console.log(`\nTable ${t.name}:`, info.map(c => `${c.name} (${c.type})`));
  }
}

listOppTables().catch(console.error);
