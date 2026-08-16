import { getRepositories } from "../../data/sqlite/provider";
import { runEngine, runEngineSingle, addExtraOpportunities, injectFreshRecords } from "./engine";
import type { Opportunity } from "@/data/opportunity-fixtures";
import {
  computeEffectiveDecision,
  computeReviewWorkflowState,
  type EngineRecommendationV4,
  type UserDecisionStateV4,
  type EffectiveDecision,
} from "../../domain/decision_v4";

export type ServiceOptions = {
  activePursuits?: number;
};

const POPULATION_TIER_ORDER: Record<EffectiveDecision, number> = {
  ENGINE_PURSUIT: 0,
  USER_CONFIRMED: 0,
  PREFERENCE_OVERRIDE: 1,
  VETO_OVERRIDE: 2,
  ENGINE_CONSIDER: 3,
  NOT_EVALUABLE: 4,
  USER_PASSED: 5,
  ENGINE_PASS: 5,
};

export class OpportunityService {
  /** List all dynamically computed opportunity DTOs for a specific user, sorted by Homogeneous Population Tiers. */
  static async listForUser(userId: string, options?: ServiceOptions): Promise<Opportunity[]> {
    const repos = getRepositories();
    const [projection, userDecisions, oppSources] = await Promise.all([
      repos.people.getLatestProjection(userId),
      repos.decisions.getUserDecisions(userId),
      repos.opportunities.listOpportunitySources(),
    ]);
    
    if (!projection) {
      console.warn(`[OpportunityService] No projection found for user: ${userId}`);
      return [];
    }
    let active = options?.activePursuits;
    if (active === undefined) {
      active = Object.values(userDecisions).filter((d) => d.verb === "PURSUE").length;
    }
    
    // Pass projection and canonical opportunities directly into the V4 Engine
    const { presented } = runEngine(projection, active, oppSources);
    
    return presented
      .map((p) => {
        const rawUser = userDecisions[p.opportunity.jobHash];
        const engineRec: EngineRecommendationV4 = p.opportunity.engineRecommendation || {
          jobHash: p.opportunity.jobHash,
          evaluationFingerprint: p.record.recommendationVersion,
          engineVerdict: p.record.verb as any,
          vetoed: Boolean(p.record.vetoed),
          vetoReason: p.record.vetoReason || null,
          qualityScore: p.record.vetoed ? null : (p.record.qualityScore !== null && p.record.qualityScore !== undefined ? Math.round(p.record.qualityScore) : null),
          parsingConfidence: p.record.confidences?.parsing ?? (p.record.confidence ?? 0.8),
          evaluatedAt: new Date().toISOString(),
        };

        const userState: UserDecisionStateV4 | null = rawUser ? {
          personId: userId,
          jobHash: p.opportunity.jobHash,
          userAction: rawUser.verb as any,
          reviewedFingerprint: (rawUser as any).reviewedFingerprint || null,
          updatedAt: rawUser.updatedAt || null,
        } : null;

        const effectiveDecision = computeEffectiveDecision(engineRec, userState);
        const reviewWorkflowState = computeReviewWorkflowState(engineRec, userState);

        const opp: Opportunity = {
          ...p.opportunity,
          engineRecommendation: engineRec,
          userDecision: userState,
          effectiveDecision,
          reviewWorkflowState,
          // Legacy presentation compatibility verb for active UI tabs (PURSUE / CONSIDER / PASS / SPARSE_SPEC)
          decision: userState?.userAction
            ? (userState.userAction as any)
            : (engineRec.engineVerdict as any),
        };

        return opp;
      })
      .sort((a, b) => {
        // 1. Primary: Homogeneous Population Tier
        const tierA = POPULATION_TIER_ORDER[a.effectiveDecision || "ENGINE_PASS"] ?? 5;
        const tierB = POPULATION_TIER_ORDER[b.effectiveDecision || "ENGINE_PASS"] ?? 5;
        if (tierA !== tierB) return tierA - tierB;

        // 2. Secondary: Intra-tier rank by numeric qualityScore (DESC)
        // INVARIANT: null scores are NEVER coerced to 0 (no `?? 0` or `|| 0`).
        const scoreA = a.engineRecommendation?.qualityScore ?? a.recommendationResult?.score ?? null;
        const scoreB = b.engineRecommendation?.qualityScore ?? b.recommendationResult?.score ?? null;

        if (scoreA !== null && scoreB !== null) {
          const scoreDiff = scoreB - scoreA;
          if (scoreDiff !== 0) return scoreDiff;
        } else if (scoreA !== null && scoreB === null) {
          return -1; // Evaluated score ranks above null score
        } else if (scoreA === null && scoreB !== null) {
          return 1;  // Null score ranks below evaluated score
        }

        // 3. Quaternary: Deterministic jobHash order (confidence is NOT used for fit ranking)
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
    const [projection, userDecisions, oppSource] = await Promise.all([
      repos.people.getLatestProjection(userId),
      repos.decisions.getUserDecisions(userId),
      repos.opportunities.getOpportunitySource(jobHash),
    ]);
    
    if (!projection || !oppSource) return undefined;

    let active = options?.activePursuits;
    if (active === undefined) {
      active = Object.values(userDecisions).filter((d) => d.verb === "PURSUE").length;
    }
    const presentedSingle = runEngineSingle(jobHash, projection, active, [oppSource]);
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
