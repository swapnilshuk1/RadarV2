/**
 * src/lib/intelligence/serving/EvaluationServingEngine.ts
 *
 * RADAR V4 Pure Contextual Serving Engine
 * 
 * Invariant Boundary:
 * Layer 1 (Intrinsic Evaluation): Materialized in candidate_evaluations (immutable truth: verb0, intrinsic quality score, audit trace).
 * Layer 2 (Contextual Serving): transforms persisted evaluation into display
 * fields without changing recommendation semantics.
 *
 * This engine is 100% pure: zero database access, zero side effects, zero engine re-executions, zero cache mutations.
 */

import {
  computeEffectiveDecision,
  computeReviewWorkflowState,
  type EngineRecommendationV4,
  type UserDecisionStateV4,
  type EngineVerdict,
} from "../../../domain/decision_v4";
import { resolveCanonicalServingReadModel } from "./CanonicalServingReadModel";
import type { Opportunity, DimensionResult, DimensionKey, EvidenceBucket } from "../../../data/opportunity-fixtures";
import { isMeaningfulEvidenceQuote } from "@/domain/evidence";
import type { CanonicalEvaluatedPayloadV4_3 } from "@/lib/domain/evaluation_payloads";

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
    key: DimensionKey;
    label: string;
    importance: "Core" | "Supporting" | "Context";
    bucket: EvidenceBucket;
    value: string;
    quote: string;
  }>;
  readonly esi: number;
  readonly diligenceStatus: "READY" | "INSUFFICIENT" | "STALE" | "FAILED" | "UNKNOWN";

  // Pre-Synthesized Editorial Base Copy (Immutable)
  readonly baseNarrative: {
    readonly whyNow?: string;
    readonly positioning?: string[];
    readonly primaryProof?: { headline: string; detail: string };
    readonly hiringRisk?: string;
    readonly alternativePath?: string;
    readonly recommendationArchetype?: string;
    readonly recommendationArchetypeTagline?: string;
    readonly mandateArchetype?: string;
    readonly primaryDriver?: string;
    readonly secondaryDriver?: string;
    readonly primaryRisk?: string;
    readonly tailoringEffort?: "LOW" | "MODERATE" | "HIGH";
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
export interface ServingPresentationContext {
  readonly personId: string;
}

/** @deprecated Test-only compatibility alias. Serving no longer receives capacity semantics. */
export type CandidateServingContext = ServingPresentationContext & Record<string, unknown>;

export type OpportunityServingContext = {
  jobHash?: string;
  role?: string;
  title?: string;
  company?: string;
  location?: string;
  scrapedFrom?: string;
  applyUrl?: string;
  postedAt?: string;
  postedPrecision?: string;
};

/**
 * Pure helper to compute relative posting time for the UI, without modifying raw state.
 */
export function formatPostedRelative(postedAt?: string): string {
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
 * Serves the sole persisted evaluated-artifact contract written by
 * EvaluationWorker. Presentation fields below are neutral formatting of the
 * canonical artifact and opportunity metadata; no legacy evaluation facts are
 * reconstructed here.
 */
export function serveCanonicalEvaluatedPayload(
  payload: CanonicalEvaluatedPayloadV4_3,
  oppCtx: OpportunityServingContext,
  userDecision: UserDecisionStateV4 | null,
  vetoed: boolean,
): Opportunity {
  const readModel = resolveCanonicalServingReadModel({
    evaluationState: "EVALUATED",
    engineVerdict: payload.decision,
    userDecision: userDecision?.userAction || null,
    evaluationContextFingerprint: payload.contextFingerprint,
    evaluationFingerprint: payload.evaluationInputHash,
    reviewedFingerprint: userDecision?.reviewedFingerprint || null,
    qualityScore: payload.score,
  });
  const engineRecommendation: EngineRecommendationV4 = {
    jobHash: payload.jobHash,
    evaluationFingerprint: payload.evaluationInputHash,
    engineVerdict: payload.decision,
    verb0: payload.decision,
    vetoed,
    // v4.3 does not persist a veto reason. Do not manufacture one merely to
    // satisfy the older presentation shape.
    vetoReason: undefined,
    qualityScore: payload.score,
    parsingConfidence: undefined,
    evaluatedAt: payload.evaluatedAt,
  };
  return {
    evaluationState: "EVALUATED",
    jobHash: payload.jobHash,
    role: oppCtx.role || oppCtx.title || "UNKNOWN",
    company: oppCtx.company || "UNKNOWN",
    location: oppCtx.location || "UNKNOWN",
    scrapedFrom: oppCtx.scrapedFrom === "LinkedIn" || oppCtx.scrapedFrom === "Naukri" || oppCtx.scrapedFrom === "Indeed" ? oppCtx.scrapedFrom : "Unknown",
    applyUrl: oppCtx.applyUrl || undefined,
    postedRelative: formatPostedRelative(oppCtx.postedAt),
    decision: payload.decision,
    recommendation: "",
    primaryConcern: null,
    positioning: [],
    headspace: [],
    dimensions: [],
    hiringRisk: "UNKNOWN",
    diligenceStatus: payload.diligenceStatus,
    engineRecommendation,
    userDecision,
    effectiveDecision: readModel.effectiveDecision,
    reviewWorkflowState: readModel.reviewState === "CURRENT" ? "REVIEWED_CURRENT" : readModel.reviewState === "STALE" ? "REVIEWED_STALE" : readModel.reviewState === "UNKNOWN" ? "REVIEWED_UNKNOWN" : "UNREVIEWED",
    reviewState: readModel.reviewState,
    evaluationContextFingerprint: payload.contextFingerprint,
    evaluationFingerprint: payload.evaluationInputHash,
    displayScore: `${Math.round(payload.score)}%`,
    uiBadge: payload.decision === "PURSUE" ? { label: "Recommended", variant: "signal" } : payload.decision === "CONSIDER" ? { label: "Consider", variant: "caution" } : { label: "Pass", variant: "muted" },
  };
}

/**
 * Pure Function: Transforms a Canonical Intrinsic Evaluation + Current Serving Context into a dynamic Opportunity DTO.
 */
export function serveEvaluation(
  cached: CanonicalIntrinsicEvaluationPayload,
  _presentationContext: ServingPresentationContext,
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

  // 2. Headspace is pagination/display capacity, not recommendation policy.
  // Preserve the immutable engine verdict without a contextual downgrade.
  const servedEngineRec: EngineRecommendationV4 & { evaluationTimeFinalVerb?: EngineVerdict } = {
    jobHash: cached.jobHash,
    evaluationFingerprint: cached.evaluationInputHash,
    engineVerdict: verb0,
    verb0,
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

  // Serving and dossier use the same resolver. This pure presentation helper
  // knows the exact artifact fingerprint but intentionally has no context-row
  // identity to substitute for it.
  const canonicalDecision = resolveCanonicalServingReadModel({
    evaluationState: "EVALUATED",
    engineVerdict: verb0,
    userDecision: userDecision?.userAction || null,
    evaluationContextFingerprint: null,
    evaluationFingerprint: cached.evaluationInputHash,
    reviewedFingerprint: userDecision?.reviewedFingerprint || null,
    qualityScore: cached.intrinsicQualityScore,
  });
  const effectiveDecision = canonicalDecision.effectiveDecision;
  const reviewWorkflowState = canonicalDecision.reviewState === "CURRENT"
    ? "REVIEWED_CURRENT"
    : canonicalDecision.reviewState === "STALE"
      ? "REVIEWED_STALE"
      : canonicalDecision.reviewState === "UNKNOWN"
        ? "REVIEWED_UNKNOWN"
        : "UNREVIEWED";

  // 6. Use persisted narrative without a capacity-based recommendation prefix.
  const finalRecommendation = cached.baseNarrative.baseRecommendationProse;

  // 7. Presentation fields
  const displayScore = cached.intrinsicQualityScore !== null ? `${Math.round(cached.intrinsicQualityScore)}%` : "—";
  const uiBadge = cached.vetoed
    ? { label: "Vetoed", variant: "pass" as const }
    : verb0 === "PURSUE"
      ? { label: "Recommended", variant: "signal" as const }
      : verb0 === "CONSIDER"
        ? { label: "Consider", variant: "caution" as const }
        : verb0 === "UNKNOWN"
          ? { label: "Not evaluated", variant: "muted" as const }
        : { label: "Pass", variant: "muted" as const };

  const cleanDimensions: DimensionResult[] = Array.isArray(cached.dimensions)
    ? cached.dimensions.map((d) => {
        const hasValidQuote = isMeaningfulEvidenceQuote(d.quote);
        const hasValue = typeof d.value === "string" && d.value.trim().length > 0;
        const isExplicit = hasValidQuote;
        return {
          key: (d.key || "mandate") as DimensionKey,
          label: d.label || d.key || "",
          importance: (d.importance || "Core") as "Core" | "Supporting" | "Context",
          bucket: isExplicit ? ((d.bucket as EvidenceBucket) || "Matched") : "Missing",
          jdEvidence: {
            status: isExplicit ? "Explicit" : "Missing",
            value: isExplicit ? (hasValue ? String(d.value).slice(0, 140) : String(d.quote).slice(0, 140)) : "",
            evidence: isExplicit ? [{ quote: String(d.quote).slice(0, 140), source: "snippet" }] : [],
          },
        };
      })
    : [];

  const decisionAction = userDecision?.userAction && userDecision.userAction !== "NONE"
    ? userDecision.userAction
    : verb0;

  return {
    evaluationState: "EVALUATED",
    jobHash: cached.jobHash,
    role: oppCtx.role || oppCtx.title || "UNKNOWN",
    company: (oppCtx.company && oppCtx.company !== "Unknown" && oppCtx.company !== "Unknown Company") ? oppCtx.company : "UNKNOWN",
    location: oppCtx.location || "UNKNOWN",
    scrapedFrom: (oppCtx.scrapedFrom === "LinkedIn" || oppCtx.scrapedFrom === "Naukri" || oppCtx.scrapedFrom === "Indeed") ? oppCtx.scrapedFrom : "Unknown",
    applyUrl: oppCtx.applyUrl || undefined,
    postedRelative: formatPostedRelative(oppCtx.postedAt),
    dimensions: cleanDimensions,
    decision: decisionAction,
    recommendation: finalRecommendation,
    whyNow: cached.baseNarrative.whyNow,
    primaryConcern: null,
    positioning: cached.baseNarrative.positioning || [],
    primaryProof: cached.baseNarrative.primaryProof,
    headspace: [],
    hiringRisk: cached.baseNarrative.hiringRisk || "UNKNOWN",
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
    diligenceStatus: cached.diligenceStatus,
    engineRecommendation: servedEngineRec,
    userDecision,
    effectiveDecision,
    reviewWorkflowState,
    displayScore,
    uiBadge,
  };
}
