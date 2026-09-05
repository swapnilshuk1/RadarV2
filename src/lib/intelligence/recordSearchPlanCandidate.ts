/**
 * recordSearchPlanCandidate.ts
 * Shadow-Mode SearchPlanCandidate Projection for Phase M4.4.
 */
import { DatabaseAdapter } from "@/data/database";
import { CanonicalOpportunity, OpportunityVersion, AttentionDecision } from "@/lib/domain/canonical_acquisition";
import crypto from "node:crypto";
import { classifyOpportunityCategories } from "@/lib/domain/category_taxonomy";

export async function recordSearchPlanCandidate(adapter: DatabaseAdapter, tenantId: string, personId: string, planId: string, opp: CanonicalOpportunity, ver: OpportunityVersion, decision: AttentionDecision): Promise<void> {
  await adapter.transaction(async (tx: DatabaseAdapter) => {
    await tx.execute(`
      INSERT OR IGNORE INTO canonical_opportunities 
      (id, source, source_job_id, canonical_url)
      VALUES (?, ?, ?, ?)
    `, [opp.id, opp.source, opp.sourceJobId, opp.canonicalUrl]);

    await tx.execute(`
      INSERT OR IGNORE INTO opportunity_versions 
      (id, canonical_job_id, content_hash, job_title, company_name, location, employment_type, raw_content, category_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      ver.id, ver.canonicalJobId, ver.contentHash, ver.jobTitle, ver.companyName, ver.location, ver.employmentType, ver.rawContent,
      JSON.stringify(classifyOpportunityCategories({ role: ver.jobTitle, description: ver.rawContent })),
    ]);

    await tx.execute(`
      INSERT INTO search_plan_candidates 
      (search_plan_id, tenant_id, person_id, canonical_job_id, opportunity_version, attention_decision)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version)
      DO UPDATE SET attention_decision=EXCLUDED.attention_decision;
    `, [planId, tenantId, personId, opp.id, ver.id, decision]);
  });
}
