/**
 * scripts/migrations/run_and_verify_030_scalar_sync.ts
 *
 * RADAR v2 — Phase 5 Fast Batched Scalar Column Synchronization & Backfill.
 *
 * Synchronizes existing scalar columns (`decision`, `quality_score`, `evaluation_state`, `vetoed`)
 * in `materialized_evaluations` and `location` in `opportunity_versions` to the canonical
 * evaluated values stored in `evaluation_json`.
 */

import { getDatabaseAdapter } from "../../src/data/database/index";
import { isCanonicalIntrinsicEvaluation } from "../../src/lib/intelligence/serving/EvaluationServingEngine";

function adaptEngineVerdict(verb: unknown): string {
  if (verb === "PURSUE") return "PURSUE";
  if (verb === "CONSIDER") return "CONSIDER";
  if (verb === "PASS") return "PASS";
  if (verb === "NOT_EVALUABLE" || verb === "SPARSE_SPEC") return "SPARSE_SPEC";
  return "SPARSE_SPEC";
}

function extractCanonicalEvalFields(
  evaluationJson: string | null,
  fallbackState: string,
  fallbackDecision: string | null,
  fallbackScore: number | null,
  fallbackVetoed: number
) {
  if (!evaluationJson) {
    return {
      decision: fallbackDecision,
      score: fallbackScore,
      evalState: fallbackState || "UNMATERIALIZED",
      vetoed: fallbackVetoed === 1 ? 1 : 0,
      location: null as string | null,
    };
  }

  const rawParsed = JSON.parse(evaluationJson);
  if (isCanonicalIntrinsicEvaluation(rawParsed)) {
    return {
      decision: rawParsed.intrinsicVerdict,
      score: rawParsed.intrinsicQualityScore,
      evalState: rawParsed.evaluationStatus,
      vetoed: rawParsed.vetoed ? 1 : 0,
      location: (rawParsed as any).location || (rawParsed as any).opportunity?.location || null,
    };
  }

  const recObj = rawParsed.record || rawParsed.engineRecommendation || rawParsed;
  const rawVerb = recObj.engineVerdict || recObj.verb || rawParsed.decision || rawParsed.verb || rawParsed.verdict;
  const recordedVerdict = adaptEngineVerdict(rawVerb);
  const qualityScore = recObj.qualityScore ?? rawParsed.engineRecommendation?.qualityScore ?? rawParsed.recommendationResult?.score ?? null;
  const vetoed = Boolean(recObj.vetoed ?? rawParsed.engineRecommendation?.vetoed) ? 1 : 0;
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

async function runScalarSync() {
  const db = getDatabaseAdapter();

  console.log("Fetching all materialized evaluations for scalar synchronization...");
  const evaluations = await db.many<{
    id: string;
    canonical_job_id: string;
    opportunity_version: string;
    evaluation_state: string;
    decision: string | null;
    quality_score: number | null;
    vetoed: number;
    evaluation_json: string | null;
  }>(
    `SELECT id, canonical_job_id, opportunity_version, evaluation_state, decision, quality_score, vetoed, evaluation_json
     FROM materialized_evaluations`
  );

  console.log(`Scanned ${evaluations.length} evaluations from database.`);

  const evalUpdates: Array<{ id: string; decision: string | null; score: number | null; evalState: string; vetoed: number }> = [];
  const locUpdates: Array<{ ovId: string; location: string }> = [];

  for (const ev of evaluations) {
    const extracted = extractCanonicalEvalFields(
      ev.evaluation_json,
      ev.evaluation_state,
      ev.decision,
      ev.quality_score,
      ev.vetoed
    );

    const needsUpdate =
      ev.decision !== extracted.decision ||
      ev.quality_score !== extracted.score ||
      ev.evaluation_state !== extracted.evalState ||
      ev.vetoed !== extracted.vetoed;

    if (needsUpdate) {
      evalUpdates.push({
        id: ev.id,
        decision: extracted.decision,
        score: extracted.score,
        evalState: extracted.evalState,
        vetoed: extracted.vetoed,
      });
    }

    if (extracted.location) {
      locUpdates.push({
        ovId: ev.opportunity_version,
        location: extracted.location,
      });
    }
  }

  console.log(`Identified ${evalUpdates.length} evaluations and ${locUpdates.length} location updates needing synchronization.`);

  const client = (db as any).client;
  const BATCH_SIZE = 250;

  console.log("Applying evaluation updates in batched HTTP requests...");
  for (let i = 0; i < evalUpdates.length; i += BATCH_SIZE) {
    const chunk = evalUpdates.slice(i, i + BATCH_SIZE);
    const statements = chunk.map((item) => ({
      sql: `UPDATE materialized_evaluations SET decision = ?, quality_score = ?, evaluation_state = ?, vetoed = ? WHERE id = ?`,
      args: [item.decision, item.score, item.evalState, item.vetoed, item.id],
    }));

    if (client && typeof client.batch === "function") {
      await client.batch(statements, "write");
    } else {
      await db.transaction(async (tx) => {
        for (const stmt of statements) {
          await tx.execute(stmt.sql, stmt.args);
        }
      });
    }
    process.stdout.write(`Evaluations synchronized: ${Math.min(i + BATCH_SIZE, evalUpdates.length)} / ${evalUpdates.length}\r`);
  }
  console.log(`\nAll evaluation updates applied.`);

  console.log("Applying location updates in batched HTTP requests...");
  for (let i = 0; i < locUpdates.length; i += BATCH_SIZE) {
    const chunk = locUpdates.slice(i, i + BATCH_SIZE);
    const statements = chunk.map((item) => ({
      sql: `UPDATE opportunity_versions SET location = ? WHERE id = ? AND (location IS NULL OR location = '' OR location = 'Unknown')`,
      args: [item.location, item.ovId],
    }));

    if (client && typeof client.batch === "function") {
      await client.batch(statements, "write");
    } else {
      await db.transaction(async (tx) => {
        for (const stmt of statements) {
          await tx.execute(stmt.sql, stmt.args);
        }
      });
    }
    process.stdout.write(`Locations synchronized: ${Math.min(i + BATCH_SIZE, locUpdates.length)} / ${locUpdates.length}\r`);
  }
  console.log(`\nAll location updates applied.`);

  // Post-sync audit
  const auditEvaluations = await db.many<{
    id: string;
    evaluation_state: string;
    decision: string | null;
    quality_score: number | null;
    vetoed: number;
    evaluation_json: string | null;
  }>(
    `SELECT id, evaluation_state, decision, quality_score, vetoed, evaluation_json
     FROM materialized_evaluations`
  );

  let auditMismatches = 0;
  for (const ev of auditEvaluations) {
    const extracted = extractCanonicalEvalFields(
      ev.evaluation_json,
      ev.evaluation_state,
      ev.decision,
      ev.quality_score,
      ev.vetoed
    );

    if (
      ev.decision !== extracted.decision ||
      ev.quality_score !== extracted.score ||
      ev.evaluation_state !== extracted.evalState ||
      ev.vetoed !== extracted.vetoed
    ) {
      auditMismatches++;
    }
  }

  console.log(`\nPost-Sync Verification: ${auditEvaluations.length} rows scanned, ${auditMismatches} mismatches.`);
  if (auditMismatches > 0) {
    throw new Error("Scalar sync audit failed: mismatches detected.");
  }

  console.log("SUCCESS: Database scalar columns are 100.00% synchronized with canonical evaluation truth!");
}

runScalarSync().catch((err) => {
  console.error(err);
  process.exit(1);
});
