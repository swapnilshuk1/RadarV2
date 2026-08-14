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
    const [projection, userDecisions] = await Promise.all([
      repos.people.getLatestProjection(userId),
      repos.decisions.getUserDecisions(userId),
    ]);
    
    if (!projection) {
      console.warn(`[OpportunityService] No projection found for user: ${userId}`);
      return [];
    }
    let active = options?.activePursuits;
    if (active === undefined) {
      active = Object.values(userDecisions).filter((d) => d.verb === "PURSUE").length;
    }
    
    // Pass projection directly into the V4 Engine
    const { presented } = runEngine(projection, active);
    
    const decisionRank: Record<string, number> = { PURSUE: 0, CONSIDER: 1, SPARSE_SPEC: 2, PASS: 3 };
    
    return presented
      .map((p) => {
        const opp = { ...p.opportunity };
        if (userDecisions[opp.jobHash]) {
          opp.decision = userDecisions[opp.jobHash].verb as any;
        }
        return opp;
      })
      .sort((a, b) => {
        // P1-E: Deterministic tie-breaking for ranking
        // Primary: Decision tier (PURSUE < CONSIDER < SPARSE_SPEC < PASS)
        const tierDiff = (decisionRank[a.decision] ?? 3) - (decisionRank[b.decision] ?? 3);
        if (tierDiff !== 0) return tierDiff;

        // Secondary: Higher recommendation score first
        const scoreA = a.recommendationResult?.score ?? 0;
        const scoreB = b.recommendationResult?.score ?? 0;
        const scoreDiff = scoreB - scoreA;
        if (scoreDiff !== 0) return scoreDiff;

        // Tertiary: Same score → higher confidence first
        const confA = a.recommendationResult?.decisionConfidence?.overall ?? 0;
        const confB = b.recommendationResult?.decisionConfidence?.overall ?? 0;
        const confDiff = confB - confA;
        if (confDiff !== 0) return confDiff;

        // Quaternary: Same confidence → deterministic jobHash order
        return a.jobHash.localeCompare(b.jobHash);
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
