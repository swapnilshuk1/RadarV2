/**
 * src/lib/intelligence/serving/EvaluationServingEngine.ts
 *
 * RADAR V4 Pure Contextual Serving Engine
 * 
 * Invariant Boundary:
 * Layer 1 (Intrinsic Evaluation): Materialized in candidate_evaluations (immutable truth: verb0, intrinsic quality score, audit trace).
 * Layer 2 (Contextual Serving): Computed dynamically at read time (headspace saturation, active pursuits, attention window, explicit user decisions).
 *
 * This engine is 100% pure: zero database access, zero side effects, zero engine re-executions, zero cache mutations.
 */

import {
  computeEffectiveDecision,
  computeReviewWorkflowState,
  type EngineRecommendationV4,
  type UserDecisionStateV4,
  type EffectiveDecision,
  type ReviewWorkflowState,
  type EngineVerdict,
} from "../../../domain/decision_v4";
import { buildHeadspace } from "../candidate";
import { applyHeadspaceFilter } from "../headspace-filter";
import type { Opportunity, DimensionResult, DimensionKey, EvidenceBucket } from "../../../data/opportunity-fixtures";

export interface CanonicalIntrinsicEvaluationPayload {
  readonly schemaVersion: "v4.2-intrinsic";
  readonly jobHash: string;
  readonly personId: string;
  readonly evaluationInputHash: string;
  readonly policyVersion: string;
  readonly ontologyVersion: string;
  readonly evaluatedAt: string;

  // Intrinsic Truth (Pre-Headspace Policy Verdict)
  readonly intrinsicVerdict: EngineVerdict;
  readonly intrinsicQualityScore: number | null;
  readonly parsingConfidence: number;
  readonly vetoed: boolean;
  readonly vetoReason: string | null;
  readonly triggeredRuleIds: string[];
  readonly decisionRisks: Array<{ factor: string; impact: "positive" | "negative"; strength: "high" | "medium" | "low"; evidence?: string }>;
  readonly decisionDrivers: Array<{ factor: string; impact: "positive" | "negative"; strength: "high" | "medium" | "low"; evidence?: string }>;
  readonly relativeDifferentiator?: string;
  readonly trajectoryUpside?: string;
  readonly opportunityScoreConfidence?: "HIGH" | "LOW";
  readonly opportunityScoreSource?: "EXPLICIT" | "FALLBACK";

  // Dimensional Evidence & Status
  readonly evaluationStatus: "COMPLETE" | "SPARSE_SPEC";
  readonly dimensions: Array<{
    key: string;
    label: string;
    importance: string;
    bucket: string;
    value: string;
    quote: string;
  }>;
  readonly esi: number;
  readonly diligenceStatus: string;

  // Pre-Synthesized Editorial Base Copy (Immutable)
  readonly baseNarrative: {
    readonly whyNow?: string;
    readonly positioning?: any;
    readonly primaryProof?: any;
    readonly hiringRisk?: any;
    readonly alternativePath?: string;
    readonly recommendationArchetype?: string;
    readonly recommendationArchetypeTagline?: string;
    readonly mandateArchetype?: string;
    readonly primaryDriver?: string;
    readonly secondaryDriver?: string;
    readonly primaryRisk?: string;
    readonly tailoringEffort?: string;
    readonly capabilityAlignmentText?: string;
    readonly baseRecommendationProse: string;
    readonly recommendedAction?: string;
  };

  // Pure Diagnostic Audit Trace
  readonly auditTrace: {
    readonly verb0: EngineVerdict;
    readonly evaluationTimeFinalVerb?: EngineVerdict;
    readonly careerValue: number;
    readonly shortlistingPotential: number;
    readonly pursuitFriction: number;
    readonly rawScore: number;
    readonly evidenceMappingCount: number;
  };
}

export interface CandidateServingContext {
  readonly personId: string;
  readonly attentionWindow: number;
  readonly activePursuits: number;
}

export type OpportunityServingContext = Record<string, any>;

/**
 * Pure helper to compute relative posting time for the UI, without modifying raw state.
 */
function formatPostedRelative(postedAt?: string): string {
  if (!postedAt) return "Age unavailable";
  const date = new Date(postedAt);
  if (isNaN(date.getTime())) return "Age unavailable";

  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  
  if (diffDays === 0) return "Posted today";
  if (diffDays === 1) return "Posted 1 day ago";
  return `Posted ${diffDays} days ago`;
}

/**
 * Pure Type Guard: Validates whether a cached JSON object follows the canonical v4.2-intrinsic format.
 */
export function isCanonicalIntrinsicEvaluation(
  cached: unknown
): cached is CanonicalIntrinsicEvaluationPayload {
  if (!cached || typeof cached !== "object") return false;
  const c = cached as Record<string, unknown>;
  return (
    c.schemaVersion === "v4.2-intrinsic" &&
    typeof c.jobHash === "string" &&
    typeof c.intrinsicVerdict === "string" &&
    typeof c.baseNarrative === "object" &&
    c.baseNarrative !== null
  );
}

