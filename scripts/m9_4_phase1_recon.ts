import { getDatabaseAdapter } from "../src/data/database/index.js";

async function recon() {
  const db = getDatabaseAdapter();
  
  console.log("--- PHASE 1: READ-ONLY RECONNAISSANCE ---");
  
  // Legacy Counts
  const legOpps = await db.one("SELECT COUNT(*) as c FROM opportunities");
  const legEvals = await db.one("SELECT COUNT(*) as c FROM candidate_evaluations"); // Assumed V3 legacy evals
  const legAssessments = await db.one("SELECT COUNT(*) as c FROM assessments"); // Often used as well
  const legDecisions = await db.one("SELECT COUNT(*) as c FROM decisions");
  
  // V4 Canonical Counts
  const canOpps = await db.one("SELECT COUNT(*) as c FROM canonical_opportunities");
  const oppVersions = await db.one("SELECT COUNT(*) as c FROM opportunity_versions");
  const evalContexts = await db.one("SELECT COUNT(*) as c FROM evaluation_contexts");
  const spCandidates = await db.one("SELECT COUNT(*) as c FROM search_plan_candidates");
  const evalJobs = await db.one("SELECT COUNT(*) as c FROM evaluation_jobs");
  const matEvals = await db.one("SELECT COUNT(*) as c FROM materialized_evaluations");
  const canDecisions = await db.one("SELECT COUNT(*) as c FROM canonical_decisions");
  const people = await db.one("SELECT COUNT(*) as c FROM people");
  const tenants = await db.one("SELECT COUNT(*) as c FROM tenants");
  const activeMemberships = await db.one("SELECT COUNT(*) as c FROM memberships WHERE status='active'");

  console.log("Legacy Accounts:");
  console.log("- opportunities:", legOpps?.c);
  console.log("- candidate_evaluations:", legEvals?.c);
  console.log("- assessments:", legAssessments?.c);
  console.log("- decisions:", legDecisions?.c);
  
  console.log("\nCanonical V4 Counts:");
  console.log("- canonical_opportunities:", canOpps?.c);
  console.log("- opportunity_versions:", oppVersions?.c);
  console.log("- evaluation_contexts:", evalContexts?.c);
  console.log("- search_plan_candidates:", spCandidates?.c);
  console.log("- evaluation_jobs:", evalJobs?.c);
  console.log("- materialized_evaluations:", matEvals?.c);
  console.log("- canonical_decisions:", canDecisions?.c);
  console.log("- people:", people?.c);
  console.log("- tenants:", tenants?.c);
  console.log("- memberships (active):", activeMemberships?.c);
}

recon().catch(console.error);
