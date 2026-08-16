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
  /** List all opportunity DTOs for a specific user via O(k) materialized evaluations query. */
  static async listForUser(userId: string, options?: ServiceOptions): Promise<Opportunity[]> {
    const repos = getRepositories();

    // 1. Fetch materialized candidate evaluations O(k)
    const [evaluations, userDecisions] = await Promise.all([
      repos.evaluations.listEvaluationsForUser(userId, 100),
      repos.decisions.getUserDecisions(userId),
    ]);

    // 2. If pre-computed evaluations exist, return directly (O(k) fast path)
    if (evaluations.length > 0) {
      return evaluations
        .map((ev) => {
          let opp: Opportunity;
          try {
            opp = JSON.parse(ev.evaluationJson);
          } catch {
            return null;
          }

          const rawUser = userDecisions[ev.jobHash];
          const userState: UserDecisionStateV4 | null = rawUser ? {
            personId: userId,
            jobHash: ev.jobHash,
            userAction: rawUser.verb as any,
            reviewedFingerprint: (rawUser as any).reviewedFingerprint || null,
            updatedAt: rawUser.updatedAt || null,
          } : (ev.userDecisionOverride ? {
            personId: userId,
            jobHash: ev.jobHash,
            userAction: ev.userDecisionOverride as any,
            reviewedFingerprint: null,
            updatedAt: ev.updatedAt || null,
          } : null);

          const effectiveDecision = ev.effectiveDecision as any;
          return {
            ...opp,
            userDecision: userState,
            effectiveDecision: computeEffectiveDecision(opp.engineRecommendation || ({} as any), userState),
            reviewWorkflowState: computeReviewWorkflowState(opp.engineRecommendation || ({} as any), userState),
            decision: userState?.userAction ? userState.userAction : ev.effectiveDecision,
          } as Opportunity;
        })
        .filter((o): o is Opportunity => o !== null)
        .sort((a, b) => {
          const tierA = POPULATION_TIER_ORDER[a.effectiveDecision || "ENGINE_PASS"] ?? 5;
          const tierB = POPULATION_TIER_ORDER[b.effectiveDecision || "ENGINE_PASS"] ?? 5;
          if (tierA !== tierB) return tierA - tierB;

          const scoreA = a.engineRecommendation?.qualityScore ?? a.recommendationResult?.score ?? null;
          const scoreB = b.engineRecommendation?.qualityScore ?? b.recommendationResult?.score ?? null;

          if (scoreA !== null && scoreB !== null) {
            const scoreDiff = scoreB - scoreA;
            if (scoreDiff !== 0) return scoreDiff;
          } else if (scoreA !== null && scoreB === null) {
            return -1;
          } else if (scoreA === null && scoreB !== null) {
            return 1;
          }
          return a.jobHash.localeCompare(b.jobHash);
        });
    }

    // 3. Fallback for un-materialized initial state: compute once and persist to candidate_evaluations
    const [projection, oppSources] = await Promise.all([
      repos.people.getLatestProjection(userId),
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

    const { presented } = runEngine(projection, active, oppSources);
    const results: Opportunity[] = [];

    for (const p of presented) {
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
        decision: userState?.userAction ? (userState.userAction as any) : (engineRec.engineVerdict as any),
      };

      results.push(opp);

      // Persist materialized evaluation for O(k) future requests
      const engineVerdict = (["PURSUE", "CONSIDER", "PASS"].includes(engineRec.engineVerdict)
        ? engineRec.engineVerdict
        : "CONSIDER") as "PURSUE" | "CONSIDER" | "PASS";

      repos.evaluations.saveEvaluation({
        personId: userId,
        jobHash: opp.jobHash,
        policyVersion: engineRec.evaluationFingerprint || "v4.1",
        evaluationInputHash: "eval_hash_initial",
        engineVerdict,
        engineQualityScore: engineRec.qualityScore || 70.0,
        userDecisionOverride: userState?.userAction as any,
        effectiveDecision: engineVerdict,
        qualityScore: engineRec.qualityScore || 70.0,
        evaluationStatus: "COMPLETE",
        evaluationJson: JSON.stringify(opp),
      }).catch(() => {});
    }

    return results.sort((a, b) => {
      const tierA = POPULATION_TIER_ORDER[a.effectiveDecision || "ENGINE_PASS"] ?? 5;
      const tierB = POPULATION_TIER_ORDER[b.effectiveDecision || "ENGINE_PASS"] ?? 5;
      if (tierA !== tierB) return tierA - tierB;
      const scoreA = a.engineRecommendation?.qualityScore ?? a.recommendationResult?.score ?? null;
      const scoreB = b.engineRecommendation?.qualityScore ?? b.recommendationResult?.score ?? null;
      if (scoreA !== null && scoreB !== null) {
        const scoreDiff = scoreB - scoreA;
        if (scoreDiff !== 0) return scoreDiff;
      } else if (scoreA !== null && scoreB === null) return -1;
      else if (scoreA === null && scoreB !== null) return 1;
      return a.jobHash.localeCompare(b.jobHash);
    });
  }

  /** Get a single computed opportunity DTO by hash for a specific user. */
  static async getForUser(userId: string, jobHash: string, options?: ServiceOptions): Promise<Opportunity | undefined> {
    const repos = getRepositories();

    // 1. Check materialized evaluations O(1)
    const ev = await repos.evaluations.getEvaluation(userId, jobHash);
    if (ev) {
      try {
        const opp = JSON.parse(ev.evaluationJson);
        const userDecisions = await repos.decisions.getUserDecisions(userId);
        const rawUser = userDecisions[jobHash];
        const userState = rawUser ? {
          personId: userId,
          jobHash,
          userAction: rawUser.verb as any,
          reviewedFingerprint: (rawUser as any).reviewedFingerprint || null,
          updatedAt: rawUser.updatedAt || null,
        } : null;
        return {
          ...opp,
          userDecision: userState,
          effectiveDecision: computeEffectiveDecision(opp.engineRecommendation || ({} as any), userState),
          decision: userState?.userAction ? userState.userAction : ev.effectiveDecision,
        };
      } catch {}
    }

    // 2. Strict Boundary: Deferred single-item fallback (NEVER evaluates whole corpus)
    return this.evaluateSingleOpportunity(userId, jobHash);
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

  /** Evaluates a single candidate-opportunity pair directly via V4 engines without corpus-wide evaluation. */
  static async evaluateSingleOpportunity(userId: string, jobHash: string): Promise<any | undefined> {
    const repos = getRepositories();
    const [projection, oppSource] = await Promise.all([
      repos.people.getLatestProjection(userId),
      repos.opportunities.getOpportunitySource(jobHash),
    ]);
    if (!projection || !oppSource) return undefined;
    const single = runEngineSingle(jobHash, projection, 0, [oppSource]);
    return single?.opportunity;
  }
}
