/**
 * src/lib/intelligence/decision-resolver.ts
 *
 * RADAR V4 Canonical Effective Decision Resolver (Phase M8.2).
 *
 * Defines the single, deterministic resolution logic for an opportunity's effective decision
 * taking into account:
 * 1. Search-plan candidate attention status (Attention Gate)
 * 2. Active Evaluation Context
 * 3. Materialized Engine Evaluation (verb0, quality score, veto)
 * 4. User Decision State (PURSUE, CONSIDER, PASS)
 *
 * PRECEDENCE TRUTH TABLE:
 * -----------------------------------------------------------------------------------------
 * Attention Decision | Engine Verdict | User Action | Effective Decision  | Narrative Role
 * -------------------|----------------|-------------|---------------------|----------------
 * NOT_CANDIDATE      | *              | NONE        | NOT_EVALUABLE       | Screened Out
 * CANDIDATE          | *              | PASS        | USER_PASSED         | User Veto
 * CANDIDATE          | PURSUE         | PURSUE      | USER_CONFIRMED      | Consensus High
 * CANDIDATE          | CONSIDER       | PURSUE      | PREFERENCE_OVERRIDE | User Priority
 * CANDIDATE          | PASS (or Veto) | PURSUE      | VETO_OVERRIDE       | Overruled Risk
 * CANDIDATE          | CONSIDER       | CONSIDER    | ENGINE_CONSIDER     | Evaluated Mid
 * CANDIDATE          | PASS / PURSUE  | CONSIDER    | PREFERENCE_OVERRIDE | User Evaluated
 * CANDIDATE          | PURSUE         | NONE        | ENGINE_PURSUIT      | Recommended
 * CANDIDATE          | CONSIDER       | NONE        | ENGINE_CONSIDER     | Under Review
 * CANDIDATE          | PASS           | NONE        | ENGINE_PASS         | Low Fit
 * CANDIDATE          | SPARSE_SPEC    | NONE        | NOT_EVALUABLE       | Sparse Signal
 * CANDIDATE          | null / missing | NONE        | NOT_EVALUABLE       | Unmaterialized
 * -----------------------------------------------------------------------------------------
 */

import type {
  EngineVerdict,
  UserAction,
  EffectiveDecision,
  EngineRecommendationV4,
  UserDecisionStateV4,
} from "../../domain/decision_v4";

export interface CanonicalDecisionInputs {
  readonly attentionDecision: "CANDIDATE" | "NOT_CANDIDATE";
  readonly engineVerdict: EngineVerdict | null;
  readonly vetoed?: boolean;
  readonly qualityScore?: number | null;
  readonly userAction: UserAction;
}

export function resolveEffectiveDecision(inputs: CanonicalDecisionInputs): EffectiveDecision {
  const { attentionDecision, engineVerdict, vetoed, userAction } = inputs;

  // 1. User explicit action always takes top precedence if passed
  if (userAction === "PASS") {
    return "USER_PASSED";
  }

  // 2. User explicit action: PURSUE
  if (userAction === "PURSUE") {
    if (vetoed || engineVerdict === "PASS") return "VETO_OVERRIDE";
    if (engineVerdict === "PURSUE") return "USER_CONFIRMED";
    if (engineVerdict === "CONSIDER") return "PREFERENCE_OVERRIDE";
    return "USER_CONFIRMED";
  }

  // 3. User explicit action: CONSIDER
  if (userAction === "CONSIDER") {
    if (engineVerdict === "CONSIDER") return "ENGINE_CONSIDER";
    return "PREFERENCE_OVERRIDE";
  }

  // 4. Attention Gate filtering (if no user action was taken)
  if (attentionDecision === "NOT_CANDIDATE") {
    return "NOT_EVALUABLE";
  }

  // 5. Engine Verdict (User Action is NONE)
  if (!engineVerdict || engineVerdict === "SPARSE_SPEC") {
    return "NOT_EVALUABLE";
  }

  if (engineVerdict === "PURSUE") {
    return "ENGINE_PURSUIT";
  }

  if (engineVerdict === "CONSIDER") {
    return "ENGINE_CONSIDER";
  }

  return "ENGINE_PASS";
}
