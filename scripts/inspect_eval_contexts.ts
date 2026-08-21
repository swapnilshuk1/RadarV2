import { getDatabaseAdapter } from "../src/data/database/index.js";

async function inspectEvaluationContexts() {
  const db = getDatabaseAdapter();

  const ctxs = await db.many<any>("SELECT * FROM evaluation_contexts LIMIT 5");
  console.log("Evaluation contexts:", ctxs);

  const sps = await db.many<any>("SELECT * FROM search_plan_snapshots LIMIT 5");
  console.log("\nSearch plan snapshots:", sps.map(s => ({
    id: s.id,
    tenant_id: s.tenant_id,
    person_id: s.person_id,
    payload_preview: s.payload_json?.slice(0, 100),
    created_at: s.created_at
  })));

  if (sps.length > 0) {
    console.log("\nFull payload_json of first snapshot:", JSON.parse(sps[0].payload_json));
  }
}

inspectEvaluationContexts().catch(console.error);
