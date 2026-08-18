import { describe, it, expect } from "vitest";
import {
  computeEffectiveDecision,
  computeReviewWorkflowState,
  type EngineRecommendationV4,
  type UserDecisionStateV4,
  type EffectiveDecision,
  type ReviewWorkflowState,
} from "../src/domain/decision_v4";
import { buildHeadspace } from "../src/lib/intelligence/candidate";
import { applyHeadspaceFilter } from "../src/lib/intelligence/headspace-filter";

/**
 * Canonical Intrinsic Stored Evaluation Payload
 */
export interface CanonicalIntrinsicEvaluationPayload {
  readonly schemaVersion: "v4.2-intrinsic";
  readonly jobHash: string;
  readonly personId: string;
  readonly evaluationInputHash: string;
  readonly policyVersion: string;
  readonly ontologyVersion: string;
  readonly evaluatedAt: string;
  
  // Intrinsic Truth (Pre-Headspace)
  readonly intrinsicVerdict: "PURSUE" | "CONSIDER" | "PASS" | "SPARSE_SPEC";
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
  readonly dimensions: Array<{ key: string; label: string; importance: string; bucket: string; value: string; quote: string }>;
  readonly esi: number;
  readonly diligenceStatus: "READY" | "FAILED" | "IN_PROGRESS";

  // Pre-Synthesized Editorial Base Copy
  readonly baseNarrative: {
    readonly whyNow: string;
    readonly positioning: string;
    readonly primaryProof: string;
    readonly hiringRisk: string;
    readonly alternativePath: string;
    readonly recommendationArchetype?: string;
    readonly recommendationArchetypeTagline?: string;
    readonly mandateArchetype?: string;
    readonly primaryDriver?: string;
    readonly secondaryDriver?: string;
    readonly primaryRisk?: string;
    readonly tailoringEffort?: string;
    readonly capabilityAlignmentText?: string;
    readonly baseRecommendationProse: string;
  };

  // Pure Diagnostic Audit Trace
  readonly auditTrace: {
    readonly careerValue: number;
    readonly shortlistingPotential: number;
    readonly pursuitFriction: number;
    readonly rawScore: number;
    readonly evidenceMappingCount: number;
  };
}

export interface ServingCandidateContext {
  readonly personId: string;
  readonly attentionWindow: number;
  readonly activePursuits: number;
}

export interface ServingOpportunityContext {
  readonly title: string;
  readonly company: string;
  readonly location: string;
  readonly workModel?: string;
}

export interface ServedOpportunityDTO {
  readonly jobHash: string;
  readonly title: string;
  readonly company: string;
  readonly location: string;
  readonly decision: string;
  readonly effectiveDecision: EffectiveDecision;
  readonly reviewWorkflowState: ReviewWorkflowState;
  readonly qualityScore: number | null;
  readonly displayScore: string;
  readonly uiBadge: { label: string; variant: "signal" | "caution" | "pass" | "muted" };
  readonly headspaceSaturated: boolean;
  readonly headspaceDowngraded: boolean;
  readonly recommendation: string;
  readonly engineRecommendation: EngineRecommendationV4;
  readonly userDecision: UserDecisionStateV4 | null;
}

/**
 * Pure Serving Transformation Function (Phase 4A Contract Specification)
 */
