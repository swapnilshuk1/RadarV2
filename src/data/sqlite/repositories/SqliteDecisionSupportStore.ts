import type { DatabaseAdapter } from "../../database/adapter";
import type { DecisionSupportStore } from "../../../domain/repositories";
import type { RecommendationRun, OpportunityAssessment, RecommendationRecord } from "../../../domain/entities";

export class SqliteDecisionSupportStore implements DecisionSupportStore {
  constructor(private db: DatabaseAdapter) {}

  async recordRecommendationRun(run: RecommendationRun): Promise<void> {
    throw new Error("Method not implemented.");
  }
  
  async getRecommendationRun(id: string): Promise<RecommendationRun | undefined> {
    throw new Error("Method not implemented.");
  }
  
  async recordOpportunityAssessment(assessment: OpportunityAssessment): Promise<void> {
    throw new Error("Method not implemented.");
  }
  
  async getOpportunityAssessment(id: string): Promise<OpportunityAssessment | undefined> {
    throw new Error("Method not implemented.");
  }
  
  async recordRecommendationRecord(record: RecommendationRecord): Promise<void> {
    throw new Error("Method not implemented.");
  }
  
  async latestRecommendationRecords(personId: string, limit: number): Promise<RecommendationRecord[]> {
    throw new Error("Method not implemented.");
  }
  
  async getRecommendationRecordForOpportunity(personId: string, opportunityId: string): Promise<RecommendationRecord | undefined> {
    throw new Error("Method not implemented.");
  }

  async recordUserDecision(personId: string, opportunityId: string, action: string, reason?: string, reviewedFingerprint?: string | null, tenantId?: string): Promise<void> {
    if (!tenantId) {
      throw new Error("tenantId is strictly required for canonical decisions");
    }
    
    // Resolve canonical_job_id from opportunityId (which is source_job_id/jobHash)
    const canonical = await this.db.one<{ id: string }>(
      `SELECT id FROM canonical_opportunities WHERE source_job_id = ?`,
      [opportunityId]
    );
    
    if (!canonical) {
      console.warn(`[SqliteDecisionSupportStore] Could not resolve canonical_job_id for source_job_id=${opportunityId}`);
      return;
    }
    
    const canonicalJobId = canonical.id;
    const id = `${tenantId}_${personId}_${canonicalJobId}`;
    
    await this.db.execute(
      `INSERT INTO canonical_decisions (id, tenant_id, person_id, canonical_job_id, action, reason, reviewed_fingerprint, updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(tenant_id, person_id, canonical_job_id) DO UPDATE SET
         action = EXCLUDED.action,
         reason = EXCLUDED.reason,
         reviewed_fingerprint = EXCLUDED.reviewed_fingerprint,
         updated_at = CURRENT_TIMESTAMP`,
      [id, tenantId, personId, canonicalJobId, action, reason || null, reviewedFingerprint || null]
    );
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
