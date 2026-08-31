import { getDatabaseAdapter } from "../../src/data/database/index";
import { isCanonicalIntrinsicEvaluation } from "../../src/lib/intelligence/serving/EvaluationServingEngine";
import fs from "fs";

function adaptEngineVerdict(verb: unknown): string {
  if (verb === "PURSUE") return "PURSUE";
  if (verb === "CONSIDER") return "CONSIDER";
  if (verb === "PASS") return "PASS";
  if (verb === "NOT_EVALUABLE" || verb === "SPARSE_SPEC") return "SPARSE_SPEC";
  return "SPARSE_SPEC";
}

const POPULATION_TIER_ORDER: Record<string, number> = {
  ENGINE_PURSUIT: 0,
  USER_CONFIRMED: 0,
  PREFERENCE_OVERRIDE: 1,
  VETO_OVERRIDE: 2,
  ENGINE_CONSIDER: 3,
  NOT_EVALUABLE: 4,
  USER_PASSED: 5,
  ENGINE_PASS: 5,
  NONE: 5,
};

function extractCanonicalEvalFields(evaluationJson: string | null, fallbackState: string, fallbackDecision: string | null, fallbackScore: number | null, fallbackVetoed: number) {
  if (!evaluationJson) {
    return {
      decision: fallbackDecision,
      score: fallbackScore,
      evalState: fallbackState || "UNMATERIALIZED",
      vetoed: fallbackVetoed === 1,
      location: null as string | null,
    };
  }

  const rawParsed = JSON.parse(evaluationJson);
  if (isCanonicalIntrinsicEvaluation(rawParsed)) {
    return {
      decision: rawParsed.intrinsicVerdict,
      score: rawParsed.intrinsicQualityScore,
      evalState: rawParsed.evaluationStatus,
      vetoed: Boolean(rawParsed.vetoed),
      location: (rawParsed as any).location || (rawParsed as any).opportunity?.location || null,
    };
  }

  const recObj = rawParsed.record || rawParsed.engineRecommendation || rawParsed;
  const rawVerb = recObj.engineVerdict || recObj.verb || rawParsed.decision || rawParsed.verb || rawParsed.verdict;
  const recordedVerdict = adaptEngineVerdict(rawVerb);
  const qualityScore = recObj.qualityScore ?? rawParsed.engineRecommendation?.qualityScore ?? rawParsed.recommendationResult?.score ?? null;
  const vetoed = Boolean(recObj.vetoed ?? rawParsed.engineRecommendation?.vetoed);
  const evalState = (rawParsed.evaluationStatus === "SPARSE_SPEC" || recordedVerdict === "SPARSE_SPEC" || fallbackState === "SPARSE_SPEC")
    ? "SPARSE_SPEC"
    : "COMPLETE";
  const location = rawParsed.opportunity?.location || rawParsed.record?.location || rawParsed.location || null;

  return {
    decision: recordedVerdict,
    score: qualityScore,
    evalState,
    vetoed,
    location,
  };
}

