import { getDatabaseAdapter } from "../src/data/database/index";

async function checkVetoDetails() {
  const db = getDatabaseAdapter();
  const rows = await db.many<any>(`
    SELECT 
      spc.canonical_job_id,
      me.decision as engine_decision,
      me.evaluation_json
    FROM search_plan_candidates spc
    JOIN materialized_evaluations me ON me.canonical_job_id = spc.canonical_job_id
      AND me.tenant_id = spc.tenant_id
      AND me.person_id = spc.person_id
    WHERE spc.tenant_id = 'tenant_default'
      AND spc.person_id = 'ms6i7e3y-4x0chy5fy'
      AND me.evaluation_json IS NOT NULL
  `);

  console.log(`Analyzing ${rows.length} materialized evaluations...`);
  const vetoedByDecision: Record<string, number> = {};
  let totalVetoed = 0;

  for (const r of rows) {
    try {
      const p = JSON.parse(r.evaluation_json);
      const rec = p.record || p.engineRecommendation || p;
      const isVetoed = Boolean(p.vetoed ?? rec.vetoed);
      if (isVetoed) {
        totalVetoed++;
        const d = String(r.engine_decision);
        vetoedByDecision[d] = (vetoedByDecision[d] || 0) + 1;
      }
    } catch {}
  }

  console.log({ totalVetoed, vetoedByDecision });
}

checkVetoDetails().catch(console.error);
