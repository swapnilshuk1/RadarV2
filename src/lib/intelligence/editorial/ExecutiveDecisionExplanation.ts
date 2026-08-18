import type { EngineVerdict } from "./EditorialContext";

export type EvidenceStrength = "STRONG" | "MODERATE" | "LIMITED" | "INSUFFICIENT";

export type RecommendedAction =
  | "APPLY"
  | "TAILOR_AND_APPLY"
  | "INVESTIGATE"
  | "PASS"
  | "REASSESS_SCOPE";

export interface ExplanationProvenance {
  readonly source:
    | "DECISION_POLICY"
    | "CAREER_ASSESSMENT"
    | "IDENTITY_ASSESSMENT"
    | "CAPABILITY_ASSESSMENT"
    | "LIFESTYLE_ASSESSMENT"
    | "CANDIDATE_EVIDENCE"
    | "JOB_REQUIREMENT";
  readonly ruleIds?: readonly string[];
  readonly evidenceIds?: readonly string[];
  readonly signal?: string;
}

export interface ExecutiveDecisionExplanation {
  readonly verdict: EngineVerdict | null;

  readonly headline: string;
  readonly bottomLine: string;

  readonly primaryReason: string;
  readonly supportingReasons: readonly string[];

  readonly careerValueSignal: string | null;
  readonly tradeoff: string | null;

  readonly evidenceStrength: EvidenceStrength;
  readonly keyUncertainty: string | null;

  readonly recommendedAction: RecommendedAction;

  readonly ruleIds: readonly string[];

  readonly provenance: readonly ExplanationProvenance[];
}
