import { getRepositories } from "../../data/sqlite/provider";
import { getDatabaseAdapter } from "../../data/database";
import { runEngine, runEngineSingle, addExtraOpportunities, injectFreshRecords } from "./engine";
import type { Opportunity } from "@/data/opportunity-fixtures";
import {
  computeEffectiveDecision,
  computeReviewWorkflowState,
  type EngineRecommendationV4,
  type UserDecisionStateV4,
  type EffectiveDecision,
} from "../../domain/decision_v4";
import {
  MetricIntegrityValidator,
  type CanonicalOpportunityMetrics,
} from "./metric-integrity";
import {
  serveEvaluation,
  adaptLegacyEvaluation,
  isCanonicalIntrinsicEvaluation,
  type CandidateServingContext,
  type CanonicalIntrinsicEvaluationPayload,
} from "./serving/EvaluationServingEngine";
import { computeIntrinsicFingerprint } from "./fingerprint/EvaluationFingerprint";

export type ServiceOptions = {
  activePursuits?: number;
  categoryId?: string;
};

export interface OpportunityMetrics {
  totalScreened: number;
  activePursuits: number;
  totalShortlisted: number;
  totalDecisions: number;
  remainingToReview: number;
  breakdown: {
    pursue: number;
    consider: number;
    pass: number;
    sparse: number;
  };
}

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

let _workerStarted = false;
function ensureWorkerDaemonStarted() {
  if (_workerStarted || typeof window !== "undefined" || process.env.NODE_ENV === "test") return;
  _workerStarted = true;
  import("./workers/EvaluationWorker").then(({ EvaluationWorker }) => {
    EvaluationWorker.startDaemon(2000);
  }).catch(() => {});
}

export class OpportunityService {
  /** Computes global aggregate metrics across the full candidate evaluation population with canonical integrity validation. */
  static async getMetricsForUser(userId: string): Promise<CanonicalOpportunityMetrics> {
    const repos = getRepositories();
    const [evalMetrics, userDecisions, categoryMetrics] = await Promise.all([
      repos.evaluations.getEvaluationMetrics(userId),
      repos.decisions.getUserDecisions(userId),
      repos.evaluations.getCategoryMetrics(userId),
    ]);

    const explicitDecisionsCount = Object.keys(userDecisions).length;
    const remainingToReview = Math.max(0, evalMetrics.totalScreened - explicitDecisionsCount);

    const userBreakdownCount = {
      pursue: 0,
      consider: 0,
      pass: 0,
      total: explicitDecisionsCount,
    };

    for (const d of Object.values(userDecisions)) {
      if (d.verb === "PURSUE") userBreakdownCount.pursue++;
      else if (d.verb === "CONSIDER") userBreakdownCount.consider++;
      else if (d.verb === "PASS") userBreakdownCount.pass++;
    }

    const generatedAt = new Date().toISOString();
    const snapshotId = `snap_${userId}_${Date.now()}`;

    const canonicalMetricsPartial: Omit<CanonicalOpportunityMetrics, "integrity"> = {
      personId: userId,
      snapshotId,
      generatedAt,
      evaluationVersion: "v4.1",
      totalScreened: evalMetrics.totalScreened,
      activePursuits: evalMetrics.activePursuits,
      totalShortlisted: evalMetrics.shortlistedCount,
      totalDecisions: explicitDecisionsCount,
      remainingToReview,
      engineBreakdown: {
        pursue: evalMetrics.pursueCount,
        consider: evalMetrics.considerCount,
        pass: evalMetrics.passCount,
        sparse: evalMetrics.sparseCount,
      },
      userBreakdown: userBreakdownCount,
      effectiveBreakdown: {
        pursue: evalMetrics.activePursuits,
        consider: Math.max(0, evalMetrics.shortlistedCount - evalMetrics.activePursuits),
        pass: Math.max(0, evalMetrics.totalScreened - evalMetrics.shortlistedCount),
        sparse: evalMetrics.sparseCount,
      },
      categoryMetrics,
    };

    // Fast Page Load Invariant: Perform validation synchronously with lightweight queries
    // or return snapshot immediately while triggering background integrity verification
    const db = getDatabaseAdapter();
    const integrity = await MetricIntegrityValidator.validate(canonicalMetricsPartial, db);

    return {
      ...canonicalMetricsPartial,
      integrity,
    };
  }

