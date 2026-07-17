import type { Database } from "better-sqlite3";
import type { DecisionSupportStore } from "../../../domain/repositories";
import type { RecommendationRun, OpportunityAssessment, RecommendationRecord } from "../../../domain/entities";

export class SqliteDecisionSupportStore implements DecisionSupportStore {
  constructor(private db: Database) {}

  recordRecommendationRun(run: RecommendationRun): void {
    throw new Error("Method not implemented.");
  }
  
  getRecommendationRun(id: string): RecommendationRun | undefined {
    throw new Error("Method not implemented.");
  }
  
  recordOpportunityAssessment(assessment: OpportunityAssessment): void {
    throw new Error("Method not implemented.");
  }
  
  getOpportunityAssessment(id: string): OpportunityAssessment | undefined {
    throw new Error("Method not implemented.");
  }
  
  recordRecommendationRecord(record: RecommendationRecord): void {
    throw new Error("Method not implemented.");
  }
  
  latestRecommendationRecords(personId: string, limit: number): RecommendationRecord[] {
    throw new Error("Method not implemented.");
  }
  
  getRecommendationRecordForOpportunity(personId: string, opportunityId: string): RecommendationRecord | undefined {
    throw new Error("Method not implemented.");
  }
}
