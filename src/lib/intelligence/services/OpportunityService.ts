import { getRepositories } from "../../../data/sqlite/provider";
import type { StorageProvider } from "../../../domain/repositories";
import type { Opportunity, Source, Document, Fact, Claim, RecommendationRecord, OpportunityAssessment } from "../../../domain/entities";

/**
 * Application Service Layer: OpportunityService
 * Orchestrates business logic related to opportunities.
 * Repositories persist entities. Services orchestrate workflows.
 */
export class OpportunityService {
  private repos: StorageProvider;

  constructor() {
    this.repos = getRepositories();
  }

  /**
   * Retrieves all active opportunities that are ready for presentation to a candidate.
   * This handles the business logic of filtering out archived or raw discovered opportunities.
   */
  public getActiveOpportunities(): Opportunity[] {
    // Only return Normalized or Verified opportunities
    return this.repos.opportunities.listActiveOpportunities().filter(
      opp => opp.lifecycle === "Normalized" || opp.lifecycle === "Verified"
    );
  }

  /**
   * Generates the "Explain" trace for an opportunity.
   */
  public explainOpportunity(opportunityId: string, personId: string): any {
    // 1. Fetch Recommendation Record
    const record = this.repos.decisions.getRecommendationRecordForOpportunity(personId, opportunityId);
    if (!record) return null;

    // 2. Fetch Assessment
    // Since record doesn't point to assessment directly, we'd need a lookup or just return record.
    // For now, let's just return the new record.
    
    // 3. Fetch Claims
    const allClaims = this.repos.reasoning.findClaimsForOpportunity(opportunityId);

    // Provide a richly nested view for the UI Graph Visualization
    const enrichedClaims = allClaims.map(claim => {
      return {
        ...claim,
        _debug: { inferences: claim.inferenceIds }
      };
    });

    return {
      opportunityId,
      personId,
      record,
      claims: enrichedClaims
    };
  }
}
