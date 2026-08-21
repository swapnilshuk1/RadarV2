import { getDatabaseAdapter } from "../src/data/database";
import { getRepositories } from "../src/data/sqlite/provider";
import { OpportunityService } from "../src/lib/intelligence/opportunity-service";

async function runCohortAnalysis() {
  const db = getDatabaseAdapter();
  const repos = getRepositories();
  const userId = "ms6i7e3y-4x0chy5fy";

  console.log("==================================================");
  console.log("PHASE 1: IDENTIFYING THE RECENT SCRAPE COHORT");
  console.log("==================================================");

  // Query opportunities ordered by created_at desc to find the recent batch (~100 opportunities)
  const allOpps = await db.many<any>(
    "SELECT id, canonical_title, company_id, location, created_at FROM opportunities ORDER BY created_at DESC"
  );
  console.log(`Total opportunities in DB: ${allOpps.length}`);

  // Let's examine created_at distribution
  const timestamps = allOpps.map((o) => o.created_at).filter(Boolean);
  console.log("Sample recent timestamps:", timestamps.slice(0, 15));

  // Let's group opportunities by creation timestamp / date / batch
  const dateGroups: Record<string, any[]> = {};
  for (const o of allOpps) {
    const dt = o.created_at ? o.created_at.slice(0, 10) : "UNKNOWN";
    if (!dateGroups[dt]) dateGroups[dt] = [];
    dateGroups[dt].push(o);
  }

  console.log("\nOpportunity counts by creation date:");
  for (const [date, list] of Object.entries(dateGroups)) {
    console.log(`  ${date}: ${list.length} opportunities`);
  }

  // Also query evaluations to see created/updated timestamps
  const evalRows = await db.many<any>(
    "SELECT person_id, job_hash, engine_verdict, quality_score, user_decision_override, effective_decision, updated_at FROM candidate_evaluations WHERE person_id = ? ORDER BY updated_at DESC",
    [userId]
  );
  console.log(`\nTotal candidate_evaluations in DB for user ${userId}: ${evalRows.length}`);

  // Let's check candidate_evaluations updated_at distribution
  const evalDateGroups: Record<string, any[]> = {};
  for (const e of evalRows) {
    const dt = e.updated_at ? e.updated_at.slice(0, 10) : "UNKNOWN";
    if (!evalDateGroups[dt]) evalDateGroups[dt] = [];
    evalDateGroups[dt].push(e);
  }

  console.log("\nCandidate evaluations counts by updated_at date:");
  for (const [date, list] of Object.entries(evalDateGroups)) {
    console.log(`  ${date}: ${list.length} evaluations`);
  }

  // Query user decisions
  const decisionRows = await db.many<any>(
    "SELECT person_id, opportunity_id as job_hash, action, reason, reviewed_fingerprint, updated_at FROM decisions WHERE person_id = ?",
    [userId]
  );
  console.log(`\nTotal decisions in DB for user ${userId}: ${decisionRows.length}`);

  const userActionCounts: Record<string, number> = {};
  for (const d of decisionRows) {
    userActionCounts[d.action] = (userActionCounts[d.action] || 0) + 1;
  }
  console.log("User decision actions in DB:", userActionCounts);
}

runCohortAnalysis().catch(console.error);
