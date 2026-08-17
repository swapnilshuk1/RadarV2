import fs from "fs";
import path from "path";
import { getRepositories } from "../src/data/sqlite/provider";
import { getDatabaseAdapter } from "../src/data/database";
import { OpportunityService } from "../src/lib/intelligence/opportunity-service";

export async function runPopulationDiagnostic(isAfterRun = false) {
  console.log("==========================================================");
  console.log(` RADAR V4 PHASE 7 POPULATION DIAGNOSTIC (${isAfterRun ? "POST-CHANGE" : "PRE-CHANGE BASELINE"})`);
  console.log("==========================================================\n");

  const repos = getRepositories();
  const db = getDatabaseAdapter();

  // 1. Active User Profile Resolution
  const activeUser = "guest-user"; // Default guest user profile

  // 2. Database Counts
  const totalEvalRow = await db.one<{ count: number }>("SELECT COUNT(*) as count FROM candidate_evaluations");
  const userEvalRow = await db.one<{ count: number }>(
    "SELECT COUNT(*) as count FROM candidate_evaluations WHERE person_id = ?",
    [activeUser]
  );
  const distinctJobsRow = await db.one<{ count: number }>(
    "SELECT COUNT(DISTINCT job_hash) as count FROM candidate_evaluations WHERE person_id = ?",
    [activeUser]
  );

  const totalEvaluationsCount = totalEvalRow?.count ?? 0;
  const userEvaluationsCount = userEvalRow?.count ?? 0;
  const userDistinctJobsCount = distinctJobsRow?.count ?? 0;

  console.log(`1. DATABASE POPULATION:`);
  console.log(`   - Global candidate_evaluations total : ${totalEvaluationsCount}`);
  console.log(`   - Active user ('${activeUser}') count  : ${userEvaluationsCount}`);
  console.log(`   - Distinct job_hash count            : ${userDistinctJobsCount}`);

  // 3. Top-100 Bounded Retrieval
  const top100Evaluations = await repos.evaluations.listEvaluationsForUser(activeUser, 100);
  console.log(`\n2. BOUNDED FEED RETRIEVAL:`);
  console.log(`   - top-100 listEvaluationsForUser length : ${top100Evaluations.length}`);

  // 4. Distribution Calculations across Full Population vs Top-100
  const fullRows = await db.many<any>(
    "SELECT engine_verdict, user_decision_override, effective_decision, quality_score, evaluation_status FROM candidate_evaluations WHERE person_id = ?",
    [activeUser]
  );

  const fullCounts = { PURSUE: 0, CONSIDER: 0, PASS: 0, SPARSE_SPEC: 0, OTHER: 0 };
  fullRows.forEach((r) => {
    const verdict = r.engine_verdict as keyof typeof fullCounts;
    if (fullCounts[verdict] !== undefined) fullCounts[verdict]++;
    else fullCounts.OTHER++;
  });

  const top100Counts = { PURSUE: 0, CONSIDER: 0, PASS: 0, SPARSE_SPEC: 0, OTHER: 0 };
  top100Evaluations.forEach((r) => {
    const verdict = r.engineVerdict as keyof typeof top100Counts;
    if (top100Counts[verdict] !== undefined) top100Counts[verdict]++;
    else top100Counts.OTHER++;
  });

  console.log(`\n3. ENGINE VERDICT DISTRIBUTION COMPARISON:`);
  console.table([
    { Metric: "Full Population Total", Value: userEvaluationsCount },
    { Metric: "Top-100 Feed Total", Value: top100Evaluations.length },
    { Metric: "Full Population PURSUE", Value: fullCounts.PURSUE },
    { Metric: "Top-100 Feed PURSUE", Value: top100Counts.PURSUE },
    { Metric: "Full Population CONSIDER", Value: fullCounts.CONSIDER },
    { Metric: "Top-100 Feed CONSIDER", Value: top100Counts.CONSIDER },
    { Metric: "Full Population PASS", Value: fullCounts.PASS },
    { Metric: "Top-100 Feed PASS", Value: top100Counts.PASS },
  ]);

  // 5. User Decisions State Inspection
  const userDecisions = await repos.decisions.getUserDecisions(activeUser);
  const decisionHashes = Object.keys(userDecisions);
  console.log(`\n4. USER DECISIONS STATE:`);
  console.log(`   - Total explicit user decisions recorded: ${decisionHashes.length}`);

  // Check if any user decision is outside top 100
  const top100Hashes = new Set(top100Evaluations.map((e) => e.jobHash));
  const decisionsOutsideTop100 = decisionHashes.filter((hash) => !top100Hashes.has(hash));
  console.log(`   - Decisions inside top-100 feed         : ${decisionHashes.length - decisionsOutsideTop100.length}`);
  console.log(`   - Decisions OUTSIDE top-100 feed        : ${decisionsOutsideTop100.length}`);

  if (decisionsOutsideTop100.length > 0) {
    console.log(`   - Sample decision outside top 100        : ${decisionsOutsideTop100[0]} (${userDecisions[decisionsOutsideTop100[0]].verb})`);
  }

  // 6. Identify Rank >100 Opportunity suitable for dossier navigation
  const rank101Row = fullRows.sort((a, b) => b.quality_score - a.quality_score)[105];
  const rank101Eval = top100Evaluations.length >= 100 ? fullRows[105] : null;

  console.log(`\n5. DOSSIER NAVIGATION TARGET (> Rank 100):`);
  if (rank101Eval) {
    console.log(`   - Opportunity at index 105 in full corpus: ${rank101Eval.job_hash} (Score: ${rank101Eval.quality_score})`);
  } else {
    console.log(`   - Corpus has fewer than 105 items.`);
  }

  // 7. Current Dashboard Metric Logic Simulation
  const currentOppList = await OpportunityService.listForUser(activeUser);
  console.log(`\n6. CURRENT OPPORTUNITY SERVICE OUTPUT (` + (isAfterRun ? "POST-CHANGE" : "TRUNCATED PRE-CHANGE") + `):`);
  console.log(`   - OpportunityService.listForUser length  : ${currentOppList.length}`);

  console.log("\n==========================================================\n");

  return {
    userEvaluationsCount,
    top100Length: top100Evaluations.length,
    fullCounts,
    top100Counts,
    totalUserDecisions: decisionHashes.length,
    decisionsOutsideTop100Count: decisionsOutsideTop100.length,
  };
}

if (process.argv[1] && process.argv[1].includes("diagnose-phase7-population")) {
  const isAfter = process.argv.includes("--after");
  runPopulationDiagnostic(isAfter).catch(console.error);
}
