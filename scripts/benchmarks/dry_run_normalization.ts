import { getDatabaseAdapter } from "../../src/data/database/index";
import fs from "fs";

function adaptEngineVerdict(verb: unknown): string {
  if (verb === "PURSUE") return "PURSUE";
  if (verb === "CONSIDER") return "CONSIDER";
  if (verb === "PASS") return "PASS";
  if (verb === "NOT_EVALUABLE" || verb === "SPARSE_SPEC") return "SPARSE_SPEC";
  return "SPARSE_SPEC";
}

async function dryRunNormalization() {
  const db = getDatabaseAdapter();

  const goldenData = JSON.parse(fs.readFileSync("tests/fixtures/serving_golden_dataset.json", "utf-8"));
  const goldenMap = new Map(goldenData.records.map((r: any) => [r.jobHash, r]));

  const rows = await db.many<any>(
    `SELECT 
       me.id as me_id,
       co.source_job_id,
       ov.id as ov_id,
       ov.location as ov_location,
       ov.posted_at as ov_posted_at,
       me.evaluation_state,
       me.decision,
       me.quality_score,
       me.vetoed,
       me.evaluation_json,
       d.action as user_action
     FROM search_plan_candidates spc
     JOIN canonical_opportunities co ON spc.canonical_job_id = co.id
     JOIN opportunity_versions ov ON co.id = ov.canonical_job_id AND spc.opportunity_version = ov.id
     LEFT JOIN materialized_evaluations me ON me.canonical_job_id = spc.canonical_job_id AND me.opportunity_version = spc.opportunity_version AND me.tenant_id = spc.tenant_id AND me.person_id = spc.person_id AND me.evaluation_context_fingerprint = ?
     LEFT JOIN canonical_decisions d ON d.canonical_job_id = spc.canonical_job_id AND d.tenant_id = spc.tenant_id AND d.person_id = spc.person_id
     WHERE spc.tenant_id = ? AND spc.person_id = ? AND spc.search_plan_id = ? AND spc.attention_decision = 'CANDIDATE'`,
    [goldenData.contextFingerprint, goldenData.tenantId, goldenData.userId, goldenData.searchPlanId]
  );

  console.log(`Auditing ${rows.length} rows...`);

  let evalJsonParsed = 0;
  let decisionUpdates = 0;
  let scoreUpdates = 0;
  let stateUpdates = 0;
  let locUpdates = 0;
  let postUpdates = 0;

  for (const r of rows) {
    if (!r.evaluation_json) continue;
    evalJsonParsed++;
    const j = JSON.parse(r.evaluation_json);
    const recObj = j.record || j.engineRecommendation || j;
    const rawVerb = recObj.engineVerdict || recObj.verb || j.decision || j.verb || j.verdict;
    const normalizedVerdict = adaptEngineVerdict(rawVerb);
    const normalizedScore = recObj.qualityScore ?? j.recommendationResult?.score ?? null;
    const normalizedState = (normalizedVerdict === "SPARSE_SPEC" || j.evaluationStatus === "SPARSE_SPEC" || r.evaluation_state === "SPARSE_SPEC")
      ? "SPARSE_SPEC"
      : "COMPLETE";

    const jLoc = j.opportunity?.location || j.record?.location || j.location;
    const jPost = j.opportunity?.postedAt || j.record?.postedAt || j.postedAt;

    if (r.decision !== normalizedVerdict) decisionUpdates++;
    if (r.quality_score !== normalizedScore) scoreUpdates++;
    if (r.evaluation_state !== normalizedState) stateUpdates++;
    if (!r.ov_location && jLoc) locUpdates++;
    if (!r.ov_posted_at && jPost) postUpdates++;
  }

  console.log({
    totalRows: rows.length,
    evalJsonParsed,
    decisionUpdates,
    scoreUpdates,
    stateUpdates,
    locUpdates,
    postUpdates,
  });
}

dryRunNormalization().catch(console.error);