/**
 * Pure Function: Transforms a Canonical Intrinsic Evaluation + Current Serving Context into a dynamic Opportunity DTO.
 */
export function serveEvaluation(
  cached: CanonicalIntrinsicEvaluationPayload,
  candCtx: CandidateServingContext,
  oppCtx: OpportunityServingContext,
  userDecision: UserDecisionStateV4 | null
): Opportunity {
  if (oppCtx && oppCtx.jobHash && oppCtx.jobHash !== cached.jobHash) {
    throw new Error(
      `[EvaluationServingEngine] Mismatched opportunity context: cached=${cached.jobHash}, oppCtx=${oppCtx.jobHash}`
    );
  }

  // 1. Read intrinsic verdict (verb0)
  const verb0 = cached.intrinsicVerdict;

  // 2. Build current headspace from dynamic candidate context
  const headspace = buildHeadspace(candCtx.activePursuits, candCtx.attentionWindow);

  // 3. Apply headspace filter dynamically
  const headspaceOutcome = applyHeadspaceFilter(verb0 as any, headspace);
  const finalVerb = headspaceOutcome.finalVerb as EngineVerdict;

  // 4. Construct current served EngineRecommendation (Intrinsic Verdict + Headspace Advisory)
  const servedEngineRec: EngineRecommendationV4 & { evaluationTimeFinalVerb?: EngineVerdict } = {
    jobHash: cached.jobHash,
    evaluationFingerprint: cached.evaluationInputHash,
    engineVerdict: verb0,
    verb0,
    headspaceVerdict: finalVerb,
    headspaceDowngraded: headspaceOutcome.downgraded,
    headspaceReason: headspaceOutcome.reason,
    evaluationTimeFinalVerb: cached.auditTrace?.evaluationTimeFinalVerb,
    vetoed: cached.vetoed,
    vetoReason: cached.vetoReason,
    qualityScore: cached.intrinsicQualityScore,
    parsingConfidence: cached.parsingConfidence,
    evaluatedAt: cached.evaluatedAt,
    triggeredRuleIds: cached.triggeredRuleIds,
    decisionRisks: cached.decisionRisks,
    decisionDrivers: cached.decisionDrivers,
    relativeDifferentiator: cached.relativeDifferentiator,
    trajectoryUpside: cached.trajectoryUpside,
    opportunityScoreConfidence: cached.opportunityScoreConfidence,
    opportunityScoreSource: cached.opportunityScoreSource,
  };

  // 5. Apply current user decision combinator
  const effectiveDecision = computeEffectiveDecision(servedEngineRec, userDecision);
  const reviewWorkflowState = computeReviewWorkflowState(servedEngineRec, userDecision);

  // 6. Dynamic narrative synthesis (Contextual Advisory without mutating cached base narrative)
  const finalRecommendation = headspaceOutcome.downgraded && headspaceOutcome.reason
    ? `${headspaceOutcome.reason} ${cached.baseNarrative.baseRecommendationProse}`
    : cached.baseNarrative.baseRecommendationProse;

  // 7. Presentation fields
  const displayScore = cached.intrinsicQualityScore !== null ? `${Math.round(cached.intrinsicQualityScore)}%` : "—";
  const uiBadge = cached.vetoed
    ? { label: "Vetoed", variant: "pass" as const }
    : verb0 === "PURSUE"
      ? { label: "Recommended", variant: "signal" as const }
      : verb0 === "CONSIDER"
        ? { label: "Consider", variant: "caution" as const }
        : { label: "Pass", variant: "muted" as const };

  const cleanDimensions: DimensionResult[] = Array.isArray(cached.dimensions)
    ? cached.dimensions.map((d) => ({
        key: (d.key || "mandate") as DimensionKey,
        label: d.label || d.key || "",
        importance: (d.importance || "Core") as "Core" | "Supporting" | "Context",
        bucket: (d.bucket || "Missing") as EvidenceBucket,
        jdEvidence: {
          status: "Explicit",
          value: d.value || "",
          evidence: d.quote ? [{ quote: d.quote, source: "snippet" }] : [],
        },
      }))
    : [];

  const decisionAction = userDecision?.userAction && userDecision.userAction !== "NONE"
    ? userDecision.userAction
    : verb0;

  return {
    ...oppCtx,
    jobHash: cached.jobHash,
    role: (oppCtx.role as string) || (oppCtx.title as string) || "Executive Opportunity",
    company: (oppCtx.company as string) || "Executive Firm",
    location: (oppCtx.location as string) || "Remote",
    applyUrl: (oppCtx.applyUrl as string) || undefined,
    postedRelative: formatPostedRelative(oppCtx.postedAt as string | undefined),
    postedPrecision: (oppCtx.postedPrecision as string) || "UNKNOWN",
    dimensions: cleanDimensions,
    decision: decisionAction,
    recommendation: finalRecommendation,
    whyNow: cached.baseNarrative.whyNow,
    positioning: cached.baseNarrative.positioning,
    primaryProof: cached.baseNarrative.primaryProof,
    hiringRisk: cached.baseNarrative.hiringRisk,
    alternativePath: cached.baseNarrative.alternativePath,
    recommendationArchetype: cached.baseNarrative.recommendationArchetype,
    recommendationArchetypeTagline: cached.baseNarrative.recommendationArchetypeTagline,
    mandateArchetype: cached.baseNarrative.mandateArchetype,
    primaryDriver: cached.baseNarrative.primaryDriver,
    secondaryDriver: cached.baseNarrative.secondaryDriver,
    primaryRisk: cached.baseNarrative.primaryRisk,
    tailoringEffort: cached.baseNarrative.tailoringEffort,
    capabilityAlignmentText: cached.baseNarrative.capabilityAlignmentText,
    recommendedAction: cached.baseNarrative.recommendedAction || verb0,
    esi: cached.esi,
    diligenceStatus: cached.diligenceStatus as any,
    engineRecommendation: servedEngineRec,
    userDecision,
    effectiveDecision,
    reviewWorkflowState,
    displayScore,
    uiBadge,
  } as unknown as Opportunity;
}

