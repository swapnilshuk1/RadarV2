import type { DatabaseAdapter } from "../../database/adapter";
import type { DecisionSupportStore } from "../../../domain/repositories";

export class SqliteDecisionSupportStore implements DecisionSupportStore {
  constructor(private db: DatabaseAdapter) {}

  async recordUserDecision(personId: string, opportunityId: string, action: string, reason?: string, reviewedFingerprint?: string | null, tenantId?: string): Promise<void> {
    if (!tenantId) {
      throw new Error("tenantId is strictly required for canonical decisions");
    }
    if (action !== "PURSUE" && action !== "CONSIDER" && action !== "PASS") {
      throw new Error(`INVALID_DECISION_ACTION: ${action}`);
    }
    // Compatibility callers are not allowed to supply provenance. The
    // canonical server-authorized population check derives it below.
    await this.recordAuthorizedUserDecision(personId, tenantId, opportunityId, action, reason);
  }

  /**
   * The only server-facing decision write path. It derives both the exact
   * population membership and reviewed evaluation identity from canonical
   * persistence; browser input is never trusted as provenance.
   */
  async recordAuthorizedUserDecision(
    personId: string,
    tenantId: string,
    jobHash: string,
    action: "PURSUE" | "CONSIDER" | "PASS",
    reason?: string,
  ): Promise<{ reviewedFingerprint: string | null }> {
    return this.db.transaction(async (tx) => {
      const artifact = await tx.one<{ canonical_job_id: string; evaluation_fingerprint: string | null }>(
      `SELECT spc.canonical_job_id, me.evaluation_fingerprint
       FROM active_evaluation_contexts aec
       JOIN search_plan_candidates spc
         ON spc.tenant_id = aec.tenant_id
        AND spc.person_id = aec.person_id
        AND spc.search_plan_id = aec.search_plan_id
        AND spc.attention_decision = 'CANDIDATE'
       JOIN canonical_opportunities co ON co.id = spc.canonical_job_id
       LEFT JOIN materialized_evaluations me
         ON me.tenant_id = aec.tenant_id
        AND me.person_id = aec.person_id
        AND me.canonical_job_id = spc.canonical_job_id
        AND me.opportunity_version = spc.opportunity_version
        AND me.evaluation_context_fingerprint = aec.context_fingerprint
       WHERE aec.tenant_id = ?
         AND aec.person_id = ?
         AND co.source_job_id = ?
       LIMIT 1`,
        [tenantId, personId, jobHash],
      );
      if (!artifact) {
        throw new Error(`OUT_OF_SCOPE_OPPORTUNITY: ${jobHash} is not in the authenticated canonical population.`);
      }

      const id = `${tenantId}_${personId}_${artifact.canonical_job_id}`;
      await tx.execute(
        `INSERT INTO canonical_decisions
          (id, tenant_id, person_id, canonical_job_id, action, reason, reviewed_fingerprint, updated_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(tenant_id, person_id, canonical_job_id) DO UPDATE SET
           action = EXCLUDED.action,
           reason = EXCLUDED.reason,
           reviewed_fingerprint = EXCLUDED.reviewed_fingerprint,
           updated_at = CURRENT_TIMESTAMP`,
        [id, tenantId, personId, artifact.canonical_job_id, action, reason || null, artifact.evaluation_fingerprint],
      );
      return { reviewedFingerprint: artifact.evaluation_fingerprint };
    });
  }

  async getUserDecisions(personId: string, tenantId?: string): Promise<Record<string, { verb: string; updatedAt?: string; reviewedFingerprint?: string | null }>> {
    if (!tenantId) {
       throw new Error("tenantId is strictly required for canonical decisions");
    }
    
    const rows = await this.db.many<{ source_job_id: string; action: string; updated_at: string; reviewed_fingerprint?: string | null }>(
      `SELECT co.source_job_id, cd.action, cd.updated_at, cd.reviewed_fingerprint 
       FROM canonical_decisions cd
       JOIN canonical_opportunities co ON cd.canonical_job_id = co.id
       WHERE cd.person_id = ? AND cd.tenant_id = ?`,
      [personId, tenantId]
    );

    const result: Record<string, { verb: string; updatedAt?: string; reviewedFingerprint?: string | null }> = {};
    for (const row of rows) {
      result[row.source_job_id] = {
        verb: row.action,
        updatedAt: row.updated_at,
        reviewedFingerprint: row.reviewed_fingerprint || null
      };
    }
    return result;
  }

  async deleteUserDecision(personId: string, opportunityId: string, tenantId?: string): Promise<void> {
    if (!tenantId) {
      throw new Error("tenantId is strictly required for canonical decisions");
    }
    
    // Resolve canonical_job_id from opportunityId (source_job_id)
    const canonical = await this.db.one<{ id: string }>(
      `SELECT id FROM canonical_opportunities WHERE source_job_id = ?`,
      [opportunityId]
    );
    if (!canonical) return;

    await this.db.execute(
      `DELETE FROM canonical_decisions WHERE tenant_id = ? AND person_id = ? AND canonical_job_id = ?`,
      [tenantId, personId, canonical.id]
    );
  }

  async clearUserDecisions(personId: string, tenantId?: string): Promise<void> {
    if (!tenantId) {
      throw new Error("tenantId is strictly required for canonical decisions");
    }
    await this.db.execute(
      `DELETE FROM canonical_decisions WHERE tenant_id = ? AND person_id = ?`,
      [tenantId, personId]
    );
  }
}
