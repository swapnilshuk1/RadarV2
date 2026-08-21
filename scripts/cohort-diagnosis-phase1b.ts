import { getDatabaseAdapter } from "../src/data/database";

async function inspectIngestionAndEvaluations() {
  const db = getDatabaseAdapter();
  const userId = "ms6i7e3y-4x0chy5fy";

  console.log("==================================================");
  console.log("INSPECTING RECENT INGESTION & DOCUMENTS");
  console.log("==================================================");

  // Check documents table
  const docs = await db.many<any>(
    "SELECT id, opportunity_id, payload_type, created_at FROM documents ORDER BY created_at DESC LIMIT 200"
  );
  console.log(`Total recent documents sampled: ${docs.length}`);

  const docDates: Record<string, number> = {};
  for (const d of docs) {
    const dt = d.created_at ? d.created_at.slice(0, 10) : "UNKNOWN";
    docDates[dt] = (docDates[dt] || 0) + 1;
  }
  console.log("Recent documents created_at dates:", docDates);

  // Check acquisition_logs or search discovery logs if any
  try {
    const logs = await db.many<any>("SELECT * FROM acquisition_logs ORDER BY created_at DESC LIMIT 50");
    console.log(`Acquisition logs count: ${logs.length}`);
  } catch (e: any) {
    console.log("acquisition_logs query:", e.message);
  }

  // Check candidate_evaluations details
  const evals = await db.many<any>(
    "SELECT job_hash, evaluation_json, updated_at FROM candidate_evaluations WHERE person_id = ? ORDER BY updated_at DESC",
    [userId]
  );

  let enrichedCount = 0;
  let parsedCount = 0;
  const recent205JobHashes = new Set(
    (await db.many<any>("SELECT id FROM opportunities WHERE created_at LIKE '2026-08-16%' OR created_at LIKE '2026-08-17%'")).map(o => o.id)
  );

  console.log(`Recent 2026-08-16/17 opportunities count: ${recent205JobHashes.size}`);

  let cohortPursue = 0;
  let cohortConsider = 0;
  let cohortPass = 0;
  let cohortSparse = 0;
  let cohortEnriched = 0;

  for (const ev of evals) {
    if (recent205JobHashes.has(ev.job_hash)) {
      try {
        const json = JSON.parse(ev.evaluation_json);
        if (json.evidence && Array.isArray(json.evidence) && json.evidence.length > 0) {
          cohortEnriched++;
        } else if (json.decisionDrivers && Array.isArray(json.decisionDrivers) && json.decisionDrivers.length > 0) {
          cohortEnriched++;
        }
        const verdict = json.engineVerdict || json.verdict;
        if (verdict === "PURSUE") cohortPursue++;
        else if (verdict === "CONSIDER") cohortConsider++;
        else if (verdict === "PASS") cohortPass++;
        else if (verdict === "SPARSE_SPEC") cohortSparse++;
      } catch {}
    }
  }

  console.log(`\nCohort metrics for the 207 recently created opportunities (2026-08-16/17):`);
  console.log(`  Enriched: ${cohortEnriched}`);
  console.log(`  Engine PURSUE: ${cohortPursue}`);
  console.log(`  Engine CONSIDER: ${cohortConsider}`);
  console.log(`  Engine PASS: ${cohortPass}`);
  console.log(`  Engine SPARSE_SPEC: ${cohortSparse}`);
}

inspectIngestionAndEvaluations().catch(console.error);
