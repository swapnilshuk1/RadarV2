import { getDatabaseAdapter } from "../src/data/database/index.js";

async function inspectDecisions() {
  const db = getDatabaseAdapter();
  console.log("Canonical decisions count:", await db.one("SELECT COUNT(*) as c FROM canonical_decisions"));
  console.log("Sample canonical decisions:", await db.many("SELECT * FROM canonical_decisions LIMIT 5"));
  console.log("Legacy decisions count:", await db.one("SELECT COUNT(*) as c FROM decisions"));
  console.log("Sample legacy decisions:", await db.many("SELECT * FROM decisions LIMIT 5"));
}

inspectDecisions().catch(console.error);
