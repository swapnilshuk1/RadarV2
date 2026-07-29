import { getRepositories } from "../../../data/sqlite/provider";
import type { StorageProvider } from "../../../domain/repositories";
import type { Opportunity } from "../../../domain/entities";

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
  public async getActiveOpportunities(): Promise<Opportunity[]> {
    const opps = await this.repos.opportunities.listActiveOpportunities();
    return opps.filter(
      opp => opp.lifecycle === "Normalized" || opp.lifecycle === "Verified"
    );
  }

  /**
   * Generates the "Explain" trace for an opportunity.
   */
  public async explainOpportunity(opportunityId: string, personId: string): Promise<any> {
    // 1. Fetch Recommendation Record
    const record = await this.repos.decisions.getRecommendationRecordForOpportunity(personId, opportunityId);
    if (!record) return null;

    // 2. Fetch Claims
    const allClaims = await this.repos.reasoning.findClaimsForOpportunity(opportunityId);

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
