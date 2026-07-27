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
}
