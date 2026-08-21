import { getDatabaseAdapter } from "../src/data/database/index.js";

async function runRecon() {
  const db = getDatabaseAdapter();
  console.log("=== Phase 1: M9.4 Read-Only Reconnaissance ===");

  const tables = [
    "opportunities",
    "documents",
    "sources",
    "candidate_evaluations",
    "decisions",
    "tenants",
    "users",
    "people",
    "memberships",
    "search_plans",
    "canonical_opportunities",
    "opportunity_versions",
    "evaluation_contexts",
    "search_plan_candidates",
    "evaluation_jobs",
    "materialized_evaluations",
    "canonical_decisions"
  ];

  for (const table of tables) {
    try {
      const res = await db.one<{ count: number }>(`SELECT COUNT(*) as count FROM ${table}`);
      console.log(`${table.padEnd(26)} : ${res?.count ?? 0}`);
    } catch (e: any) {
      console.log(`${table.padEnd(26)} : [ERROR] ${e.message}`);
    }
  }

  // Breakdown of legacy opportunities
  console.log("\n--- Legacy Opportunities ID Breakdown ---");
  const oppPatterns = [
    { name: "Starts with 'o_'", sql: "SELECT COUNT(*) as c FROM opportunities WHERE id LIKE 'o_%'" },
    { name: "Starts with 'indeed:'", sql: "SELECT COUNT(*) as c FROM opportunities WHERE id LIKE 'indeed:%'" },
    { name: "Starts with 'linkedin:'", sql: "SELECT COUNT(*) as c FROM opportunities WHERE id LIKE 'linkedin:%'" },
    { name: "Starts with 'naukri:'", sql: "SELECT COUNT(*) as c FROM opportunities WHERE id LIKE 'naukri:%'" },
    { name: "Other / Mocks", sql: "SELECT COUNT(*) as c FROM opportunities WHERE id NOT LIKE 'o_%' AND id NOT LIKE 'indeed:%' AND id NOT LIKE 'linkedin:%' AND id NOT LIKE 'naukri:%'" },
  ];

  for (const p of oppPatterns) {
    const r = await db.one<{ c: number }>(p.sql);
    console.log(`${p.name.padEnd(26)} : ${r?.c ?? 0}`);
  }

  // Breakdown of legacy decisions
  console.log("\n--- Legacy Decisions Breakdown ---");
  const decPatterns = [
    { name: "opportunity_id like 'o_%'", sql: "SELECT COUNT(*) as c FROM decisions WHERE opportunity_id LIKE 'o_%'" },
    { name: "opportunity_id like 'indeed:%'", sql: "SELECT COUNT(*) as c FROM decisions WHERE opportunity_id LIKE 'indeed:%'" },
    { name: "opportunity_id like 'linkedin:%'", sql: "SELECT COUNT(*) as c FROM decisions WHERE opportunity_id LIKE 'linkedin:%'" },
    { name: "opportunity_id like 'naukri:%'", sql: "SELECT COUNT(*) as c FROM decisions WHERE opportunity_id LIKE 'naukri:%'" },
    { name: "opportunity_id like 'j-%'", sql: "SELECT COUNT(*) as c FROM decisions WHERE opportunity_id LIKE 'j-%'" },
    { name: "Test / Mocks", sql: "SELECT COUNT(*) as c FROM decisions WHERE opportunity_id LIKE 'job_%' OR opportunity_id LIKE 'op-test%'" },
  ];

  for (const p of decPatterns) {
    const r = await db.one<{ c: number }>(p.sql);
    console.log(`${p.name.padEnd(30)} : ${r?.c ?? 0}`);
  }

  // Breakdown of legacy evaluations
  console.log("\n--- Legacy Candidate Evaluations Breakdown ---");
  const evalPatterns = [
    { name: "job_hash like 'indeed:%'", sql: "SELECT COUNT(*) as c FROM candidate_evaluations WHERE job_hash LIKE 'indeed:%'" },
    { name: "job_hash like 'linkedin:%'", sql: "SELECT COUNT(*) as c FROM candidate_evaluations WHERE job_hash LIKE 'linkedin:%'" },
    { name: "job_hash like 'naukri:%'", sql: "SELECT COUNT(*) as c FROM candidate_evaluations WHERE job_hash LIKE 'naukri:%'" },
    { name: "job_hash like 'j-%'", sql: "SELECT COUNT(*) as c FROM candidate_evaluations WHERE job_hash LIKE 'j-%'" },
    { name: "Test / Mocks", sql: "SELECT COUNT(*) as c FROM candidate_evaluations WHERE job_hash LIKE 'job_%' OR job_hash LIKE 'j-mock%'" },
  ];

  for (const p of evalPatterns) {
    const r = await db.one<{ c: number }>(p.sql);
    console.log(`${p.name.padEnd(30)} : ${r?.c ?? 0}`);
  }
}

runRecon().catch(console.error);
