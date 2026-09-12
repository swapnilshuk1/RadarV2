import { getDatabaseAdapter } from "../src/data/database";
import { getRepositories } from "../src/data/sqlite/provider";
import { OpportunityService } from "../src/lib/intelligence/opportunity-service";

async function runBaseline() {
  console.log("==========================================================");
  console.log(" RADAR V4 PHASE 7.2 METRIC INTEGRITY FORENSIC BASELINE");
  console.log("==========================================================");

  const db = getDatabaseAdapter();
  const userId = "guest-user";

  // 1. Authoritative DB State
  const dbTotalScreened = await db.one<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM candidate_evaluations WHERE person_id = ?`,
    [userId]
  );
  const dbVerdicts = await db.many<{ engine_verdict: string; cnt: number }>(
    `SELECT engine_verdict, COUNT(*) as cnt FROM candidate_evaluations WHERE person_id = ? GROUP BY engine_verdict`,
    [userId]
  );
  const dbOverrides = await db.many<{ user_decision_override: string; cnt: number }>(
    `SELECT user_decision_override, COUNT(*) as cnt FROM candidate_evaluations WHERE person_id = ? AND user_decision_override IS NOT NULL GROUP BY user_decision_override`,
    [userId]
  );
  const dbEffective = await db.many<{ effective_decision: string; cnt: number }>(
    `SELECT effective_decision, COUNT(*) as cnt FROM candidate_evaluations WHERE person_id = ? GROUP BY effective_decision`,
    [userId]
  );
  const dbDecisionsTable = await db.one<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM decisions WHERE person_id = ?`,
    [userId]
  );

  console.log("\n1. AUTHORITATIVE DATABASE COUNTS (person_id = 'guest-user'):");
  console.log(`- Total candidate_evaluations (Screened): ${dbTotalScreened?.cnt ?? 0}`);
  console.log("- Engine Verdicts:", dbVerdicts);
  console.log("- User Overrides:", dbOverrides);
  console.log("- Effective Decisions:", dbEffective);
  console.log(`- Decisions Table Records: ${dbDecisionsTable?.cnt ?? 0}`);

  // 2. Service Level Canonical Metrics
  const serviceMetrics = await OpportunityService.getMetricsForUser(userId);
  console.log("\n2. SERVICE LEVEL CANONICAL METRICS (OpportunityService.getMetricsForUser):");
  console.log(serviceMetrics);

  // 3. Service Level Bounded List (Top-100 Feed)
  const top100Feed = await OpportunityService.listForUser(userId);
  console.log("\n3. TOP-100 BOUNDED FEED ARRAY (OpportunityService.listForUser):");
  console.log(`- Length: ${top100Feed.length}`);

  // 4. Local UI Array Calculation Simulation (from index.tsx)
  const feedActivePursuits = top100Feed.filter((o) => {
    const userAct = o.userDecision?.userAction;
    if (userAct) return userAct === "PURSUE";
    return o.decision === "PURSUE";
  }).length;

  const feedShortlisted = top100Feed.filter(
    (o) => o.decision === "PURSUE" || o.decision === "CONSIDER"
  ).length;

  console.log("\n4. SIMULATED LOCAL UI ARRAY CALCULATIONS (Top-100 Feed Array):");
  console.log(`- Feed-Calculated Active Pursuits: ${feedActivePursuits} (DISCREPANCY vs Service Metric: ${serviceMetrics.activePursuits})`);
  console.log(`- Feed-Calculated Shortlisted: ${feedShortlisted} (DISCREPANCY vs Service Metric: ${serviceMetrics.shortlistedCount})`);

  console.log("\n==========================================================");
}

runBaseline().catch(console.error);
