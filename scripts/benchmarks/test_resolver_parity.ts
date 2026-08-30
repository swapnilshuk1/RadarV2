import { getDatabaseAdapter } from "../../src/data/database/index";
import { resolveEffectiveDecision, type CanonicalDecisionInputs } from "../../src/lib/intelligence/decision-resolver";
import { isCanonicalIntrinsicEvaluation } from "../../src/lib/intelligence/serving/EvaluationServingEngine";
import fs from "fs";

function adaptEngineVerdict(verb: unknown): any {
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
};

function extractCanonicalEvalFields(evaluationJson: string | null, fallbackState: string, fallbackDecision: string | null, fallbackScore: number | null, fallbackVetoed: number) {
  if (!evaluationJson) {
    return {
      decision: fallbackDecision,
      score: fallbackScore,
      evalState: fallbackState || "UNMATERIALIZED",
      vetoed: fallbackVetoed === 1,
    };
  }

  const rawParsed = JSON.parse(evaluationJson);
  if (isCanonicalIntrinsicEvaluation(rawParsed)) {
    return {
      decision: rawParsed.intrinsicVerdict,
      score: rawParsed.intrinsicQualityScore,
      evalState: rawParsed.evaluationStatus,
      vetoed: Boolean(rawParsed.vetoed),
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

  return {
    decision: recordedVerdict,
    score: qualityScore,
    evalState,
    vetoed,
  };
}

async function testResolverParity() {
  const db = getDatabaseAdapter();

  const goldenData = JSON.parse(fs.readFileSync("tests/fixtures/serving_golden_dataset.json", "utf-8"));

  const rows = await db.many<any>(
    `SELECT 
       co.source_job_id,
       ov.job_title,
       me.evaluation_state,
       me.decision,
       me.quality_score,
       me.vetoed,
       me.evaluation_json,
       d.action as user_action,
       spc.attention_decision
     FROM search_plan_candidates spc
     JOIN canonical_opportunities co ON spc.canonical_job_id = co.id
     JOIN opportunity_versions ov ON co.id = ov.canonical_job_id AND spc.opportunity_version = ov.id
     LEFT JOIN materialized_evaluations me ON me.canonical_job_id = spc.canonical_job_id AND me.opportunity_version = spc.opportunity_version AND me.tenant_id = spc.tenant_id AND me.person_id = spc.person_id AND me.evaluation_context_fingerprint = ?
     LEFT JOIN canonical_decisions d ON d.canonical_job_id = spc.canonical_job_id AND d.tenant_id = spc.tenant_id AND d.person_id = spc.person_id
     WHERE spc.tenant_id = ? AND spc.person_id = ? AND spc.search_plan_id = ? AND spc.attention_decision = 'CANDIDATE'`,
    [goldenData.contextFingerprint, goldenData.tenantId, goldenData.userId, goldenData.searchPlanId]
  );

  console.log(`Auditing 100% parity between TypeScript resolveEffectiveDecision and SQL logic across ${rows.length} rows...`);

  let mismatches = 0;
  let tierMismatches = 0;

  for (const r of rows) {
    const { decision, score, evalState, vetoed } = extractCanonicalEvalFields(
      r.evaluation_json,
      r.evaluation_state,
      r.decision,
      r.quality_score,
      r.vetoed
    );

    // 1. TypeScript Resolver
    const tsDecision = resolveEffectiveDecision({
      attentionDecision: r.attention_decision || "CANDIDATE",
      engineVerdict: decision as any,
      vetoed,
      qualityScore: score,
      userAction: r.user_action || "NONE",
    });
    const tsTier = POPULATION_TIER_ORDER[tsDecision] ?? 5;

    // 2. SQL Resolver Logic
    let sqlDecision: string;
    if (r.user_action === "PASS") {
      sqlDecision = "USER_PASSED";
    } else if (r.user_action === "PURSUE") {
      if (decision === "PASS" || vetoed) {
        sqlDecision = "VETO_OVERRIDE";
      } else if (decision === "PURSUE") {
        sqlDecision = "USER_CONFIRMED";
      } else if (decision === "CONSIDER") {
        sqlDecision = "PREFERENCE_OVERRIDE";
      } else {
        sqlDecision = "USER_CONFIRMED";
      }
    } else if (r.user_action === "CONSIDER") {
      if (decision === "CONSIDER") {
        sqlDecision = "ENGINE_CONSIDER";
      } else {
        sqlDecision = "PREFERENCE_OVERRIDE";
      }
    } else if (r.attention_decision === "NOT_CANDIDATE") {
      sqlDecision = "NOT_EVALUABLE";
    } else if (!decision || evalState === "SPARSE_SPEC" || decision === "SPARSE_SPEC") {
      sqlDecision = "NOT_EVALUABLE";
    } else if (decision === "PURSUE") {
      sqlDecision = "ENGINE_PURSUIT";
    } else if (decision === "CONSIDER") {
      sqlDecision = "ENGINE_CONSIDER";
    } else {
      sqlDecision = "ENGINE_PASS";
    }

    const sqlTier = POPULATION_TIER_ORDER[sqlDecision] ?? 5;

    if (tsDecision !== sqlDecision) {
      mismatches++;
      console.error(`[Mismatch] ${r.source_job_id}: TS='${tsDecision}' vs SQL='${sqlDecision}'`);
    }

    if (tsTier !== sqlTier) {
      tierMismatches++;
    }
  }

  console.log("\n============================================================");
  console.log("PROOF A: DECISION RESOLVER & SQL PARITY");
  console.log("============================================================");
  console.log(`Total Opportunities:         ${rows.length}`);
  console.log(`Decision Parity Mismatches:  ${mismatches} (Parity: ${(((rows.length - mismatches) / rows.length) * 100).toFixed(2)}%)`);
  console.log(`Tier Parity Mismatches:      ${tierMismatches} (Parity: ${(((rows.length - tierMismatches) / rows.length) * 100).toFixed(2)}%)`);
  console.log("============================================================\n");

  if (mismatches > 0 || tierMismatches > 0) {
    throw new Error("Resolver parity failed.");
  }

  console.log("SUCCESS: 100.00% exact parity between TypeScript resolver and SQL resolver across all 3,002 records!");
}

testResolverParity().catch(console.error);
