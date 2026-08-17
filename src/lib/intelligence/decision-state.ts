import type { DecisionVerb } from "../../data/opportunity-fixtures";

export type UserDecisionState =
  | "NONE"
  | "CURRENT"
  | "STALE"
  | "UNVERIFIABLE";

export interface DossierDecisionState {
  /**
   * Primary RADAR Engine Recommendation Verdict.
   * Authoritative source: o.engineRecommendation.engineVerdict ONLY.
   * If missing/null, must be null (UI displays RECOMMENDATION UNAVAILABLE).
   */
  engineVerdict: DecisionVerb | null;

  /**
   * Persisted user choice (if any).
   */
  userDecision: DecisionVerb | null;

  /**
   * 4-State freshness classification comparing user decision fingerprint vs current evaluation fingerprint.
   */
  userDecisionState: UserDecisionState;

  /**
   * UI-ONLY action control highlight state.
   *
   * CONTRACT INVARIANT:
   * MUST NOT be consumed by:
   * - editorial composition
   * - recommendation badge rendering
   * - scoring
   * - policy logic
   * - narrative generation
   */
  selectedActionForControls: DecisionVerb | null;

  /**
   * Authoritative current evaluation fingerprint.
   * Authoritative source: o.engineRecommendation.evaluationFingerprint ONLY.
   */
  evaluationFingerprint: string | null;

  /**
   * Reviewed fingerprint stored at the time user made their decision.
   */
  userDecisionFingerprint: string | null;
}

/**
 * Resolves canonical dossier decision state strictly following RADAR V4 invariants.
 *
 * Invariant Rules:
 * 1. engineVerdict strictly derives from o.engineRecommendation?.engineVerdict ONLY.
 * 2. evaluationFingerprint strictly derives from o.engineRecommendation?.evaluationFingerprint ONLY.
 * 3. userDecisionState is CURRENT iff both fingerprints exist and match.
 * 4. userDecisionState is STALE iff both fingerprints exist and differ.
 * 5. userDecisionState is UNVERIFIABLE if userDecision exists but either fingerprint is missing.
 * 6. userDecisionState is NONE if no userDecision exists.
 */
export function resolveDossierDecisionState(
  o: any,
  userDecisionRecord?: { verb: DecisionVerb; reviewedFingerprint?: string | null } | null
): DossierDecisionState {
  // 1. Single Authoritative Engine Verdict (No Fallbacks!)
  const rawEngineVerdict = o?.engineRecommendation?.engineVerdict;
  const engineVerdict: DecisionVerb | null =
    rawEngineVerdict === "PURSUE" || rawEngineVerdict === "CONSIDER" || rawEngineVerdict === "PASS"
      ? rawEngineVerdict
      : null;

  // 2. Single Authoritative Evaluation Fingerprint (No Fallbacks!)
  const evaluationFingerprint: string | null =
    typeof o?.engineRecommendation?.evaluationFingerprint === "string" && o.engineRecommendation.evaluationFingerprint.length > 0
      ? o.engineRecommendation.evaluationFingerprint
      : null;

  // 3. User Decision & Fingerprint
  const userDecision: DecisionVerb | null =
    userDecisionRecord?.verb === "PURSUE" || userDecisionRecord?.verb === "CONSIDER" || userDecisionRecord?.verb === "PASS"
      ? userDecisionRecord.verb
      : null;

  const userDecisionFingerprint: string | null =
    typeof userDecisionRecord?.reviewedFingerprint === "string" && userDecisionRecord.reviewedFingerprint.length > 0
      ? userDecisionRecord.reviewedFingerprint
      : null;

  // 4. 4-State User Decision Freshness Classification
  let userDecisionState: UserDecisionState = "NONE";
  if (!userDecision) {
    userDecisionState = "NONE";
  } else if (!evaluationFingerprint || !userDecisionFingerprint) {
    userDecisionState = "UNVERIFIABLE";
  } else if (userDecisionFingerprint !== evaluationFingerprint) {
    userDecisionState = "STALE";
  } else {
    userDecisionState = "CURRENT";
  }

  // 5. UI-Only Action Control Highlight
  const selectedActionForControls: DecisionVerb | null = userDecision ?? engineVerdict;

  return {
    engineVerdict,
    userDecision,
    userDecisionState,
    selectedActionForControls,
    evaluationFingerprint,
    userDecisionFingerprint,
  };
}
