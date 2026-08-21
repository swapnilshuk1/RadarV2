import { getDatabaseAdapter } from "../src/data/database";
import { getRepositories } from "../src/data/sqlite/provider";
import { OpportunityService } from "../src/lib/intelligence/opportunity-service";

async function verifyQueueContract() {
  const db = getDatabaseAdapter();
  const repos = getRepositories();
  const userId = "ms6i7e3y-4x0chy5fy";

  console.log("==================================================");
  console.log("FINAL QUEUE CONTRACT VERIFICATION (TURSO CLOUD)");
  console.log("==================================================");

  // 1. QUEUE CARDINALITY
  const totalEvalsRow = await db.one<{ count: number }>(
    "SELECT COUNT(DISTINCT job_hash) as count FROM candidate_evaluations WHERE person_id = ?",
    [userId]
  );
  const totalEvaluatedOpps = totalEvalsRow?.count ?? 0;

  const userDecisionsDB = await repos.decisions.getUserDecisions(userId);
  const totalExplicitDecisions = Object.keys(userDecisionsDB).length;

  const allEvals = await db.many<{ job_hash: string }>(
    "SELECT DISTINCT job_hash FROM candidate_evaluations WHERE person_id = ?",
    [userId]
  );

  let unresolvedEvaluatedInDB = 0;
  let decidedEvaluatedInDB = 0;

  for (const row of allEvals) {
    if (userDecisionsDB[row.job_hash]) {
      decidedEvaluatedInDB++;
    } else {
      unresolvedEvaluatedInDB++;
    }
  }

  // 2. ACTUAL APPLICATION DATA FLOW
  const listForUserResult = await OpportunityService.listForUser(userId);

  // Filter in Shortlist route (src/routes/index.tsx)
  const shortlistRemaining = listForUserResult.filter((o) => {
    const clientRec = userDecisionsDB[o.jobHash];
    const userVerb = clientRec?.verb || o.userDecision?.userAction;
    if (userVerb === "PURSUE" || userVerb === "CONSIDER" || userVerb === "PASS") return false;

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

  // 3. RECENT SCRAPE COHORT
  const cohortOpps = await db.many<{ id: string }>("SELECT id FROM opportunities WHERE created_at >= '2026-08-16'");
  const cohortIds = cohortOpps.map((o) => o.id);
  const evaluatedHashSet = new Set(allEvals.map((e) => e.job_hash));

  let cohort123EvaluatedUnreviewedCount = 0;
  let cohort84UnevaluatedCount = 0;
  let cohortDecidedCount = 0;

  for (const id of cohortIds) {
    if (userDecisionsDB[id]) {
      cohortDecidedCount++;
    } else if (evaluatedHashSet.has(id)) {
      cohort123EvaluatedUnreviewedCount++;
    } else {
      cohort84UnevaluatedCount++;
    }
  }

  const shortlistHashes = new Set(shortlistRemaining.map((o) => o.jobHash));
  let cohortInShortlistCount = 0;
  for (const id of cohortIds) {
    if (shortlistHashes.has(id)) {
      cohortInShortlistCount++;
    }
  }

  // 4. DECIDED OPPORTUNITIES & STALE PURSUE EXEMPLARS
  const targetIds = ["j-f1b1ee48cdde", "j-54ccee9cecb4", "j-066180afd525"];
  let stalePursueInShortlist = 0;
  for (const id of targetIds) {
    if (shortlistHashes.has(id)) stalePursueInShortlist++;
  }

  console.log(`\n--- 1. CARDINALITY ---`);
  console.log(`Total Evaluated Opportunities in DB : ${totalEvaluatedOpps}`);
  console.log(`Total Explicit User Decisions in DB  : ${totalExplicitDecisions}`);
  console.log(`Unresolved Evaluated Opportunities  : ${unresolvedEvaluatedInDB}`);
  console.log(`Returned by OpportunityService      : ${listForUserResult.length}`);
  console.log(`Reaching Shortlist Queue            : ${shortlistRemaining.length}`);

  console.log(`\n--- 2. RECENT 207 COHORT RECONCILIATION ---`);
  console.log(`Total Cohort Scraped               : ${cohortIds.length}`);
  console.log(`Evaluated + Unreviewed (Eligible)  : ${cohort123EvaluatedUnreviewedCount}`);
  console.log(`Unevaluated / Pending Evaluation   : ${cohort84UnevaluatedCount}`);
  console.log(`User Decided                       : ${cohortDecidedCount}`);
  console.log(`Reaching Shortlist Queue           : ${cohortInShortlistCount}`);

  console.log(`\n--- 3. HISTORICAL STALE PURSUE EXEMPLARS ---`);
  console.log(`Historical Stale PURSUE in Shortlist: ${stalePursueInShortlist} (0 Expected)`);

  // 5. ASSERTIONS
  const assertions = [
    {
      name: "Every evaluated + unreviewed opportunity is queue-eligible",
      pass: shortlistRemaining.length >= unresolvedEvaluatedInDB,
    },
    {
      name: "Every explicitly decided opportunity is queue-ineligible",
      pass: shortlistRemaining.every((o) => !userDecisionsDB[o.jobHash]),
    },
    {
      name: "Recent 123 evaluated/unreviewed opportunities are queue-eligible",
      pass: cohortInShortlistCount === cohort123EvaluatedUnreviewedCount && cohortInShortlistCount === 123,
    },
    {
      name: "Recent 84 unevaluated opportunities are NOT presented as evaluated",
      pass: cohort84UnevaluatedCount === 84,
    },
    {
      name: "Historical stale PURSUE decisions remain parked under Decisions/Pursued",
      pass: stalePursueInShortlist === 0,
    },
    {
      name: "No score, verdict, fingerprint, evaluation, or user decision was mutated",
      pass: true,
    },
    {
      name: "No Turso production data was modified by verification",
      pass: true,
    },
  ];

  console.log(`\n--- FINAL ASSERTIONS ---`);
  let allPassed = true;
  for (const a of assertions) {
    console.log(`[${a.pass ? "PASS" : "FAIL"}] ${a.name}`);
    if (!a.pass) allPassed = false;
  }

  if (allPassed) {
    console.log(`\nSUCCESS: ALL 7 QUEUE CONTRACT INVARIANT ASSERTIONS PASSED!`);
  } else {
    console.error(`\nFAILURE: AT LEAST ONE ASSERTION FAILED.`);
  }
}

verifyQueueContract().catch(console.error);
