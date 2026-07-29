import { getRepositories } from "../../data/sqlite/provider";
import { runEngine, runEngineSingle, addExtraOpportunities, injectFreshRecords } from "./engine";
import type { Opportunity } from "@/data/opportunity-fixtures";

export type ServiceOptions = {
  activePursuits?: number;
};

export class OpportunityService {
  /** List all dynamically computed opportunity DTOs for a specific user, sorted by Pursuit Potential. */
  static async listForUser(userId: string, options?: ServiceOptions): Promise<Opportunity[]> {
    const repos = getRepositories();
    const projection = await repos.people.getLatestProjection(userId);
    
    if (!projection) {
      console.warn(`[OpportunityService] No projection found for user: ${userId}`);
      return [];
    }

    let active = options?.activePursuits;
    if (active === undefined) {
      const userDecisions = await repos.decisions.getUserDecisions(userId);
      active = Object.values(userDecisions).filter((d) => d.verb === "PURSUE").length;
    }
    
    // Pass projection directly into the V4 Engine
    const { presented } = runEngine(projection, active);
    
    const decisionRank: Record<string, number> = { PURSUE: 0, CONSIDER: 1, PASS: 2 };
    
    return presented
      .map((p) => p.opportunity)
      .filter((o) => o.decision !== "PASS")
      .sort((a, b) => {
        const tierDiff = (decisionRank[a.decision] ?? 3) - (decisionRank[b.decision] ?? 3);
        if (tierDiff !== 0) return tierDiff;
        return (b.recommendationResult?.score ?? 0) - (a.recommendationResult?.score ?? 0);
      });
  }

  /** Get a single computed opportunity DTO by hash for a specific user. */
  static async getForUser(userId: string, jobHash: string, options?: ServiceOptions): Promise<Opportunity | undefined> {
    const opportunities = await this.listForUser(userId, options);
    const found = opportunities.find((o) => o.jobHash === jobHash);
    if (found) return found;

    // Lazy fallback
    const repos = getRepositories();
    const projection = await repos.people.getLatestProjection(userId);
    
    if (!projection) return undefined;

    let active = options?.activePursuits;
    if (active === undefined) {
      const userDecisions = await repos.decisions.getUserDecisions(userId);
      active = Object.values(userDecisions).filter((d) => d.verb === "PURSUE").length;
    }
    const presentedSingle = runEngineSingle(jobHash, projection, active);
    return presentedSingle?.opportunity;
  }

  /** Get neighbors (prev/next DTOs) of an opportunity. */
  static async neighboursForUser(
    userId: string,
    jobHash: string,
    options?: ServiceOptions,
  ): Promise<{ prev: Opportunity | undefined; next: Opportunity | undefined }> {
    const opportunities = await this.listForUser(userId, options);
    const i = opportunities.findIndex((o) => o.jobHash === jobHash);
    if (i === -1) return { prev: undefined, next: undefined };
    return {
      prev: i > 0 ? opportunities[i - 1] : undefined,
      next: i < opportunities.length - 1 ? opportunities[i + 1] : undefined,
    };
  }

  /** Add newly extracted opportunities (mock data fallback). */
  static addExtra(): void {
    addExtraOpportunities();
  }

  /** Inject fresh scraped records from the server into the UI. */
  static injectFresh(records: any[]): void {
    injectFreshRecords(records);
  }
}