export function serveEvaluation(
  cached: CanonicalIntrinsicEvaluationPayload,
  candCtx: ServingCandidateContext,
  oppCtx: ServingOpportunityContext,
  userDecision: UserDecisionStateV4 | null
): ServedOpportunityDTO {
  // 1. Build headspace from dynamic serving context (NEVER frozen in cache)
  const headspace = buildHeadspace(candCtx.activePursuits, candCtx.attentionWindow);

  // 2. Apply headspace filter to intrinsic verb0
  const headspaceOutcome = applyHeadspaceFilter(
    cached.intrinsicVerdict as any,
    headspace
  );
  const finalVerb = headspaceOutcome.finalVerb;

  // 3. Assemble dynamic EngineRecommendationV4 view model
  const engineRec: EngineRecommendationV4 = {
    jobHash: cached.jobHash,
    evaluationFingerprint: cached.evaluationInputHash,
    engineVerdict: finalVerb as any,
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

  // 4. Compute independent 3-state truth: Effective Decision & Review State
  const effectiveDecision = computeEffectiveDecision(engineRec, userDecision);
  const reviewWorkflowState = computeReviewWorkflowState(engineRec, userDecision);

  // 5. Dynamic narrative synthesis for headspace downgrade
  const finalRecommendation = headspaceOutcome.downgraded && headspaceOutcome.reason
    ? `${headspaceOutcome.reason} ${cached.baseNarrative.baseRecommendationProse}`
    : cached.baseNarrative.baseRecommendationProse;

  // 6. UI badge & score resolution
  const displayScore = cached.intrinsicQualityScore !== null ? `${Math.round(cached.intrinsicQualityScore)}%` : "—";
  const uiBadge = cached.vetoed
    ? { label: "Vetoed", variant: "pass" as const }
    : finalVerb === "PURSUE"
      ? { label: "Recommended", variant: "signal" as const }
      : finalVerb === "CONSIDER"
        ? { label: "Consider", variant: "caution" as const }
        : { label: "Pass", variant: "muted" as const };

  return {
    jobHash: cached.jobHash,
    title: oppCtx.title,
    company: oppCtx.company,
    location: oppCtx.location,
    decision: userDecision?.userAction && userDecision.userAction !== "NONE" ? userDecision.userAction : finalVerb,
    effectiveDecision,
    reviewWorkflowState,
    qualityScore: cached.intrinsicQualityScore,
    displayScore,
    uiBadge,
    headspaceSaturated: headspace.saturated,
    headspaceDowngraded: headspaceOutcome.downgraded,
    recommendation: finalRecommendation,
    engineRecommendation: engineRec,
    userDecision,
  };
}

describe("Phase 4A: Canonical Candidate Evaluation Contract Unit Tests", () => {
  const sampleIntrinsic: CanonicalIntrinsicEvaluationPayload = {
    schemaVersion: "v4.2-intrinsic",
    jobHash: "job_xyz_123",
    personId: "swapnil-shukla",
    evaluationInputHash: "eval_hash_canonical_v1",
    policyVersion: "policy-v4.3",
    ontologyVersion: "v2",
    evaluatedAt: "2026-08-18T10:00:00.000Z",
    intrinsicVerdict: "PURSUE",
    intrinsicQualityScore: 91,
    parsingConfidence: 0.94,
    vetoed: false,
    vetoReason: null,
    triggeredRuleIds: ["HIGH_SP_STRONG_MANDATE"],
    decisionRisks: [],
    decisionDrivers: [{ factor: "Mandate Scale", impact: "positive", strength: "high" }],
    evaluationStatus: "COMPLETE",
    dimensions: [],
    esi: 0.88,
    diligenceStatus: "READY",
    baseNarrative: {
      whyNow: "Expansion inflection",
      positioning: "Commercial Growth Leader",
      primaryProof: "Scaled P&L $0 to $50M",
      hiringRisk: "Executive reporting line ambiguity",
      alternativePath: "VP Marketing",
      baseRecommendationProse: "Proceed this week; strong executive fit.",
    },
    auditTrace: {
      careerValue: 88,
      shortlistingPotential: 92,
      pursuitFriction: 0,
      rawScore: 91,
      evidenceMappingCount: 6,
    },
  };

  const sampleOppCtx: ServingOpportunityContext = {
    title: "Chief Growth Officer",
    company: "Acme Corp",
    location: "Bengaluru (Hybrid)",
  };

  it("1. Headspace under capacity serves pure intrinsic PURSUE", () => {
    const candCtx: ServingCandidateContext = {
      personId: "swapnil-shukla",
      attentionWindow: 6,
      activePursuits: 2, // Under capacity (2 < 6)
    };

    const served = serveEvaluation(sampleIntrinsic, candCtx, sampleOppCtx, null);

    expect(served.headspaceSaturated).toBe(false);
    expect(served.headspaceDowngraded).toBe(false);
    expect(served.engineRecommendation.engineVerdict).toBe("PURSUE");
    expect(served.effectiveDecision).toBe("ENGINE_PURSUIT");
    expect(served.reviewWorkflowState).toBe("UNREVIEWED");
    expect(served.uiBadge.variant).toBe("signal");
    expect(served.recommendation).toBe("Proceed this week; strong executive fit.");
  });

  it("2. Headspace at capacity dynamically downgrades PURSUE to CONSIDER without mutating intrinsic cache", () => {
    const candCtxSaturated: ServingCandidateContext = {
      personId: "swapnil-shukla",
      attentionWindow: 6,
      activePursuits: 6, // At capacity (6 >= 6)
    };

    const served = serveEvaluation(sampleIntrinsic, candCtxSaturated, sampleOppCtx, null);

    expect(served.headspaceSaturated).toBe(true);
    expect(served.headspaceDowngraded).toBe(true);
    expect(served.engineRecommendation.engineVerdict).toBe("CONSIDER");
    expect(served.effectiveDecision).toBe("ENGINE_CONSIDER");
    expect(served.uiBadge.variant).toBe("caution");
    expect(served.recommendation).toContain("You are at capacity (6/6 active pursuits)");
    expect(served.recommendation).toContain("Proceed this week; strong executive fit.");

    // Verify intrinsic cache remains unchanged (verb0 = PURSUE)
    expect(sampleIntrinsic.intrinsicVerdict).toBe("PURSUE");
  });

  it("3. Serving layer correctly reconciles explicit user decision overrides", () => {
    const candCtx: ServingCandidateContext = {
      personId: "swapnil-shukla",
      attentionWindow: 6,
      activePursuits: 1,
    };

    const userDecision: UserDecisionStateV4 = {
      personId: "swapnil-shukla",
      jobHash: "job_xyz_123",
      userAction: "PASS",
      reviewedFingerprint: "eval_hash_canonical_v1",
      updatedAt: "2026-08-18T10:15:00.000Z",
    };

    const served = serveEvaluation(sampleIntrinsic, candCtx, sampleOppCtx, userDecision);

    expect(served.decision).toBe("PASS");
    expect(served.effectiveDecision).toBe("USER_PASSED");
    expect(served.reviewWorkflowState).toBe("REVIEWED_CURRENT");
    expect(served.userDecision).toEqual(userDecision);
  });
});
