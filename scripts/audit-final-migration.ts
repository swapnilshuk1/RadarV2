import { getDatabaseAdapter } from "../src/data/database";

async function main() {
  const db = getDatabaseAdapter();

  console.log("============================================================");
  console.log("RADAR V4 — POST-MIGRATION PRODUCTION AUDIT & VERIFICATION");
  console.log("============================================================");

  // 1. Total Evaluations
  const totalEvals = (await db.one<{ count: number }>("SELECT count(*) as count FROM candidate_evaluations"))?.count || 0;
  const canonicalV43 = (await db.one<{ count: number }>("SELECT count(*) as count FROM candidate_evaluations WHERE policy_version = 'v4.3'"))?.count || 0;
  const legacyCount = (await db.one<{ count: number }>("SELECT count(*) as count FROM candidate_evaluations WHERE policy_version != 'v4.3'"))?.count || 0;

  // 2. Policy Version Breakdown
  const versions = await db.many<{ policy_version: string; count: number }>(
    "SELECT policy_version, count(*) as count FROM candidate_evaluations GROUP BY policy_version ORDER BY count DESC"
  );

  // 3. User Decisions Preservation
  const totalDecisions = (await db.one<{ count: number }>("SELECT count(*) as count FROM decisions"))?.count || 0;
  const decisionActions = await db.many<{ action: string; count: number }>(
    "SELECT action, count(*) as count FROM decisions GROUP BY action ORDER BY count DESC"
  );

  // 4. User Overrides in Candidate Evaluations
  const overrides = await db.many<{ user_decision_override: string; count: number }>(
    "SELECT user_decision_override, count(*) as count FROM candidate_evaluations WHERE user_decision_override IS NOT NULL GROUP BY user_decision_override"
  );

  // 5. Schema Versions in Evaluation JSON
  const schemaVersions = await db.many<{ schema_version: string; count: number }>(
    `SELECT json_extract(evaluation_json, '$.schemaVersion') as schema_version, count(*) as count 
     FROM candidate_evaluations 
     WHERE policy_version = 'v4.3' 
     GROUP BY schema_version`
  );

  console.log("1. Total Candidate Evaluations :", totalEvals);
  console.log("2. Canonical v4.3 Evaluations   :", canonicalV43);
  console.log("3. Skipped / Legacy Evaluations :", legacyCount);
  console.log("------------------------------------------------------------");
  console.log("Policy Versions Breakdown      :", versions);
  console.log("------------------------------------------------------------");
  console.log("Total Decisions in Database    :", totalDecisions);
  console.log("Decisions Breakdown            :", decisionActions);
  console.log("User Overrides in Evaluations  :", overrides);
  console.log("Canonical JSON Schema Versions :", schemaVersions);
  console.log("============================================================");
}

main().catch(console.error);
