import { getDatabaseAdapter } from "../src/data/database/index";

async function checkRationale() {
  const db = getDatabaseAdapter();
  const rows = await db.many<any>(`
    SELECT decision, rationale, quality_score, evaluation_state
    FROM materialized_evaluations
    WHERE tenant_id = 'tenant_default'
      AND person_id = 'ms6i7e3y-4x0chy5fy'
      AND decision = 'CONSIDER'
    LIMIT 10
  `);
  console.log(rows);
}

checkRationale().catch(console.error);
