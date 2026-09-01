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
import { isMeaningfulEvidenceQuote } from "@/domain/evidence";

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

export interface CandidateServingContext {
  readonly personId: string;
  readonly attentionWindow: number;
  readonly activePursuits: number;
}

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
  const headspaceOutcome = applyHeadspaceFilter(verb0, headspace);
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
    role: oppCtx.role || oppCtx.title || "Executive Opportunity",
    company: (oppCtx.company && oppCtx.company !== "Unknown" && oppCtx.company !== "Unknown Company") ? oppCtx.company : "Company not available",
    location: oppCtx.location || "Remote",
    scrapedFrom: (oppCtx.scrapedFrom === "Naukri" || oppCtx.scrapedFrom === "Indeed") ? oppCtx.scrapedFrom : "LinkedIn",
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
    hiringRisk: cached.baseNarrative.hiringRisk || "Unknown",
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

/**
 * Adapts legacy DecisionVerb or unknown strings into a strict EngineVerdict.
 * Safely maps NOT_EVALUABLE -> SPARSE_SPEC to preserve the missing-context semantics.
 */
function adaptEngineVerdict(verb: unknown): EngineVerdict {
  if (verb === "PURSUE") return "PURSUE";
  if (verb === "CONSIDER") return "CONSIDER";
  if (verb === "PASS") return "PASS";
  if (verb === "NOT_EVALUABLE" || verb === "SPARSE_SPEC") return "SPARSE_SPEC";
  return "SPARSE_SPEC";
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
  const presentedOpportunity = legacyOpp.opportunity ?? legacyOpp;
  const recObj = legacyOpp.record || legacyOpp.engineRecommendation || presentedOpportunity.engineRecommendation || legacyOpp;
  const rawVerb = recObj.engineVerdict
    || recObj.verb
    || legacyOpp.engineRecommendation?.engineVerdict
    || presentedOpportunity.decision
    || legacyOpp.decision
    || legacyOpp.verb
    || legacyOpp.verdict;
  const recordedVerdict = adaptEngineVerdict(rawVerb);

  // Build current headspace
  const headspace = buildHeadspace(candCtx.activePursuits, candCtx.attentionWindow);

  // Apply headspace filter to recorded verdict
  const headspaceOutcome = applyHeadspaceFilter(recordedVerdict, headspace);
  const finalVerb = headspaceOutcome.finalVerb as EngineVerdict;

  const servedEngineRec: EngineRecommendationV4 & { legacyStatus: "LEGACY_NON_CANONICAL" } = {
    ...(legacyOpp.engineRecommendation || {}),
    ...(presentedOpportunity.engineRecommendation || {}),
    ...(legacyOpp.record || {}),
    jobHash: oppCtx.jobHash || presentedOpportunity.jobHash || legacyOpp.jobHash || "",
    evaluationFingerprint: recObj.evaluationFingerprint || legacyOpp.engineRecommendation?.evaluationFingerprint || "legacy_v4.1",
    engineVerdict: recordedVerdict,
    verb0: recordedVerdict,
    headspaceVerdict: finalVerb,
    headspaceDowngraded: headspaceOutcome.downgraded,
    headspaceReason: headspaceOutcome.reason,
    vetoed: Boolean(recObj.vetoed ?? legacyOpp.engineRecommendation?.vetoed ?? presentedOpportunity.engineRecommendation?.vetoed),
    vetoReason: recObj.vetoReason || legacyOpp.engineRecommendation?.vetoReason || presentedOpportunity.engineRecommendation?.vetoReason || null,
    qualityScore: recObj.qualityScore ?? legacyOpp.engineRecommendation?.qualityScore ?? presentedOpportunity.engineRecommendation?.qualityScore ?? presentedOpportunity.recommendationResult?.score ?? null,
    parsingConfidence: recObj.parsingConfidence ?? legacyOpp.engineRecommendation?.parsingConfidence ?? 0.8,
    evaluatedAt: recObj.evaluatedAt || legacyOpp.engineRecommendation?.evaluatedAt || new Date().toISOString(),
    legacyStatus: "LEGACY_NON_CANONICAL",
  };

  const effectiveDecision = computeEffectiveDecision(servedEngineRec, userDecision);
  const reviewWorkflowState = computeReviewWorkflowState(servedEngineRec, userDecision);

  const rawDimensions = Array.isArray(presentedOpportunity.dimensions) && presentedOpportunity.dimensions.length > 0
    ? presentedOpportunity.dimensions
    : Array.isArray(legacyOpp.dimensions)
    ? legacyOpp.dimensions
    : [];

  const cleanDimensions: DimensionResult[] = rawDimensions.map((d: Record<string, unknown>): DimensionResult => {
    const jdEv = d.jdEvidence as Record<string, unknown> | undefined;
    const rawStatus = (jdEv?.status as import("@/data/opportunity-fixtures").Status | undefined) || "Missing";
    const rawEvidenceArr = Array.isArray(jdEv?.evidence) ? (jdEv.evidence as unknown[]) : [];
    const rawQuote = typeof (rawEvidenceArr[0] as Record<string, unknown> | undefined)?.quote === "string"
      ? String((rawEvidenceArr[0] as Record<string, unknown>).quote)
      : typeof jdEv?.quote === "string"
      ? String(jdEv.quote)
      : typeof d.quote === "string"
      ? String(d.quote)
      : "";
    const rawValue = typeof jdEv?.value === "string" ? String(jdEv.value) : typeof d.value === "string" ? String(d.value) : "";

    const hasValidQuote = isMeaningfulEvidenceQuote(rawQuote);
    const hasValue = typeof rawValue === "string" && rawValue.trim().length > 0;

    let finalStatus: import("@/data/opportunity-fixtures").Status = rawStatus;
    if (rawStatus === "Explicit") {
      if (!hasValidQuote) {
        finalStatus = "Missing";
      }
    }

    const isExplicit = finalStatus === "Explicit";
    let finalValue = "";
    if (isExplicit) {
      finalValue = hasValue ? rawValue.slice(0, 140) : rawQuote.slice(0, 140);
    } else if (finalStatus !== "Missing") {
      finalValue = typeof rawValue === "string" ? rawValue.slice(0, 140) : "";
    }
    const finalEvidence: { quote: string; source: import("@/data/opportunity-fixtures").EvidenceSource }[] = isExplicit && hasValidQuote
      ? [{ quote: rawQuote.slice(0, 140), source: "snippet" }]
      : [];

    return {
      key: ((d.key as string) || "mandate") as DimensionKey,
      label: (d.label as string) || (d.key as string) || "",
      importance: ((d.importance as string) || "Core") as "Core" | "Supporting" | "Context",
      bucket: finalStatus === "Missing" ? "Missing" : ((d.bucket as EvidenceBucket) || "Missing"),
      jdEvidence: {
        status: finalStatus,
        value: finalValue,
        evidence: finalEvidence,
      },
    };
  });

  const decisionAction = userDecision?.userAction && userDecision.userAction !== "NONE"
    ? userDecision.userAction
    : recordedVerdict;

  // Precedence: authoritative oppCtx identity/url/location -> presentedOpportunity -> top-level legacy fields.
  // DO NOT copy legacy recommendation prose, primaryDriver, primaryRisk, hiringRisk, whyNow, positioning, primaryProof into served DTO!
  return {
    evaluationState: "LEGACY",
    jobHash: oppCtx.jobHash || presentedOpportunity.jobHash || legacyOpp.jobHash || "",
    role: oppCtx.role || oppCtx.title || presentedOpportunity.role || legacyOpp.role || "Executive Opportunity",
    company: (oppCtx.company && oppCtx.company !== "Unknown" && oppCtx.company !== "Unknown Company")
      ? oppCtx.company
      : (presentedOpportunity.company && presentedOpportunity.company !== "Unknown" && presentedOpportunity.company !== "Unknown Company")
      ? presentedOpportunity.company
      : (legacyOpp.company && legacyOpp.company !== "Unknown" && legacyOpp.company !== "Unknown Company")
      ? legacyOpp.company
      : (legacyOpp.record?.company && legacyOpp.record.company !== "Unknown" && legacyOpp.record.company !== "Unknown Company")
      ? legacyOpp.record.company
      : "Company not available",
    location: oppCtx.location || presentedOpportunity.location || legacyOpp.location || "Remote",
    scrapedFrom: (oppCtx.scrapedFrom === "Naukri" || oppCtx.scrapedFrom === "Indeed")
      ? oppCtx.scrapedFrom
      : (presentedOpportunity.scrapedFrom === "Naukri" || presentedOpportunity.scrapedFrom === "Indeed")
      ? presentedOpportunity.scrapedFrom
      : legacyOpp.scrapedFrom || "LinkedIn",
    applyUrl: oppCtx.applyUrl || presentedOpportunity.applyUrl || legacyOpp.applyUrl || undefined,
    postedRelative: oppCtx.postedAt
      ? formatPostedRelative(oppCtx.postedAt)
      : presentedOpportunity.postedRelative || legacyOpp.postedRelative || "Age unavailable",
    decision: decisionAction,
    recommendation: "",
    whyNow: undefined,
    primaryConcern: null,
    positioning: [],
    primaryProof: undefined,
    headspace: [],
    headspaceInvestment: undefined,
    dimensions: cleanDimensions,
    hiringRisk: "Unknown",
    alternativePath: undefined,
    recommendationResult: undefined,
    esi: undefined,
    diligenceStatus: undefined,
    recommendationArchetype: undefined,
    recommendationArchetypeTagline: undefined,
    mandateArchetype: undefined,
    primaryDriver: undefined,
    secondaryDriver: undefined,
    primaryRisk: undefined,
    tailoringEffort: undefined,
    capabilityAlignmentText: undefined,
    recommendedAction: undefined,
    engineRecommendation: servedEngineRec,
    userDecision,
    effectiveDecision,
    reviewWorkflowState,
    displayScore: undefined,
    uiBadge: undefined,
  };
}
