import { getDatabaseAdapter } from "../src/data/database";
import { getRepositories } from "../src/data/sqlite/provider";
import { OpportunityService } from "../src/lib/intelligence/opportunity-service";

async function reconcileProductionPopulation() {
  const db = getDatabaseAdapter();
  const repos = getRepositories();
  const userId = "ms6i7e3y-4x0chy5fy";

  console.log("==================================================");
  console.log("FORENSIC VERIFICATION OF TURSO PRODUCTION POPULATION");
  console.log("==================================================");

  // 1. Total valid opportunities
  const totalOppsRow = await db.one<{ count: number }>("SELECT COUNT(*) as count FROM opportunities");
  const totalValidOpps = totalOppsRow?.count ?? 0;

  // 2. Total with completed evaluations in DB
  const totalEvalsRow = await db.one<{ count: number }>(
    "SELECT COUNT(*) as count FROM candidate_evaluations WHERE person_id = ? AND (evaluation_status = 'COMPLETE' OR evaluation_status IS NULL)",
    [userId]
  );
  const totalCompletedEvals = totalEvalsRow?.count ?? 0;

  // 3. Total without evaluations
  // Distinct opportunity IDs vs evaluated job hashes
  const evaluatedHashesRows = await db.many<{ job_hash: string }>(
    "SELECT DISTINCT job_hash FROM candidate_evaluations WHERE person_id = ?",
    [userId]
  );
  const evaluatedHashSet = new Set(evaluatedHashesRows.map((r) => r.job_hash));

  const allOppIdsRows = await db.many<{ id: string }>("SELECT id FROM opportunities");
  let totalUnevaluatedOpps = 0;
  for (const row of allOppIdsRows) {
    if (!evaluatedHashSet.has(row.id)) {
      totalUnevaluatedOpps++;
    }
  }

  // 4. Total explicit user decisions in 'decisions' table
  const userDecisionsDB = await repos.decisions.getUserDecisions(userId);
  const explicitDecisionsCount = Object.keys(userDecisionsDB).length;

  // 5. Total unresolved + evaluated opportunities
  const allEvaluations = await db.many<any>(
    "SELECT job_hash, engine_verdict, quality_score, user_decision_override, evaluation_json FROM candidate_evaluations WHERE person_id = ?",
    [userId]
  );

  let unresolvedEvaluatedCount = 0;
  let resolvedEvaluatedCount = 0;

  for (const ev of allEvaluations) {
    const hasExplicitDecision = Boolean(userDecisionsDB[ev.job_hash]);
    if (hasExplicitDecision) {
      resolvedEvaluatedCount++;
    } else {
      unresolvedEvaluatedCount++;
    }
  }

  // 6. Total unresolved + unevaluated
  let unresolvedUnevaluatedCount = 0;
  for (const row of allOppIdsRows) {
    if (!evaluatedHashSet.has(row.id) && !userDecisionsDB[row.id]) {
      unresolvedUnevaluatedCount++;
    }
  }

  // 7. Total currently returned by OpportunityService.listForUser(userId)
  const currentListForUser = await OpportunityService.listForUser(userId);
  const currentListForUserCount = currentListForUser.length;

  // 8. Total reaching Shortlist with current filter
  const currentShortlistRemaining = currentListForUser.filter((o) => {
    const clientRec = userDecisionsDB[o.jobHash];
    const userVerb = clientRec?.verb || o.userDecision?.userAction;
    if (userVerb === "PURSUE") return false;

    const currentFingerprint = o.engineRecommendation?.evaluationFingerprint || (o as any).recommendationResult?.policyVersion;
    if (clientRec && clientRec.reviewedFingerprint && clientRec.reviewedFingerprint === currentFingerprint) return false;

    if (o.reviewWorkflowState === "UNREVIEWED") {
      if (clientRec && !clientRec.reviewedFingerprint) return false;
      return true;
    }

    if (o.reviewWorkflowState === "REVIEWED_STALE") {
      if (clientRec && clientRec.reviewedFingerprint === currentFingerprint) return false;
      return true;
    }

    if (o.reviewWorkflowState === "REVIEWED_UNKNOWN") {
      if (clientRec && clientRec.reviewedFingerprint === currentFingerprint) return false;
      const action = o.userDecision?.userAction || o.engineRecommendation?.engineVerdict;
      return action === "PURSUE" || action === "CONSIDER";
    }

    return false;
  });

  console.log(`\n--- PRODUCTION POPULATION METRICS ---`);
  console.log(`1. Total Valid Opportunities in DB           : ${totalValidOpps}`);
  console.log(`2. Total Completed Evaluations in DB          : ${totalCompletedEvals}`);
  console.log(`3. Total Opportunities Without Evaluations    : ${totalUnevaluatedOpps}`);
  console.log(`4. Total Explicit User Decisions in DB        : ${explicitDecisionsCount}`);
  console.log(`5. Total Unresolved + Evaluated Opportunities : ${unresolvedEvaluatedCount}`);
  console.log(`6. Total Unresolved + Unevaluated Opps        : ${unresolvedUnevaluatedCount}`);
  console.log(`7. Returned by OpportunityService (Current)   : ${currentListForUserCount}`);
  console.log(`8. Reaching Shortlist (Current)               : ${currentShortlistRemaining.length}`);

  // 9. Check 207 cohort breakdown
  const cohortOpps = await db.many<{ id: string }>("SELECT id FROM opportunities WHERE created_at >= '2026-08-16'");
  const cohortIds = cohortOpps.map((o) => o.id);

  let cohortEvaluatedUnreviewed = 0;
  let cohortUnevaluated = 0;
  let cohortDecided = 0;

  for (const id of cohortIds) {
    const hasDec = Boolean(userDecisionsDB[id]);
    const hasEval = evaluatedHashSet.has(id);

    if (hasDec) {
      cohortDecided++;
    } else if (hasEval) {
      cohortEvaluatedUnreviewed++;
    } else {
      cohortUnevaluated++;
    }
  }

  console.log(`\n--- RECENT 207 COHORT RECONCILIATION ---`);
  console.log(`- Cohort Total                      : ${cohortIds.length}`);
  console.log(`- Evaluated + Unreviewed (Eligible) : ${cohortEvaluatedUnreviewed}`);
  console.log(`- Unevaluated (Pending)             : ${cohortUnevaluated}`);
  console.log(`- Explicit User Decided             : ${cohortDecided}`);

  // Check 3 historical exemplars
  const targetIds = ["j-f1b1ee48cdde", "j-54ccee9cecb4", "j-066180afd525"];
  console.log(`\n--- HISTORICAL STALE PURSUE EXEMPLARS ---`);
  for (const id of targetIds) {
    const dec = userDecisionsDB[id];
    console.log(`Target ID ${id}: User Decision in DB = ${dec?.verb}`);
  }
}

reconcileProductionPopulation().catch(console.error);
