/**
 * scripts/benchmarks/check_scraped_status.ts
 */
import { getDatabaseAdapter } from "../../src/data/database/index";

async function main() {
  const db = getDatabaseAdapter();

  const opps = await db.one<{ count: number }>("SELECT COUNT(*) as count FROM canonical_opportunities");
  const versions = await db.one<{ count: number }>("SELECT COUNT(*) as count FROM opportunity_versions");
  const candidates = await db.one<{ count: number }>("SELECT COUNT(*) as count FROM search_plan_candidates");
  const evals = await db.one<{ count: number }>("SELECT COUNT(*) as count FROM materialized_evaluations");

  const recent = await db.many<{
    id: string;
    source: string;
    source_job_id: string;
    job_title: string;
    company_name: string;
    created_at: string;
  }>(
    `SELECT co.id, co.source, co.source_job_id, ov.job_title, co.company_name, co.created_at 
     FROM canonical_opportunities co
     LEFT JOIN opportunity_versions ov ON co.id = ov.canonical_job_id
     ORDER BY co.created_at DESC LIMIT 10`
  );

  console.log("==========================================");
  console.log("       DATABASE OPPORTUNITY STATUS");
  console.log("==========================================");
  console.log(`Total Canonical Opportunities : ${opps?.count}`);
  console.log(`Total Opportunity Versions    : ${versions?.count}`);
  console.log(`Total Search Plan Candidates  : ${candidates?.count}`);
  console.log(`Total Materialized Evaluations: ${evals?.count}`);
  console.log("==========================================");
  console.log("10 Most Recent Opportunities:");
  for (const r of recent) {
    console.log(`- [${r.source}] ${r.job_title} @ ${r.company_name} (ID: ${r.source_job_id}, created: ${r.created_at})`);
  }
}

main().catch(console.error);
