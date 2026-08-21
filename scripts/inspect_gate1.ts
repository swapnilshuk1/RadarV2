import { getDatabaseAdapter } from "../src/data/database/index.js";

async function inspectGate1() {
  const db = getDatabaseAdapter();

  console.log("=== GATE 1 LIVE SCHEMA INSPECTION ===");

  const canonicalDecisionsSql = await db.one<any>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'canonical_decisions'"
  );
  console.log("canonical_decisions SQL:\n", canonicalDecisionsSql?.sql);

  const peopleSql = await db.one<any>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'people'"
  );
  console.log("\npeople SQL:\n", peopleSql?.sql);

  const fkList = await db.many<any>("PRAGMA foreign_key_list(canonical_decisions)");
  console.log("\nPRAGMA foreign_key_list(canonical_decisions):\n", fkList);

  const peopleIndexes = await db.many<any>("PRAGMA index_list(people)");
  console.log("\nPRAGMA index_list(people):\n", peopleIndexes);

  for (const idx of peopleIndexes) {
    const idxInfo = await db.many<any>(`PRAGMA index_info(${idx.name})`);
    console.log(`Index ${idx.name} info:`, idxInfo);
  }
}

inspectGate1().catch(console.error);
