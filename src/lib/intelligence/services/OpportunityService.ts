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

}
