/**
 * scripts/benchmarks/audit_all_metrics.ts
 */
import { getDatabaseAdapter } from "../../src/data/database/index";
import { OpportunityService } from "../../src/lib/intelligence/opportunity-service";

async function main() {
  const db = getDatabaseAdapter();
  const userId = "ms6i7e3y-4x0chy5fy";

  console.log("==========================================");
  console.log("DATABASE AUDIT FOR USER:", userId);
  console.log("==========================================");

  const cols = await db.many(`PRAGMA table_info(canonical_opportunities)`);
  console.log("canonical_opportunities columns:", cols.map((c: any) => c.name));

  const totalCanonical = await db.one<{ count: number }>(`SELECT COUNT(*) as count FROM canonical_opportunities`);
  console.log("1. Total Canonical Opportunities (DB-wide):", totalCanonical?.count);

  const byPortal = await db.many<{ source: string; count: number }>(
    `SELECT source, COUNT(*) as count FROM canonical_opportunities GROUP BY source`
  );
  console.log("2. Total Canonical by Source Portal:", byPortal);

  const totalCandidates = await db.one<{ count: number }>(
    `SELECT COUNT(*) as count FROM search_plan_candidates WHERE person_id = ? AND attention_decision = 'CANDIDATE'`,
    [userId]
  );
  console.log("3. Total AttentionGate Candidates (Search Plan Population):", totalCandidates?.count);

  const totalCandidatesByPortal = await db.many<{ source: string; count: number }>(
    `SELECT co.source, COUNT(*) as count 
     FROM search_plan_candidates spc
     JOIN canonical_opportunities co ON spc.canonical_job_id = co.id
     WHERE spc.person_id = ? AND spc.attention_decision = 'CANDIDATE'
     GROUP BY co.source`,
    [userId]
  );
  console.log("4. Candidates by Source Portal:", totalCandidatesByPortal);

  const totalDecisions = await db.one<{ count: number }>(
    `SELECT COUNT(*) as count FROM canonical_decisions WHERE person_id = ? AND action != 'NONE'`,
    [userId]
  );
  console.log("5. Total User Decisions (canonical_decisions):", totalDecisions?.count);

  const decisionsByAction = await db.many<{ action: string; count: number }>(
    `SELECT action, COUNT(*) as count FROM canonical_decisions WHERE person_id = ? GROUP BY action`,
    [userId]
  );
  console.log("6. Decisions by Action:", decisionsByAction);

  const evals = await db.many<{ evaluation_state: string; decision: string; count: number }>(
    `SELECT evaluation_state, decision, COUNT(*) as count 
     FROM materialized_evaluations WHERE person_id = ? 
     GROUP BY evaluation_state, decision`,
    [userId]
  );
  console.log("7. Materialized Evaluations:", evals);

  console.log("\n--- Calling OpportunityService.getMetricsForUser ---");
  const metrics = await OpportunityService.getMetricsForUser(userId);
  console.log("Calculated Metrics Object:", JSON.stringify(metrics, null, 2));
}

main().catch(console.error);
