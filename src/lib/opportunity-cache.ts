/**
 * ClientOpportunityCache
 * In-memory client-side cache store for evaluated opportunity DTOs.
 * Enables zero-RPC client-side navigation between Shortlist/Queue views and Opportunity details.
 */

import { type ServedOpportunity } from "../data/opportunity-fixtures";

export interface OpportunityDetailsDTO {
  opportunity: ServedOpportunity;
  currentIndex: number;
  totalCount: number;
  neighbors: {
    prev?: ServedOpportunity;
    next?: ServedOpportunity;
  };
}

export class ClientOpportunityCache {
  private static list: ServedOpportunity[] | null = null;

  /**
   * Hydrates the client-side opportunity list.
   */
  public static setList(list: ServedOpportunity[]) {
    if (Array.isArray(list) && list.length > 0) {
      this.list = list;
    }
  }

  /**
   * Retrieves opportunity details directly from client memory if available.
   * Returns null if not cached or if running on server during SSR.
   */
  public static getDetails(jobHash: string): OpportunityDetailsDTO | null {
    if (!this.list || this.list.length === 0) {
      return null;
    }

    const index = this.list.findIndex((o) => o.jobHash === jobHash || o.jobHash === jobHash);
    if (index < 0) return null;

    const opportunity = this.list[index];
    return {
      opportunity,
      currentIndex: index + 1,
      totalCount: this.list.length,
      neighbors: {
        prev: index > 0 ? this.list[index - 1] : undefined,
        next: index < this.list.length - 1 ? this.list[index + 1] : undefined,
      },
    };
  }

  /**
   * Clears client cache if needed (e.g. on logout or user decision resets).
   */
  public static clear() {
    this.list = null;
  }
}