  /** Hydrates exact opportunity DTOs for user decisions independent of feed rank bounds. */
  static async listDecidedForUser(userId: string): Promise<Opportunity[]> {
    const repos = getRepositories();
    const [userDecisions, projection, sourceMap] = await Promise.all([
      repos.decisions.getUserDecisions(userId),
      repos.people.getLatestProjection(userId),
      repos.opportunities.getOpportunitySourcesMap(),
    ]);
    const jobHashes = Object.keys(userDecisions);
    if (jobHashes.length === 0) return [];

    const activePursuits = Object.values(userDecisions).filter((d) => d.verb === "PURSUE").length;
    const attentionWindow = projection?.attentionWindow ?? 6;
    const candCtx: CandidateServingContext = {
      personId: userId,
      attentionWindow,
      activePursuits,
    };

    const evaluations = await repos.evaluations.getEvaluationsByJobHashes(userId, jobHashes);
    return evaluations
      .map((ev) => {
        try {
          const rawParsed = JSON.parse(ev.evaluationJson);
          const rawUser = userDecisions[ev.jobHash];
          const userState: UserDecisionStateV4 | null = rawUser ? {
            personId: userId,
            jobHash: ev.jobHash,
            userAction: rawUser.verb as any,
            reviewedFingerprint: (rawUser as any).reviewedFingerprint || null,
            updatedAt: rawUser.updatedAt || null,
          } : null;

          const oppSource = sourceMap.get(ev.jobHash) || {
            jobHash: ev.jobHash,
            role: "Executive Opportunity",
            company: "Executive Firm",
            location: "Remote",
          };

          if (isCanonicalIntrinsicEvaluation(rawParsed)) {
            return serveEvaluation(rawParsed, candCtx, oppSource, userState);
          }
          return adaptLegacyEvaluation(rawParsed, candCtx, oppSource, userState);
        } catch {
          return null;
        }
      })
      .filter((o): o is Opportunity => o !== null);
  }

