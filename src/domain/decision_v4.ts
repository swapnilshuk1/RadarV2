/**
 * src/domain/decision_v4.ts
 *
 * RADAR V4 Pure Domain Model: Decision State, Review State, and Homogeneous Population Ranking.
 *
 * Invariant: Maintains three independent, un-overwritable truths:
 * 1. RADAR'S BELIEF (Engine Recommendation & Evaluation)
 * 2. USER'S INTENT (User Action & Preference)
 * 3. REVIEW WORKFLOW STATE (Whether the user has reviewed the CURRENT evaluation)
 */

export type EngineVerdict = "PURSUE" | "CONSIDER" | "PASS" | "SPARSE_SPEC";

export type UserAction = "PURSUE" | "CONSIDER" | "PASS" | "NONE";

export type ReviewWorkflowState =
  | "UNREVIEWED"
  | "REVIEWED_CURRENT"
  | "REVIEWED_STALE"
  | "REVIEWED_UNKNOWN";

export type EffectiveDecision =
  | "ENGINE_PURSUIT"       // Engine PURSUE, User NONE
  | "USER_CONFIRMED"       // Engine PURSUE, User PURSUE
  | "PREFERENCE_OVERRIDE"  // Engine CONSIDER, User PURSUE
  | "VETO_OVERRIDE"        // Engine PASS + vetoed, User PURSUE
  | "USER_PASSED"          // User PASS (regardless of engine)
  | "ENGINE_PASS"          // Engine PASS, User NONE
  | "ENGINE_CONSIDER"      // Engine CONSIDER, User NONE
  | "NOT_EVALUABLE";       // Engine SPARSE_SPEC / Insufficient signals

export interface DecisionDriver {
  readonly factor: string;
  readonly impact: "positive" | "negative";
  readonly strength: "high" | "medium" | "low";
  readonly evidence?: string;
}

export interface EngineRecommendationV4 {
  readonly jobHash: string;
  readonly evaluationFingerprint: string;
  readonly engineVerdict: EngineVerdict;
  readonly verb0?: EngineVerdict;
  readonly headspaceVerdict?: EngineVerdict;
  readonly headspaceDowngraded?: boolean;
  readonly headspaceReason?: string;
  readonly vetoed: boolean;
  readonly vetoReason: string | null;
  readonly qualityScore: number | null; // Model C authoritative continuous quality score (0..100 or null)
  readonly parsingConfidence: number;   // 0.0..1.0
  readonly evaluatedAt: string;
  readonly triggeredRuleIds?: string[];
  readonly decisionRisks?: DecisionDriver[];
  readonly decisionDrivers?: DecisionDriver[];
  readonly relativeDifferentiator?: string;
  readonly opportunityScoreConfidence?: "HIGH" | "LOW";
  readonly opportunityScoreSource?: "EXPLICIT" | "FALLBACK";
  readonly trajectoryUpside?: string;
  readonly careerRegressionScore?: number | null;
  readonly careerValueProtection?: string | null;
}

export interface UserDecisionStateV4 {
  readonly personId: string;
  readonly jobHash: string;
  readonly userAction: UserAction;
  readonly reviewedFingerprint?: string | null;
  readonly updatedAt?: string | null;
}

/**
 * Pure function: Computes Effective Decision from Engine State + User State.
 * Does NOT mutate engine state or user state.
 */
export function computeEffectiveDecision(
  engine: EngineRecommendationV4,
  user: UserDecisionStateV4 | null | undefined
): EffectiveDecision {
  const action = user?.userAction || "NONE";

  if (action === "NONE") {
    if (engine.engineVerdict === "PURSUE") return "ENGINE_PURSUIT";
    if (engine.engineVerdict === "CONSIDER") return "ENGINE_CONSIDER";
    if (engine.engineVerdict === "SPARSE_SPEC") return "NOT_EVALUABLE";
    return "ENGINE_PASS";
  }

  if (action === "PASS") {
    return "USER_PASSED";
  }

  if (action === "CONSIDER") {
    if (engine.engineVerdict === "CONSIDER") return "ENGINE_CONSIDER";
    return "PREFERENCE_OVERRIDE";
  }

  if (action === "PURSUE") {
    if (engine.engineVerdict === "PURSUE") return "USER_CONFIRMED";
    if (engine.engineVerdict === "CONSIDER") return "PREFERENCE_OVERRIDE";
    if (engine.vetoed || engine.engineVerdict === "PASS") return "VETO_OVERRIDE";
    if (engine.engineVerdict === "SPARSE_SPEC") return "NOT_EVALUABLE";
  }

  return "ENGINE_PASS";
}

/**
 * Pure function: Computes Review Workflow State from Engine State + User State.
 * 
 * Rules:
 * - No user decision -> UNREVIEWED
 * - User decision without recorded evaluation fingerprint (legacy record) -> REVIEWED_UNKNOWN
 * - User decision with matching fingerprint -> REVIEWED_CURRENT
 * - User decision with different fingerprint -> REVIEWED_STALE
 */
export function computeReviewWorkflowState(
  engine: EngineRecommendationV4,
  user: UserDecisionStateV4 | null | undefined
): ReviewWorkflowState {
  if (!user || !user.userAction || user.userAction === "NONE") {
    return "UNREVIEWED";
  }

  // If user reviewed with NO recorded evaluation fingerprint (legacy record)
  if (!user.reviewedFingerprint) {
    return "REVIEWED_UNKNOWN";
  }

  // If user reviewed with a recorded evaluation fingerprint
  return user.reviewedFingerprint === engine.evaluationFingerprint
    ? "REVIEWED_CURRENT"
    : "REVIEWED_STALE";
}

/**
 * Population Tier for Homogeneous Queue Sorter.
 * Guarantees that overridden vetoes or un-evaluable items NEVER outrank genuine engine pursuits.
 */
export enum RankingPopulationTier {
  TIER_0_ENGINE_RECOMMENDED = 0, // Genuine Engine Pursuits (ENGINE_PURSUIT, USER_CONFIRMED)
  TIER_1_PREFERENCE_OVERRIDE = 1, // Engine CONSIDER -> User PURSUE
  TIER_2_VETO_OVERRIDE = 2,       // Engine PASS/Vetoed -> User PURSUE (Quarantined at bottom of Pursue list)
  TIER_3_ENGINE_CONSIDER = 3,     // Engine CONSIDER (No user decision or User CONSIDER)
  TIER_4_NOT_EVALUABLE = 4,       // SPARSE_SPEC / Insufficient signals
  TIER_5_PASS_ARCHIVE = 5,        // USER_PASSED, ENGINE_PASS
}

export function determinePopulationTier(
  effective: EffectiveDecision,
  engine: EngineRecommendationV4
): RankingPopulationTier {
  switch (effective) {
    case "ENGINE_PURSUIT":
    case "USER_CONFIRMED":
      return RankingPopulationTier.TIER_0_ENGINE_RECOMMENDED;
    case "PREFERENCE_OVERRIDE":
      return RankingPopulationTier.TIER_1_PREFERENCE_OVERRIDE;
    case "VETO_OVERRIDE":
      return RankingPopulationTier.TIER_2_VETO_OVERRIDE;
    case "ENGINE_CONSIDER":
      return RankingPopulationTier.TIER_3_ENGINE_CONSIDER;
    case "NOT_EVALUABLE":
      return RankingPopulationTier.TIER_4_NOT_EVALUABLE;
    case "USER_PASSED":
    case "ENGINE_PASS":
    default:
      return RankingPopulationTier.TIER_5_PASS_ARCHIVE;
  }
}
