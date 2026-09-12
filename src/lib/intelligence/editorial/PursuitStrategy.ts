import type { EngineVerdict } from "./EditorialContext";

export type EffortLevel =
  | "DEEP"
  | "TARGETED"
  | "LIGHT"
  | "INVESTIGATE_FIRST"
  | "DO_NOT_INVEST";

export type PursuitMode =
  | "DIRECT_APPLICATION"
  | "TAILOR_THEN_APPLY"
  | "INVESTIGATE_THEN_DECIDE"
  | "CLARIFY_SCOPE"
  | "PASS";

export type TailoringDepth =
  | "NONE"
  | "LIGHT"
  | "TARGETED"
  | "DEEP";

export type PursuitActionPriority = "PRIMARY" | "SECONDARY";

export type PursuitActionType =
  | "DIRECT_APPLICATION"
  | "TAILOR_RESUME"
  | "TAILOR_LINKEDIN"
  | "PREPARE_INTERVIEW"
  | "INVESTIGATE_ROLE"
  | "CLARIFY_SCOPE"
  | "VERIFY_REPORTING_LINE"
  | "VERIFY_COMPENSATION"
  | "PASS";

export interface PursuitAction {
  readonly type: PursuitActionType;
  readonly priority: PursuitActionPriority;
  readonly label: string;
  readonly rationale: string;
  readonly estimatedEffort?: string;
}

export type StrategyRuleId =
  | "PURSUE_DEEP_STRONG_EVIDENCE"
  | "PURSUE_TARGETED_MODERATE_EVIDENCE"
  | "PURSUE_TARGETED_LIMITED_EVIDENCE"
  | "PURSUE_INVESTIGATE_LIMITED_EVIDENCE"
  | "CONSIDER_LIMITED_CAREER_UPSIDE"
  | "CONSIDER_ORDINARY_PLAUSIBILITY"
  | "CAREER_REGRESSION_SCOPE_CHECK"
  | "MATERIAL_UNCERTAINTY_INVESTIGATION"
  | "SPARSE_SPECIFICATION_INVESTIGATION"
  | "PASS_NO_INVESTMENT"
  | "EVALUATION_INCOMPLETE";

export interface PursuitStrategyProvenance {
  readonly source: "DECISION_EXPLANATION" | "CAREER_POLICY" | "EVIDENCE_GATE" | "UNCERTAINTY_SIGNAL";
  readonly ruleId: StrategyRuleId;
  readonly signal?: string;
}

export interface PursuitStrategy {
  readonly engineVerdict: EngineVerdict | null;
  readonly effortLevel: EffortLevel;
  readonly pursuitMode: PursuitMode;
  readonly tailoringDepth: TailoringDepth;
  readonly ruleId: StrategyRuleId;
  readonly executiveLabel: string;
  readonly headline: string;
  readonly bottomLine: string;
  readonly whyThisEffortLevel: string;
  readonly immediateNextAction: string;
  readonly actions: readonly PursuitAction[];
  readonly keyDependency?: string;
  readonly stopCondition: string;
  readonly provenance: readonly PursuitStrategyProvenance[];
}
