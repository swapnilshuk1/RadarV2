import { getDatabaseAdapter } from "../src/data/database/index";

async function run() {
  const db = getDatabaseAdapter();

  const tables = [
    "materialized_evaluations",
    "search_plan_candidates",
    "canonical_decisions",
    "canonical_opportunities",
    "opportunity_versions",
    "people",
    "memberships",
    "tenants",
    "active_evaluation_contexts",
    "evaluation_contexts",
    "search_plans",
    "search_plan_snapshots"
  ];

  console.log("=== TABLE SCHEMAS (PRAGMA table_info) ===");
  for (const t of tables) {
    try {
      const cols = await db.many<any>(`PRAGMA table_info(${t})`);
      console.log(`\nTable: ${t} (${cols.length} columns)`);
      for (const col of cols) {
        console.log(`  - ${col.name} (${col.type})${col.pk ? " [PK]" : ""}${col.notnull ? " [NOT NULL]" : ""}`);
      }
    } catch (err: any) {
      console.log(`Table ${t} error: ${err.message}`);
    }
  }

  console.log("\n=== INDEXES ===");
  for (const t of tables) {
    try {
      const idxs = await db.many<any>(`PRAGMA index_list(${t})`);
      if (idxs.length > 0) {
        console.log(`Table: ${t}`);
        for (const idx of idxs) {
          const idxCols = await db.many<any>(`PRAGMA index_info(${idx.name})`);
          console.log(`  - Index ${idx.name} (unique: ${idx.unique}) on [${idxCols.map((c: any) => c.name).join(", ")}]`);
        }
      }
    } catch (err: any) {}
  }

  console.log("\n=== INVESTIGATING CRITICAL RULE 1: VETO SEMANTICS ===");
  const meCols = await db.many<any>(`PRAGMA table_info(materialized_evaluations)`);
  console.log("materialized_evaluations columns:", meCols.map((c: any) => c.name));

  const vetoCheck = await db.many<any>(`
    SELECT 
      decision,
      COUNT(*) as count
    FROM materialized_evaluations
    GROUP BY decision
  `);
  console.log("\nmaterialized_evaluations decision distribution:", vetoCheck);

  try {
    const jsonVeto = await db.many<any>(`
      SELECT 
        COUNT(*) as total_rows,
        SUM(CASE WHEN json_extract(evaluation_json, '$.engineRecommendation.vetoed') = 1 THEN 1 ELSE 0 END) as vetoed_true_1,
        SUM(CASE WHEN json_extract(evaluation_json, '$.engineRecommendation.vetoed') = true THEN 1 ELSE 0 END) as vetoed_true_bool,
        SUM(CASE WHEN json_extract(evaluation_json, '$.engineRecommendation.vetoed') IS NOT NULL THEN 1 ELSE 0 END) as vetoed_present,
        SUM(CASE WHEN json_extract(evaluation_json, '$.vetoed') = 1 THEN 1 ELSE 0 END) as direct_vetoed_1
      FROM materialized_evaluations
    `);
    console.log("evaluation_json veto counts:", jsonVeto);
  } catch (err: any) {
    console.log("Error querying evaluation_json:", err.message);
  }

  const sample = await db.one<any>(`SELECT evaluation_json FROM materialized_evaluations WHERE evaluation_json IS NOT NULL LIMIT 1`);
  if (sample?.evaluation_json) {
    const parsed = JSON.parse(sample.evaluation_json);
    console.log("\nSample evaluation_json top-level keys:", Object.keys(parsed));
    if (parsed.engineRecommendation) {
      console.log("Sample engineRecommendation keys:", Object.keys(parsed.engineRecommendation));
      console.log("Sample engineRecommendation.vetoed:", parsed.engineRecommendation.vetoed);
      console.log("Sample engineRecommendation.engineVerdict:", parsed.engineRecommendation.engineVerdict);
    }
  }

  console.log("\n=== CANONICAL TENANT & PERSON STATE ===");
  const people = await db.many<any>(`SELECT * FROM people`);
  console.log("People:", people);
  const tenants = await db.many<any>(`SELECT * FROM tenants`);
  console.log("Tenants:", tenants);
  const memberships = await db.many<any>(`SELECT * FROM memberships`);
  console.log("Memberships:", memberships);
  const activePtrs = await db.many<any>(`SELECT * FROM active_evaluation_contexts`);
  console.log("Active Context Pointers:", activePtrs);
  const plans = await db.many<any>(`SELECT id, tenant_id, person_id, status FROM search_plans`);
  console.log("Search plans:", plans);
}

run().catch(console.error);
