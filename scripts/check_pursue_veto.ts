import { getDatabaseAdapter } from "../src/data/database/index";

async function checkPursueDecisions() {
  const db = getDatabaseAdapter();
  const rows = await db.many<any>(`
    SELECT 
      cd.canonical_job_id,
      cd.action as user_action,
      me.decision as engine_decision,
      me.evaluation_json
    FROM canonical_decisions cd
    LEFT JOIN materialized_evaluations me ON me.canonical_job_id = cd.canonical_job_id
      AND me.tenant_id = cd.tenant_id
      AND me.person_id = cd.person_id
    WHERE cd.tenant_id = 'tenant_default'
      AND cd.person_id = 'ms6i7e3y-4x0chy5fy'
  `);

  console.log(`Total canonical decisions for user: ${rows.length}`);
  const byAction: Record<string, number> = {};
  for (const r of rows) {
    byAction[r.user_action] = (byAction[r.user_action] || 0) + 1;
  }
  console.log("Decisions by action:", byAction);

  const pursueRows = rows.filter(r => r.user_action === "PURSUE");
  console.log(`PURSUE rows: ${pursueRows.length}`);
  for (const r of pursueRows) {
    let vetoed = false;
    if (r.evaluation_json) {
      try {
        const p = JSON.parse(r.evaluation_json);
        const rec = p.record || p.engineRecommendation || p;
        vetoed = Boolean(p.vetoed ?? rec.vetoed);
      } catch {}
    }
    console.log(`Job: ${r.canonical_job_id}, Engine Decision: ${r.engine_decision}, Vetoed: ${vetoed}`);
  }
}

checkPursueDecisions().catch(console.error);
