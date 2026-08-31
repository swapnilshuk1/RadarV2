import { getDatabaseAdapter } from "../src/data/database/index";

async function testJsonExtract() {
  const db = getDatabaseAdapter();
  const res = await db.many<any>(`
    SELECT 
      COUNT(*) as total_count,
      SUM(CASE WHEN json_extract(evaluation_json, '$.record.vetoed') = 1 THEN 1 ELSE 0 END) as rec_vetoed_1,
      SUM(CASE WHEN json_extract(evaluation_json, '$.record.vetoed') = true THEN 1 ELSE 0 END) as rec_vetoed_true,
      SUM(CASE WHEN json_extract(evaluation_json, '$.vetoed') = 1 THEN 1 ELSE 0 END) as top_vetoed_1,
      SUM(CASE WHEN json_extract(evaluation_json, '$.vetoed') = true THEN 1 ELSE 0 END) as top_vetoed_true
    FROM materialized_evaluations
    WHERE evaluation_json IS NOT NULL
  `);
  console.log(res);
}

testJsonExtract().catch(console.error);
