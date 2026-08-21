import { getDatabaseAdapter } from "../src/data/database/index";

async function run() {
  const db = getDatabaseAdapter();
  console.log("─────────────────────────────");
  console.log("RADAR Database Diagnostic - Weekday AI");
  console.log("─────────────────────────────");

  const hash = "j-f1b1ee48cdde";

  const evalRow: any = await db.one(
    "SELECT * FROM candidate_evaluations WHERE job_hash = ?",
    [hash]
  );
  if (evalRow) {
    console.log("Evaluation Row found:");
    console.log("  engine_verdict:", evalRow.engine_verdict);
    console.log("  quality_score:", evalRow.quality_score);
    console.log("  user_decision_override:", evalRow.user_decision_override);
    console.log("  effective_decision:", evalRow.effective_decision);
    
    try {
      const parsed = JSON.parse(evalRow.evaluation_json);
      console.log("  JSON structure:");
      console.log("    schemaVersion:", parsed.schemaVersion);
      console.log("    intrinsicVerdict:", parsed.intrinsicVerdict);
      console.log("    intrinsicQualityScore:", parsed.intrinsicQualityScore);
      console.log("    auditTrace:", JSON.stringify(parsed.auditTrace, null, 2));
      console.log("    vetoed:", parsed.vetoed);
      console.log("    vetoReason:", parsed.vetoReason);
    } catch (err: any) {
      console.log("  Error parsing JSON:", err.message);
    }
  } else {
    console.log("No Evaluation Row found in candidate_evaluations.");
  }

  const decRow: any = await db.one(
    "SELECT * FROM decisions WHERE opportunity_id = ?",
    [hash]
  );
  if (decRow) {
    console.log("Decisions Row found:");
    console.log("  id:", decRow.id);
    console.log("  person_id:", decRow.person_id);
    console.log("  opportunity_id:", decRow.opportunity_id);
    console.log("  action:", decRow.action);
    console.log("  reason:", decRow.reason);
    console.log("  reviewed_fingerprint:", decRow.reviewed_fingerprint);
  } else {
    console.log("No Decisions Row found in decisions table.");
  }
}

run().catch(console.error);