  /** List all opportunity DTOs for a specific user via O(k) materialized evaluations query with dynamic contextual serving. */
  static async listForUser(userId: string, options?: ServiceOptions): Promise<Opportunity[]> {
    ensureWorkerDaemonStarted();
    const repos = getRepositories();

    // 1. Fetch materialized candidate evaluations O(k), serving context & opportunity source metadata
    const [evaluations, userDecisions, projection, sourceMap] = await Promise.all([
      repos.evaluations.listEvaluationsForUser(userId, 100, options?.categoryId),
      repos.decisions.getUserDecisions(userId),
      repos.people.getLatestProjection(userId),
      repos.opportunities.getOpportunitySourcesMap(),
    ]);

    const activePursuits = options?.activePursuits !== undefined
      ? options.activePursuits
      : Object.values(userDecisions).filter((d) => d.verb === "PURSUE").length;
    const attentionWindow = projection?.attentionWindow ?? 6;

    const candCtx: CandidateServingContext = {
      personId: userId,
      attentionWindow,
      activePursuits,
    };

    // 2. If pre-computed evaluations exist, serve dynamically (O(k) fast path)
    if (evaluations.length > 0) {
      return evaluations
        .map((ev) => {
          let rawParsed: any;
          try {
            rawParsed = JSON.parse(ev.evaluationJson);
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

          const oppSource = sourceMap.get(ev.jobHash) || {
            jobHash: ev.jobHash,
            role: "Executive Opportunity",
            company: "Executive Firm",
            location: "Remote",
          };

          if (isCanonicalIntrinsicEvaluation(rawParsed)) {
            return serveEvaluation(rawParsed, candCtx, oppSource, userState);
          }
          return adaptLegacyEvaluation(rawParsed, candCtx, oppSource, userState);
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
    const [freshProjection, oppSources] = await Promise.all([
      repos.people.getLatestProjection(userId),
      repos.opportunities.listOpportunitySources(),
    ]);

    if (!freshProjection) {
      console.warn(`[OpportunityService] No projection found for user: ${userId}`);
      return [];
    }

    let active = options?.activePursuits;
    if (active === undefined) {
      active = Object.values(userDecisions).filter((d) => d.verb === "PURSUE").length;
    }

    const { presented } = runEngine(freshProjection, active, oppSources);
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
        triggeredRuleIds: p.record.triggeredRuleIds || [],
        decisionRisks: p.record.decisionRisks || [],
        decisionDrivers: p.record.decisionDrivers || [],
        relativeDifferentiator: p.record.relativeDifferentiator || undefined,
        trajectoryUpside: p.record.trajectoryUpside || undefined,
        careerRegressionScore: (p.record as any).careerRegressionScore ?? null,
        careerValueProtection: (p.record as any).careerValueProtection ?? null,
        opportunityScoreConfidence: p.record.opportunityScoreConfidence,
        opportunityScoreSource: p.record.opportunityScoreSource,
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
      const verb0 = (p.record.trace?.verb0 || p.record.verb || "CONSIDER") as "PURSUE" | "CONSIDER" | "PASS";
      const engineVerdict = (["PURSUE", "CONSIDER", "PASS"].includes(verb0)
        ? verb0
        : "CONSIDER") as "PURSUE" | "CONSIDER" | "PASS";

      const policyVersion = p.record.recommendationVersion || "v4.3";
      const ontologyVersion = "v2";
      const canonicalFingerprint = computeIntrinsicFingerprint(
        freshProjection,
        p.opportunity,
        policyVersion,
        ontologyVersion
      );

      const canonicalPayload: CanonicalIntrinsicEvaluationPayload = {
        schemaVersion: "v4.2-intrinsic",
        jobHash: opp.jobHash,
        personId: userId,
        evaluationInputHash: canonicalFingerprint,
        policyVersion,
        ontologyVersion,
        evaluatedAt: new Date().toISOString(),
        intrinsicVerdict: engineVerdict,
        intrinsicQualityScore: p.record.vetoed ? null : (p.record.qualityScore !== null && p.record.qualityScore !== undefined ? Math.round(p.record.qualityScore) : null),
        parsingConfidence: p.record.confidences?.parsing ?? (p.record.confidence ?? 0.8),
        vetoed: Boolean(p.record.vetoed),
        vetoReason: p.record.vetoReason || null,
        triggeredRuleIds: p.record.triggeredRuleIds || [],
        decisionRisks: p.record.decisionRisks || [],
        decisionDrivers: p.record.decisionDrivers || [],
        relativeDifferentiator: p.record.relativeDifferentiator || undefined,
        trajectoryUpside: p.record.trajectoryUpside || undefined,
        opportunityScoreConfidence: p.record.opportunityScoreConfidence,
        opportunityScoreSource: p.record.opportunityScoreSource,
        evaluationStatus: "COMPLETE",
        dimensions: (p.record.trace?.evidenceMapping || []).map((m: any) => ({
          key: m.key || "mandate",
          label: m.label || m.key || "",
          importance: m.importance || "Core",
          bucket: m.bucket || "Missing",
          value: m.value || "",
          quote: m.quote || "",
        })),
        esi: p.record.esi || 0,
        diligenceStatus: p.record.diligenceStatus || "READY",
        baseNarrative: {
          whyNow: p.narrative.whyNow,
          positioning: p.narrative.positioning,
          primaryProof: p.narrative.primaryProof,
          hiringRisk: p.narrative.hiringRisk,
          alternativePath: p.narrative.alternativePath,
          recommendationArchetype: p.narrative.recommendationArchetype,
          recommendationArchetypeTagline: p.narrative.recommendationArchetypeTagline,
          mandateArchetype: p.narrative.mandateArchetype,
          primaryDriver: p.narrative.primaryDriver,
          secondaryDriver: p.narrative.secondaryDriver,
          primaryRisk: p.narrative.primaryRisk,
          tailoringEffort: p.narrative.tailoringEffort,
          capabilityAlignmentText: p.narrative.capabilityAlignmentText,
          baseRecommendationProse: p.narrative.recommendation,
          recommendedAction: (p.narrative as any).recommendedAction || verb0,
        },
        auditTrace: {
          verb0,
          evaluationTimeFinalVerb: (p.record.trace?.finalVerb as any) || undefined,
          careerValue: p.record.trace?.factors?.careerValue ?? 0,
          shortlistingPotential: p.record.trace?.factors?.shortlistingPotential ?? 0,
          pursuitFriction: p.record.trace?.factors?.pursuitFriction ?? 1.0,
          rawScore: p.record.trace?.priority ?? 0,
          evidenceMappingCount: p.record.trace?.evidenceMapping?.length ?? 0,
        },
      };

      repos.evaluations.saveEvaluation({
        personId: userId,
        jobHash: opp.jobHash,
        policyVersion: canonicalPayload.policyVersion,
        evaluationInputHash: canonicalFingerprint,
        engineVerdict,
        engineQualityScore: canonicalPayload.intrinsicQualityScore || 70.0,
        userDecisionOverride: userState?.userAction as any,
        effectiveDecision: engineVerdict,
        qualityScore: canonicalPayload.intrinsicQualityScore || 70.0,
        evaluationStatus: "COMPLETE",
        evaluationJson: JSON.stringify(canonicalPayload),
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
    const [ev, oppSource] = await Promise.all([
      repos.evaluations.getEvaluation(userId, jobHash),
      repos.opportunities.getOpportunitySource(jobHash),
    ]);
    if (ev) {
      try {
        const rawParsed = JSON.parse(ev.evaluationJson);
        const [userDecisions, projection] = await Promise.all([
          repos.decisions.getUserDecisions(userId),
          repos.people.getLatestProjection(userId),
        ]);

        const activePursuits = options?.activePursuits !== undefined
          ? options.activePursuits
          : Object.values(userDecisions).filter((d) => d.verb === "PURSUE").length;
        const attentionWindow = projection?.attentionWindow ?? 6;

        const candCtx: CandidateServingContext = {
          personId: userId,
          attentionWindow,
          activePursuits,
        };

        const rawUser = userDecisions[jobHash];
        const userState: UserDecisionStateV4 | null = rawUser ? {
          personId: userId,
          jobHash,
          userAction: rawUser.verb as any,
          reviewedFingerprint: (rawUser as any).reviewedFingerprint || null,
          updatedAt: rawUser.updatedAt || null,
        } : (ev.userDecisionOverride ? {
          personId: userId,
          jobHash,
          userAction: ev.userDecisionOverride as any,
          reviewedFingerprint: null,
          updatedAt: ev.updatedAt || null,
        } : null);

        const oppCtx = oppSource || {
          jobHash,
          role: "Executive Opportunity",
          company: "Executive Firm",
          location: "Remote",
        };

        if (isCanonicalIntrinsicEvaluation(rawParsed)) {
          return serveEvaluation(rawParsed, candCtx, oppCtx, userState);
        }
        return adaptLegacyEvaluation(rawParsed, candCtx, oppCtx, userState);
      } catch {}
    }

    // 2. Strict Boundary: Deferred single-item fallback (NEVER evaluates whole corpus)
    return this.evaluateSingleOpportunity(userId, jobHash);
  }

  /** Get neighbors (prev/next DTOs) of an opportunity across full evaluation population. */
  static async neighboursForUser(
    userId: string,
    jobHash: string,
    options?: ServiceOptions,
  ): Promise<{ prev: Opportunity | undefined; next: Opportunity | undefined }> {
    const repos = getRepositories();
    const adj = await repos.evaluations.getAdjacentEvaluations(userId, jobHash);

    const [prev, next] = await Promise.all([
      adj.prevHash ? this.getForUser(userId, adj.prevHash, options) : Promise.resolve(undefined),
      adj.nextHash ? this.getForUser(userId, adj.nextHash, options) : Promise.resolve(undefined),
    ]);

    return { prev, next };
  }

  /** Add newly extracted opportunities (mock data fallback). */
  static addExtra(): void {
    addExtraOpportunities();
  }

  /** Inject fresh scraped records from the server into the UI. */
  static injectFresh(records: any[]): void {
    injectFreshRecords(records);
  }

  /** Evaluates a single candidate-opportunity pair directly returning full Presented engine bundle. */
  static async evaluateSinglePresented(userId: string, jobHash: string): Promise<import("./present").Presented | undefined> {
    const repos = getRepositories();
    let projection = await repos.people.getLatestProjection(userId);
    if (!projection) {
      const { syncCanonicalCandidateProjection } = await import("./candidate-sync");
      projection = await syncCanonicalCandidateProjection(userId).catch(() => undefined);
    }
    const oppSource = await repos.opportunities.getOpportunitySource(jobHash);
    if (!projection || !oppSource) return undefined;
    return runEngineSingle(jobHash, projection, 0, [oppSource]);
  }

  /** Evaluates a single candidate-opportunity pair directly via V4 engines without corpus-wide evaluation. */
  static async evaluateSingleOpportunity(userId: string, jobHash: string): Promise<Opportunity | undefined> {
    const single = await this.evaluateSinglePresented(userId, jobHash);
    return single?.opportunity;
  }
}
