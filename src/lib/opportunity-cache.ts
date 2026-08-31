/**
 * src/lib/opportunity-cache.ts
 *
 * RADAR v2 — Phase 12 Client Opportunity Cache Integration.
 *
 * Client-side memory cache for served opportunity dossiers and navigation contexts.
 * Enables instant 0ms navigation between Shortlist/Queue views and Opportunity details.
 */

import { type ServedOpportunity } from "../data/opportunity-fixtures";

export interface OpportunityDetailsDTO {
  opportunity: ServedOpportunity;
  currentIndex: number;
  totalCount: number;
  neighbors: {
    prev?: string | ServedOpportunity;
    next?: string | ServedOpportunity;
  };
}

export class ClientOpportunityCache {
  private static dossierMap = new Map<string, OpportunityDetailsDTO>();

  /**
   * Caches a single evaluated opportunity dossier with its navigation context.
   */
  public static setDetails(jobHash: string, details: OpportunityDetailsDTO): void {
    if (jobHash && details?.opportunity) {
      this.dossierMap.set(jobHash, details);
    }
  }

  /**
   * Retrieves opportunity details directly from client memory if available.
   */
  public static getDetails(jobHash: string): OpportunityDetailsDTO | null {
    return this.dossierMap.get(jobHash) || null;
  }

  /**
   * Legacy compatibility helper.
   */
  public static setList(list: ServedOpportunity[]): void {
    if (Array.isArray(list)) {
      for (let i = 0; i < list.length; i++) {
        const opp = list[i];
        if (opp?.jobHash) {
          this.setDetails(opp.jobHash, {
            opportunity: opp,
            currentIndex: i + 1,
            totalCount: list.length,
            neighbors: {
              prev: i > 0 ? list[i - 1].jobHash : undefined,
              next: i < list.length - 1 ? list[i + 1].jobHash : undefined,
            },
          });
        }
      }
    }
  }

  /**
   * Clears client cache if needed (e.g. on logout or user decision resets).
   */
  public static clear(): void {
    this.dossierMap.clear();
  }
}
