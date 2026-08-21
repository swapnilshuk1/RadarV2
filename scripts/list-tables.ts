import { getDatabaseAdapter } from "../src/data/database/index";

async function run() {
  const db = getDatabaseAdapter();
  console.log("─────────────────────────────");
  console.log("Database Tables:");
  console.log("─────────────────────────────");
  const tables = await db.many("SELECT name FROM sqlite_master WHERE type='table'");
  tables.forEach((t: any) => console.log(" -", t.name));
}

run().catch(console.error);
