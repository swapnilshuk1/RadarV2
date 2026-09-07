import {
  resolveServingDecision,
  resolveServingReviewState,
  toCanonicalServingVerdict,
  type CanonicalReviewState,
  type CanonicalServingVerdict,
  type UserAction,
} from "../../../domain/decision_v4";

export type CanonicalEvaluationState =
  | "EVALUATED"
  | "SPARSE_SPEC"
  | "NOT_EVALUABLE"
  | "PROFILE_REQUIRED"
  | "ACQUISITION_PENDING"
  | "ACQUISITION_FAILED"
  | "EXPIRED"
  | "INVALID"
  | "UNMATERIALIZED"
  | "UNKNOWN";

export type CanonicalServingDecisionReadModel = {
  readonly evaluationState: CanonicalEvaluationState;
  readonly engineVerdict: CanonicalServingVerdict;
  readonly userDecision: UserAction | null;
  readonly effectiveDecision: CanonicalServingVerdict;
  /** Identifies the context in which the artifact was produced; never review identity. */
  readonly evaluationContextFingerprint: string | null;
  /** Exact immutable intrinsic artifact/input identity used for review provenance. */
  readonly evaluationFingerprint: string | null;
  readonly reviewedFingerprint: string | null;
  readonly reviewState: CanonicalReviewState;
  readonly qualityScore: number | null;
};

/** The single semantic interpretation used by both feed and dossier. */
export function resolveCanonicalServingReadModel(input: {
  evaluationState: CanonicalEvaluationState;
  engineVerdict: unknown;
  userDecision: UserAction | null;
  evaluationContextFingerprint: string | null;
  evaluationFingerprint: string | null;
  reviewedFingerprint: string | null;
  qualityScore: number | null;
}): CanonicalServingDecisionReadModel {
  const requestedState = input.evaluationState;
  const evaluatedVerdict = toCanonicalServingVerdict(input.engineVerdict);
  const validScore = typeof input.qualityScore === "number"
    && Number.isFinite(input.qualityScore)
    && input.qualityScore >= 0
    && input.qualityScore <= 100;
  const validEvaluationFingerprint = typeof input.evaluationFingerprint === "string"
    && input.evaluationFingerprint.trim().length > 0;
  // An EVALUATED row is a claim about a complete canonical artifact. Never turn
  // malformed derived data into a plausible recommendation at the read boundary.
  const evaluationState = requestedState === "EVALUATED"
    && (evaluatedVerdict === "UNKNOWN" || !validScore || !validEvaluationFingerprint)
    ? "INVALID"
    : requestedState;
  const engineVerdict = evaluationState === "EVALUATED"
    ? evaluatedVerdict
    : "UNKNOWN";
  const userDecision = input.userDecision;
  return {
    evaluationState,
    engineVerdict,
    userDecision,
    effectiveDecision: resolveServingDecision(engineVerdict, userDecision),
    evaluationContextFingerprint: input.evaluationContextFingerprint,
    evaluationFingerprint: validEvaluationFingerprint ? input.evaluationFingerprint : null,
    reviewedFingerprint: input.reviewedFingerprint,
    reviewState: resolveServingReviewState(
      validEvaluationFingerprint ? input.evaluationFingerprint : null,
      userDecision,
      input.reviewedFingerprint,
    ),
    qualityScore: evaluationState === "EVALUATED" ? input.qualityScore : null,
  };
}
