import { getDatabaseAdapter } from "../src/data/database";

async function inspectScrapeCohort() {
  const db = getDatabaseAdapter();

  console.log("==================================================");
  console.log("PHASE 1 AUDIT: LOCATING SCRAPE COHORTS");
  console.log("==================================================");

  // 1. Inspect opportunity_discoveries table
  try {
    const discoveries = await db.many<any>("SELECT * FROM opportunity_discoveries ORDER BY discovered_at DESC LIMIT 200");
    console.log(`opportunity_discoveries total count: ${discoveries.length}`);
    if (discoveries.length > 0) {
      console.log("Sample discovery timestamps:", discoveries.slice(0, 10).map((d) => d.discovered_at));
    }
  } catch (e: any) {
    console.log("opportunity_discoveries table error:", e.message);
  }

  // 2. Inspect sources table
  try {
    const sources = await db.many<any>("SELECT * FROM sources ORDER BY created_at DESC LIMIT 50");
    console.log(`sources total count: ${sources.length}`);
    if (sources.length > 0) {
      console.log("Sample sources:", sources.slice(0, 5));
    }
  } catch (e: any) {
    console.log("sources table error:", e.message);
  }

  // 3. Inspect documents table created_at breakdown
  const docs = await db.many<any>("SELECT id, opportunity_id, payload_type, created_at FROM documents ORDER BY created_at DESC");
  console.log(`documents total count: ${docs.length}`);
  const docDates: Record<string, number> = {};
  for (const d of docs) {
    const dt = d.created_at ? d.created_at.slice(0, 10) : "UNKNOWN";
    docDates[dt] = (docDates[dt] || 0) + 1;
  }
  console.log("Documents created_at dates:", docDates);

  // 4. Inspect opportunities table created_at breakdown
  const opps = await db.many<any>("SELECT id, canonical_title, company_id, created_at FROM opportunities ORDER BY created_at DESC");
  console.log(`opportunities total count: ${opps.length}`);
  const oppDates: Record<string, number> = {};
  for (const o of opps) {
    const dt = o.created_at ? o.created_at.slice(0, 10) : "UNKNOWN";
    oppDates[dt] = (oppDates[dt] || 0) + 1;
  }
  console.log("Opportunities created_at dates:", oppDates);

  // 5. Inspect candidate_evaluations table
  const evals = await db.many<any>("SELECT person_id, job_hash, engine_verdict, quality_score, updated_at, evaluation_json FROM candidate_evaluations");
  console.log(`candidate_evaluations total count: ${evals.length}`);

  // Let's check evaluation_json.evaluatedAt vs updated_at
  const evalAtDates: Record<string, number> = {};
  for (const ev of evals) {
    try {
      const parsed = JSON.parse(ev.evaluation_json);
      const dt = parsed.evaluatedAt ? parsed.evaluatedAt.slice(0, 10) : "UNKNOWN";
      evalAtDates[dt] = (evalAtDates[dt] || 0) + 1;
    } catch {}
  }
  console.log("candidate_evaluations evaluatedAt dates:", evalAtDates);
}

inspectScrapeCohort().catch(console.error);
