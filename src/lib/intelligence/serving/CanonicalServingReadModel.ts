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
  | "INVALID"
  | "UNMATERIALIZED";

export type CanonicalServingDecisionReadModel = {
  readonly evaluationState: CanonicalEvaluationState;
  readonly engineVerdict: CanonicalServingVerdict;
  readonly userDecision: UserAction | null;
  readonly effectiveDecision: CanonicalServingVerdict;
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
  evaluationFingerprint: string | null;
  reviewedFingerprint: string | null;
  qualityScore: number | null;
}): CanonicalServingDecisionReadModel {
  const engineVerdict = input.evaluationState === "EVALUATED"
    ? toCanonicalServingVerdict(input.engineVerdict)
    : "UNKNOWN";
  const userDecision = input.userDecision;
  return {
    evaluationState: input.evaluationState,
    engineVerdict,
    userDecision,
    effectiveDecision: resolveServingDecision(engineVerdict, userDecision),
    evaluationFingerprint: input.evaluationFingerprint,
    reviewedFingerprint: input.reviewedFingerprint,
    reviewState: resolveServingReviewState(input.evaluationFingerprint, userDecision, input.reviewedFingerprint),
    qualityScore: input.evaluationState === "EVALUATED" ? input.qualityScore : null,
  };
}
