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

  async recordUserDecision(personId: string, opportunityId: string, action: string, reason?: string, reviewedFingerprint?: string | null): Promise<void> {
    const id = `${personId}_${opportunityId}`;
    await this.db.execute(
      `INSERT INTO decisions (id, person_id, opportunity_id, action, reason, reviewed_fingerprint, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(person_id, opportunity_id) DO UPDATE SET
         action = EXCLUDED.action,
         reason = EXCLUDED.reason,
         reviewed_fingerprint = EXCLUDED.reviewed_fingerprint,
         updated_at = CURRENT_TIMESTAMP`,
      [id, personId, opportunityId, action, reason || null, reviewedFingerprint || null]
    );
  }

  async getUserDecisions(personId: string): Promise<Record<string, { verb: string; updatedAt?: string; reviewedFingerprint?: string | null }>> {
    const rows = await this.db.many<{ opportunity_id: string; action: string; updated_at: string; reviewed_fingerprint?: string | null }>(
      `SELECT opportunity_id, action, updated_at, reviewed_fingerprint FROM decisions WHERE person_id = ?`,
      [personId]
    );

    const result: Record<string, { verb: string; updatedAt?: string; reviewedFingerprint?: string | null }> = {};
    for (const row of rows) {
      result[row.opportunity_id] = {
        verb: row.action,
        updatedAt: row.updated_at,
        reviewedFingerprint: row.reviewed_fingerprint || null
      };
    }
    return result;
  }

  async deleteUserDecision(personId: string, opportunityId: string): Promise<void> {
    await this.db.execute(
      `DELETE FROM decisions WHERE person_id = ? AND opportunity_id = ?`,
      [personId, opportunityId]
    );
  }

  async clearUserDecisions(personId: string): Promise<void> {
    await this.db.execute(
      `DELETE FROM decisions WHERE person_id = ?`,
      [personId]
    );
  }
}