async function testSimulatedParity() {
  const db = getDatabaseAdapter();

  const goldenData = JSON.parse(fs.readFileSync("tests/fixtures/serving_golden_dataset.json", "utf-8"));
  const goldenMap = new Map(goldenData.records.map((r: any) => [r.jobHash, r]));

  const rows = await db.many<any>(
    `SELECT 
       co.source_job_id,
       co.company_name,
       co.source,
       co.canonical_url as apply_url,
       ov.job_title,
       ov.location as ov_location,
       ov.posted_at,
       ov.posted_precision,
       me.evaluation_state,
       me.decision,
       me.quality_score,
       me.vetoed,
       me.evaluation_json,
       d.action as user_action,
       d.updated_at as user_decision_updated_at,
       me.materialized_at,
       spc.attention_decision
     FROM search_plan_candidates spc
     JOIN canonical_opportunities co ON spc.canonical_job_id = co.id
     JOIN opportunity_versions ov ON co.id = ov.canonical_job_id AND spc.opportunity_version = ov.id
     LEFT JOIN materialized_evaluations me ON me.canonical_job_id = spc.canonical_job_id AND me.opportunity_version = spc.opportunity_version AND me.tenant_id = spc.tenant_id AND me.person_id = spc.person_id AND me.evaluation_context_fingerprint = ?
     LEFT JOIN canonical_decisions d ON d.canonical_job_id = spc.canonical_job_id AND d.tenant_id = spc.tenant_id AND d.person_id = spc.person_id
     WHERE spc.tenant_id = ? AND spc.person_id = ? AND spc.search_plan_id = ? AND spc.attention_decision = 'CANDIDATE'`,
    [goldenData.contextFingerprint, goldenData.tenantId, goldenData.userId, goldenData.searchPlanId]
  );

  console.log(`Checking ${rows.length} rows against Golden Oracle...`);

  let decisionMismatches = 0;
  let tierMismatches = 0;
  let scoreMismatches = 0;
  let verdictMismatches = 0;

  for (const r of rows) {
    const golden = goldenMap.get(r.source_job_id);
    if (!golden) continue;

    const { decision, score, evalState, vetoed, location } = extractCanonicalEvalFields(
      r.evaluation_json,
      r.evaluation_state,
      r.decision,
      r.quality_score,
      r.vetoed
    );

    // SQL Effective Decision Simulation
    let effectiveDecision: string;
    if (r.user_action === "PASS") {
      effectiveDecision = "USER_PASSED";
    } else if (r.user_action === "PURSUE") {
      if (decision === "PASS" || vetoed) {
        effectiveDecision = "VETO_OVERRIDE";
      } else if (decision === "PURSUE") {
        effectiveDecision = "USER_CONFIRMED";
      } else if (decision === "CONSIDER") {
        effectiveDecision = "PREFERENCE_OVERRIDE";
      } else {
        effectiveDecision = "USER_CONFIRMED";
      }
    } else if (r.user_action === "CONSIDER") {
      if (decision === "CONSIDER") {
        effectiveDecision = "ENGINE_CONSIDER";
      } else {
        effectiveDecision = "PREFERENCE_OVERRIDE";
      }
    } else if (r.attention_decision === "NOT_CANDIDATE") {
      effectiveDecision = "NOT_EVALUABLE";
    } else if (!decision || evalState === "SPARSE_SPEC" || decision === "SPARSE_SPEC") {
      effectiveDecision = "NOT_EVALUABLE";
    } else if (decision === "PURSUE") {
      effectiveDecision = "ENGINE_PURSUIT";
    } else if (decision === "CONSIDER") {
      effectiveDecision = "ENGINE_CONSIDER";
    } else {
      effectiveDecision = "ENGINE_PASS";
    }

    const tier = POPULATION_TIER_ORDER[effectiveDecision] ?? 5;

    // Compare with Golden
    if (effectiveDecision !== golden.effectiveDecision) {
      decisionMismatches++;
      if (decisionMismatches <= 3) {
        console.log(`Decision diff for ${r.source_job_id}: norm='${effectiveDecision}' vs golden='${golden.effectiveDecision}' (uAction=${r.user_action}, dec=${decision}, vetoed=${vetoed})`);
      }
    }

    if (tier !== golden.populationTier) {
      tierMismatches++;
    }

    if (score !== golden.qualityScore) scoreMismatches++;
    const expectedVerdict = golden.engineVerdict || (evalState === "SPARSE_SPEC" ? "SPARSE_SPEC" : null);
    if (decision !== expectedVerdict && (decision !== null || expectedVerdict !== null)) {
      verdictMismatches++;
    }
  }

  console.log("\n--- SIMULATION RESULTS ---");
  console.log(`Total Records:          ${rows.length}`);
  console.log(`Decision Mismatches:    ${decisionMismatches}`);
  console.log(`Tier Mismatches:        ${tierMismatches}`);
  console.log(`Score Mismatches:       ${scoreMismatches}`);
  console.log(`Verdict Mismatches:     ${verdictMismatches}`);
}

testSimulatedParity().catch(console.error);
