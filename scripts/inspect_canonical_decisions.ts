import { getDatabaseAdapter } from "../src/data/database/index.js";

async function inspectCanonicalDecisions() {
  const db = getDatabaseAdapter();

  const allCanonDecs = await db.many<any>("SELECT person_id, tenant_id, COUNT(*) as c FROM canonical_decisions GROUP BY person_id, tenant_id");
  console.log("Canonical decisions by person/tenant:", allCanonDecs);
}

inspectCanonicalDecisions().catch(console.error);
