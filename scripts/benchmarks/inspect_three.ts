/**
 * scripts/benchmarks/inspect_three.ts
 */
import { getDatabaseAdapter } from "../../src/data/database/index";

async function inspectThree() {
  const db = getDatabaseAdapter();
  const personId = "ms6i7e3y-4x0chy5fy";

  const rows = await db.many<{
    source: string;
    source_job_id: string;
    job_title: string;
    acquisition_status: string;
    acquisition_quality: string;
    attention_decision: string;
    job_id: string;
    job_status: string;
    eval_id: string;
    eval_decision: string;
    quality_score: number;
    vetoed: number;
    evaluation_state: string;
  }>(`
    SELECT 
      co.source, co.source_job_id, ov.job_title, ov.acquisition_status, ov.acquisition_quality,
      spc.attention_decision,
      ej.id as job_id, ej.status as job_status,
      me.id as eval_id, me.decision as eval_decision, me.quality_score, me.vetoed, me.evaluation_state
    FROM canonical_opportunities co
    JOIN opportunity_versions ov ON co.id = ov.canonical_job_id
    LEFT JOIN search_plan_candidates spc ON spc.canonical_job_id = co.id AND spc.opportunity_version = ov.id AND spc.person_id = '${personId}'
    LEFT JOIN evaluation_jobs ej ON ej.canonical_job_id = co.id AND ej.opportunity_version = ov.id AND ej.person_id = '${personId}'
    LEFT JOIN materialized_evaluations me ON me.canonical_job_id = co.id AND me.opportunity_version = ov.id AND me.person_id = '${personId}'
    WHERE co.source_job_id IN ('li-controlled-audit-001', 'nk-controlled-audit-002', 'ind-controlled-audit-003')
  `);

  console.table(rows);
}
inspectThree().catch(console.error);
