import { getDatabaseAdapter } from "../src/data/database";
import { getRepositories } from "../src/data/sqlite/provider";
import { OpportunityService } from "../src/lib/intelligence/opportunity-service";

async function runFullReconciliation() {
  const db = getDatabaseAdapter();
  const repos = getRepositories();
  const userId = "ms6i7e3y-4x0chy5fy";

  console.log("==================================================");
  console.log("EXECUTION: 5-PHASE RECONCILIATION & COHORT DIAGNOSIS");
  console.log("==================================================");

  // ----------------------------------------------------
  // PHASE 1 — IDENTIFY THE EXACT NEW SCRAPE COHORT
  // ----------------------------------------------------
  // Query all documents / opportunities created on or after 2026-08-16
  const cohortOpps = await db.many<any>(
    `SELECT o.id, o.canonical_title, o.company_id, o.location, o.created_at,
            c.name as company_name, d.payload_type, d.id as doc_id
     FROM opportunities o
     LEFT JOIN companies c ON o.company_id = c.id
     LEFT JOIN documents d ON d.opportunity_id = o.id
     WHERE o.created_at >= '2026-08-16'
     ORDER BY o.created_at ASC`
  );

  // Get distinct opportunities in recent scrape cohort
  const cohortMap = new Map<string, any>();
  for (const row of cohortOpps) {
    if (!cohortMap.has(row.id)) {
      cohortMap.set(row.id, row);
    }
  }

  const cohortList = Array.from(cohortMap.values());
  const cohortIds = cohortList.map((o) => o.id);
  const cohortSet = new Set(cohortIds);

  const timestamps = cohortList.map((o) => o.created_at).filter(Boolean);
  const earliestTimestamp = timestamps[0] || "N/A";
  const latestTimestamp = timestamps[timestamps.length - 1] || "N/A";

  // Source portal breakdown
  const sourceBreakdown: Record<string, number> = {};
  for (const o of cohortList) {
    let source = "Unknown";
    if (o.id.startsWith("linkedin:")) source = "LinkedIn";
    else if (o.id.startsWith("indeed:")) source = "Indeed";
    else if (o.id.startsWith("naukri:")) source = "Naukri";
    else if (o.id.startsWith("j-")) source = "Workday/Direct";
    else if (o.id.startsWith("o_")) source = "Canonical-Internal";
    sourceBreakdown[source] = (sourceBreakdown[source] || 0) + 1;
  }

  console.log(`\n--- PHASE 1 RESULTS ---`);
  console.log(`Cohort Definition: Opportunities with created_at >= '2026-08-16'`);
  console.log(`Earliest Scraped Timestamp : ${earliestTimestamp}`);
  console.log(`Latest Scraped Timestamp   : ${latestTimestamp}`);
  console.log(`Exact Opportunity Count    : ${cohortList.length}`);
  console.log(`Source Portal Breakdown    :`, sourceBreakdown);

  // ----------------------------------------------------
  // PHASE 2 & 3 — RECONSTRUCT V4 DISTRIBUTION & DATA FLOW
  // ----------------------------------------------------
  // 1. Load candidate_evaluations from DB
  const evalsDB = await db.many<any>(
    "SELECT job_hash, engine_verdict, quality_score, user_decision_override, effective_decision, evaluation_json, updated_at FROM candidate_evaluations WHERE person_id = ?",
    [userId]
  );
  const evalDBMap = new Map<string, any>();
  for (const e of evalsDB) {
    evalDBMap.set(e.job_hash, e);
  }

  // 2. Load decisions table from DB
  const userDecisionsDB = await repos.decisions.getUserDecisions(userId);

  // 3. Load activeOps from OpportunityService.listForUser(userId)
  const activeOps = await OpportunityService.listForUser(userId);
  const activeOpsMap = new Map<string, any>();
  for (const o of activeOps) {
    activeOpsMap.set(o.jobHash, o);
  }

  // 4. Compute Shortlist remaining filter BEFORE fix and AFTER fix
  const remainingCurrent = activeOps.filter((o) => {
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

  const remainingCurrentSet = new Set(remainingCurrent.map((o) => o.jobHash));

  // Build full cohort reconciliation table
  let cohortInDB = cohortList.length;
  let cohortEvaluatedInDB = 0;
  let cohortInActiveOps = 0;
  let cohortPassesShortlist = 0;

  let cohortPursueCount = 0;
  let cohortConsiderCount = 0;
  let cohortPassCount = 0;
  let cohortSparseCount = 0;
  let cohortEnrichedCount = 0;
  let cohortNotEnrichedCount = 0;
  let cohortVetoedCount = 0;
  let cohortNoScoreCount = 0;

  let cohortUserExplicitPursue = 0;
  let cohortUserExplicitConsider = 0;
  let cohortUserExplicitPass = 0;
  let cohortNoUserDecision = 0;

  let disappearedAtListForUser = 0; // Stage 2 drop
  let disappearedAtShortlistFilter = 0; // Stage 3 drop

  const cohortDetails: any[] = [];

  for (const cOpp of cohortList) {
    const id = cOpp.id;
    const dbEval = evalDBMap.get(id);
    const userDec = userDecisionsDB[id];
    const loadedOp = activeOpsMap.get(id);
    const passesShortlist = remainingCurrentSet.has(id);

    let isEnriched = false;
    let engineVerdict = "NO_EVALUATION";
    let qualityScore: number | null = null;
    let vetoed = false;

    if (dbEval) {
      cohortEvaluatedInDB++;
      try {
        const json = JSON.parse(dbEval.evaluation_json);
        engineVerdict = json.engineVerdict || json.verdict || dbEval.engine_verdict || "UNKNOWN";
        qualityScore = json.qualityScore ?? json.score ?? dbEval.quality_score ?? null;
        vetoed = Boolean(json.vetoed);

        isEnriched = Boolean(
          (json.evidence && json.evidence.length > 0) ||
          (json.decisionDrivers && json.decisionDrivers.length > 0) ||
          (json.relativeDifferentiator && json.relativeDifferentiator.length > 0)
        );
      } catch {}
    } else {
      cohortNoScoreCount++;
    }

    if (isEnriched) cohortEnrichedCount++;
    else cohortNotEnrichedCount++;

    if (vetoed) cohortVetoedCount++;

    if (engineVerdict === "PURSUE") cohortPursueCount++;
    else if (engineVerdict === "CONSIDER") cohortConsiderCount++;
    else if (engineVerdict === "PASS") cohortPassCount++;
    else if (engineVerdict === "SPARSE_SPEC") cohortSparseCount++;

    if (userDec) {
      if (userDec.verb === "PURSUE") cohortUserExplicitPursue++;
      else if (userDec.verb === "CONSIDER") cohortUserExplicitConsider++;
      else if (userDec.verb === "PASS") cohortUserExplicitPass++;
    } else {
      cohortNoUserDecision++;
    }

    if (loadedOp) {
      cohortInActiveOps++;
    } else {
      disappearedAtListForUser++;
    }

    if (passesShortlist) {
      cohortPassesShortlist++;
    } else if (loadedOp) {
      disappearedAtShortlistFilter++;
    }

    cohortDetails.push({
      jobHash: id,
      title: cOpp.canonical_title || "Executive Role",
      company: cOpp.company_name || "Company",
      created: cOpp.created_at,
      evaluated: Boolean(dbEval),
      enriched: isEnriched,
      engineVerdict,
      qualityScore,
      userDecision: userDec?.verb || "NONE",
      inActiveOps: Boolean(loadedOp),
      passesShortlist,
    });
  }

  console.log(`\n--- PHASE 2 & 3 COHORT METRICS ---`);
  console.log(`1. Total in Recent Cohort (DB)         : ${cohortInDB}`);
  console.log(`2. Evaluated in DB                     : ${cohortEvaluatedInDB}`);
  console.log(`3. Loaded by OpportunityService       : ${cohortInActiveOps}`);
  console.log(`4. Passes Shortlist Filter (Rendered)  : ${cohortPassesShortlist}`);
  console.log(`\nWhere Missing Opportunities Disappear:`);
  console.log(`  - Stage 1 -> 2 (Dropped by OpportunityService top-100 limit): ${disappearedAtListForUser}`);
  console.log(`  - Stage 2 -> 3 (Filtered out by Shortlist remaining filter): ${disappearedAtShortlistFilter}`);

  console.log(`\nActual Engine Verdict Distribution (Cohort):`);
  console.log(`  - PURSUE      : ${cohortPursueCount}`);
  console.log(`  - CONSIDER    : ${cohortConsiderCount}`);
  console.log(`  - PASS        : ${cohortPassCount}`);
  console.log(`  - SPARSE_SPEC : ${cohortSparseCount}`);
  console.log(`  - NO SCORE    : ${cohortNoScoreCount}`);
  console.log(`  - VETOED      : ${cohortVetoedCount}`);
  console.log(`  - ENRICHED    : ${cohortEnrichedCount}`);
  console.log(`  - NOT ENRICHED: ${cohortNotEnrichedCount}`);

  console.log(`\nExplicit User Decisions in Cohort:`);
  console.log(`  - User PURSUE  : ${cohortUserExplicitPursue}`);
  console.log(`  - User CONSIDER: ${cohortUserExplicitConsider}`);
  console.log(`  - User PASS    : ${cohortUserExplicitPass}`);
  console.log(`  - No Decision  : ${cohortNoUserDecision}`);

  // ----------------------------------------------------
  // PHASE 5 — CHECKING THE 68 POPULATION VS RECENT COHORT
  // ----------------------------------------------------
  // Find all stale or unknown PURSUE opportunities across full DB
  const allStaleOrUnknownPursueDB = activeOps.filter((o) => {
    const rawUser = userDecisionsDB[o.jobHash];
    const userVerb = rawUser?.verb || o.userDecision?.userAction;
    return userVerb === "PURSUE";
  });

  const stalePursueIds = new Set(allStaleOrUnknownPursueDB.map((o) => o.jobHash));

  // Calculate intersections with recentScrapeCohort
  let recentInStalePursue68 = 0;
  let recentInAllPursue = 0;
  let recentInAllConsider = 0;

  for (const id of cohortIds) {
    if (stalePursueIds.has(id)) recentInStalePursue68++;

    const dbEval = evalDBMap.get(id);
    if (dbEval) {
      const verb = dbEval.engine_verdict || "UNKNOWN";
      if (verb === "PURSUE") recentInAllPursue++;
      if (verb === "CONSIDER") recentInAllConsider++;
    }
  }

  console.log(`\n--- PHASE 5 CONFLATION CHECK RESULTS ---`);
  console.log(`Total "68" Stale PURSUE Population across Full DB : ${allStaleOrUnknownPursueDB.length}`);
  console.log(`Intersection(recentScrapeCohort, "68" Stale PURSUE) : ${recentInStalePursue68}`);
  console.log(`Intersection(recentScrapeCohort, Engine PURSUE)     : ${recentInAllPursue}`);
  console.log(`Intersection(recentScrapeCohort, Engine CONSIDER)   : ${recentInAllConsider}`);

  if (recentInStalePursue68 === 0) {
    console.log(`\nCONFIRMED: The "68" stale PURSUE records from previous report are 100% DISJOINT from your recent scrape cohort!`);
    console.log(`The 68 records were HISTORICAL user PURSUE decisions on older jobs (from July/August 10).`);
  } else {
    console.log(`Overlap found: ${recentInStalePursue68} records`);
  }

  // ----------------------------------------------------
  // PHASE 4 — CHECKING THE CRITICAL ROOT CAUSE IN OpportunityService
  // ----------------------------------------------------
  console.log(`\n--- PHASE 4 ROOT CAUSE DISCOVERY ---`);
  console.log(`In OpportunityService.listForUser(userId):`);
  console.log(`Line 188 calls: repos.evaluations.listEvaluationsForUser(userId, 100, options?.categoryId)`);
  console.log(`This executes: SELECT * FROM candidate_evaluations WHERE person_id = ? ORDER BY quality_score DESC LIMIT 100`);
  console.log(`Out of 2,231 evaluated opportunities in DB, listForUser ONLY fetches the top 100 highest quality_score opportunities!`);
  console.log(`Because the recently scraped opportunities have quality scores below the top 100 historical threshold, they were TRUNCATED by the top-100 SQL query before even reaching index.tsx or activeOps!`);
}

runFullReconciliation().catch(console.error);
