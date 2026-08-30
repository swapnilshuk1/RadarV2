import { getDatabaseAdapter } from "../src/data/database/index";

async function checkVetoes() {
  const db = getDatabaseAdapter();
  const rows = await db.many<any>(`
    SELECT 
      spc.canonical_job_id,
      co.source_job_id,
      me.decision,
      me.quality_score,
      me.evaluation_json
    FROM search_plan_candidates spc
    JOIN canonical_opportunities co ON co.id = spc.canonical_job_id
    LEFT JOIN materialized_evaluations me ON me.canonical_job_id = spc.canonical_job_id 
      AND me.tenant_id = spc.tenant_id 
      AND me.person_id = spc.person_id
    WHERE spc.tenant_id = 'tenant_default'
      AND spc.person_id = 'ms6i7e3y-4x0chy5fy'
      AND spc.attention_decision = 'CANDIDATE'
  `);

  console.log(`Total candidate rows for canonical user: ${rows.length}`);
  let withEvalJson = 0;
  let vetoCount = 0;
  let canonicalIntrinsicCount = 0;
  let legacyCount = 0;

  for (const r of rows) {
    if (!r.evaluation_json) continue;
    withEvalJson++;
    try {
      const parsed = JSON.parse(r.evaluation_json);
      if (parsed.schemaVersion === "v4.2-intrinsic") {
        canonicalIntrinsicCount++;
        if (parsed.vetoed === true) vetoCount++;
      } else {
        legacyCount++;
        const recObj = parsed.record || parsed.engineRecommendation || parsed;
        const isVetoed = Boolean(recObj.vetoed ?? parsed.engineRecommendation?.vetoed);
        if (isVetoed) vetoCount++;
      }
    } catch {}
  }

  console.log({
    totalRows: rows.length,
    withEvalJson,
    canonicalIntrinsicCount,
    legacyCount,
    vetoCount
  });

  // Check sample row structure
  const sample = rows.find(r => r.evaluation_json);
  if (sample) {
    const p = JSON.parse(sample.evaluation_json);
    console.log("Sample schemaVersion:", p.schemaVersion);
    console.log("Sample parsed keys:", Object.keys(p));
    if (p.record) console.log("Sample p.record keys:", Object.keys(p.record));
  }
}

checkVetoes().catch(console.error);
