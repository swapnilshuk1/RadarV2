import type { DatabaseAdapter } from "@/data/database";
import { evaluateAttentionGate } from "@/lib/intelligence/AttentionGate";
import type { OpportunityVersion, SearchPlanCandidate } from "@/lib/domain/canonical_acquisition";
import type { SearchPlan } from "@/lib/domain/evaluation_context";

export class AttentionService {
  constructor(private db: DatabaseAdapter) {}

  async processAttentionGate(
    version: OpportunityVersion,
    plan: SearchPlan
  ): Promise<SearchPlanCandidate> {
    const result = evaluateAttentionGate(version, plan.criteria);

    const candidate: SearchPlanCandidate = {
      tenantId: plan.tenantId,
      personId: plan.personId,
      searchPlanId: plan.id,
      canonicalJobId: version.canonicalJobId,
      opportunityVersion: version.id,
      attentionDecision: result.decision,
      createdAt: new Date().toISOString()
    };

    const sql = "INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version) DO UPDATE SET attention_decision = excluded.attention_decision, created_at = CURRENT_TIMESTAMP";

    await this.db.execute(sql, [
      candidate.tenantId,
      candidate.personId,
      candidate.searchPlanId,
      candidate.canonicalJobId,
      candidate.opportunityVersion,
      candidate.attentionDecision
    ]);

    return candidate;
  }
}