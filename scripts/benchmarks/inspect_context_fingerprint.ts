/**
 * scripts/benchmarks/inspect_context_fingerprint.ts
 */
import { getDatabaseAdapter } from "../../src/data/database/index";
import { resolveScope } from "../../src/lib/intelligence/opportunity-service";

async function main() {
  const db = getDatabaseAdapter();
  const personId = "ms6i7e3y-4x0chy5fy";
  const tenantId = "tenant_default";

  const scope = await resolveScope(personId, tenantId);
  console.log("Scope Active Context:", scope.activeContext);

  const evalRow = await db.one<{
    evaluation_context_fingerprint: string;
    canonical_job_id: string;
    decision: string;
    quality_score: number;
    vetoed: number;
  }>(`
    SELECT evaluation_context_fingerprint, canonical_job_id, decision, quality_score, vetoed
    FROM materialized_evaluations
    WHERE canonical_job_id IN (
      SELECT id FROM canonical_opportunities WHERE source_job_id = 'li-cmo-enterprise-001'
    )
  `);

  console.log("Materialized Evaluation Context Fingerprint:", evalRow);

  const spc = await db.one<{
    search_plan_id: string;
    canonical_job_id: string;
    opportunity_version: string;
    attention_decision: string;
  }>(`
    SELECT search_plan_id, canonical_job_id, opportunity_version, attention_decision
    FROM search_plan_candidates
    WHERE canonical_job_id IN (
      SELECT id FROM canonical_opportunities WHERE source_job_id = 'li-cmo-enterprise-001'
    ) AND person_id = '${personId}'
  `);
  console.log("Search Plan Candidate:", spc);
}

main().catch(console.error);