/**
 * Compatibility Adapter: Serves legacy / non-canonical evaluation rows.
 * Tags the evaluation as LEGACY_NON_CANONICAL and dynamically applies current headspace without inventing false verb0 truth.
 */
export function adaptLegacyEvaluation(
  legacyOpp: any,
  candCtx: CandidateServingContext,
  oppCtx: OpportunityServingContext,
  userDecision: UserDecisionStateV4 | null
): Opportunity {
  const recordedVerdict: EngineVerdict = (
    legacyOpp.engineRecommendation?.engineVerdict ||
    legacyOpp.decision ||
    "CONSIDER"
  ) as EngineVerdict;

  // Build current headspace
  const headspace = buildHeadspace(candCtx.activePursuits, candCtx.attentionWindow);

  // Apply headspace filter to recorded verdict
  const headspaceOutcome = applyHeadspaceFilter(recordedVerdict as any, headspace);
  const finalVerb = headspaceOutcome.finalVerb as EngineVerdict;

  const servedEngineRec: EngineRecommendationV4 & { legacyStatus: "LEGACY_NON_CANONICAL" } = {
    ...(legacyOpp.engineRecommendation || {}),
    jobHash: legacyOpp.jobHash || oppCtx.jobHash || "",
    evaluationFingerprint: legacyOpp.engineRecommendation?.evaluationFingerprint || "legacy_v4.1",
    engineVerdict: recordedVerdict,
    verb0: recordedVerdict,
    headspaceVerdict: finalVerb,
    headspaceDowngraded: headspaceOutcome.downgraded,
    headspaceReason: headspaceOutcome.reason,
    vetoed: Boolean(legacyOpp.engineRecommendation?.vetoed),
    vetoReason: legacyOpp.engineRecommendation?.vetoReason || null,
    qualityScore: legacyOpp.engineRecommendation?.qualityScore ?? legacyOpp.recommendationResult?.score ?? null,
    parsingConfidence: legacyOpp.engineRecommendation?.parsingConfidence ?? 0.8,
    evaluatedAt: legacyOpp.engineRecommendation?.evaluatedAt || new Date().toISOString(),
    legacyStatus: "LEGACY_NON_CANONICAL",
  };

  const effectiveDecision = computeEffectiveDecision(servedEngineRec, userDecision);
  const reviewWorkflowState = computeReviewWorkflowState(servedEngineRec, userDecision);

  const baseRecText = legacyOpp.recommendation || "";
  const finalRecommendation = headspaceOutcome.downgraded && headspaceOutcome.reason && !baseRecText.includes("You are at capacity")
    ? `${headspaceOutcome.reason} ${baseRecText}`
    : baseRecText;

  const decisionAction = userDecision?.userAction && userDecision.userAction !== "NONE"
    ? userDecision.userAction
    : recordedVerdict;

  return {
    ...legacyOpp,
    ...oppCtx,
    jobHash: legacyOpp.jobHash || oppCtx.jobHash,
    applyUrl: (oppCtx.applyUrl as string) || legacyOpp.applyUrl,
    postedRelative: oppCtx.postedAt ? formatPostedRelative(oppCtx.postedAt as string) : legacyOpp.postedRelative,
    postedPrecision: (oppCtx.postedPrecision as string) || "UNKNOWN",
    decision: decisionAction,
    recommendation: finalRecommendation,
    engineRecommendation: servedEngineRec,
    userDecision,
    effectiveDecision,
    reviewWorkflowState,
  } as Opportunity;
}
