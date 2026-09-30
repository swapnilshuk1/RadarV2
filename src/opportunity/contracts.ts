import type { DecisionConfidence } from "@/domain/entities";

export type EvidenceSource = "title" | "snippet" | "location" | "llm";
export type Status = "Explicit" | "Inferred" | "Missing";
export type DecisionVerb = "PURSUE" | "CONSIDER" | "PASS" | "UNKNOWN" | "NOT_EVALUABLE" | "SPARSE_SPEC";
export type ScrapeSource = "LinkedIn" | "Naukri" | "Indeed" | "Unknown";

export type Traced<T> = {
  value: T | null;
  status: Status;
  evidence: { quote: string; source: EvidenceSource }[];
};

export type DimensionKey =
  | "requiredLevel"
  | "reportingLine"
  | "mandate"
  | "commercialAccountability"
  | "functionalScope"
  | "functionalCategory"
  | "geography"
  | "workModel"
  | "technologyStack";

export type EvidenceBucket = "Matched" | "Adjacent" | "Missing" | "Contradicted";

export type DimensionResult = {
  key: DimensionKey;
  label: string;
  importance: "Core" | "Supporting" | "Context";
  bucket: EvidenceBucket;
  jdEvidence: Traced<string>;
  candidateProof?: { headline: string; detail: string };
};

export interface CapabilityCardViewModel {
  id: string;
  name: string;
  description: string;
  strength: "Strong" | "Moderate" | "Weak";
  score: number;
  scorePercentage: number;
  evidenceQuote: string;
  dimensionLabel: string;
  weight?: number;
  weightedContribution?: number;
}

export interface RecommendationViewModel {
  score: number | null;
  decision: string;
  policyId: string;
  policyVersion: string;
  explanation: string;
  capabilities: CapabilityCardViewModel[];
  decisionConfidence?: DecisionConfidence;
  vetoed?: boolean;
  vetoReason?: string | null;
}

export type EvaluatedOpportunity = {
  evaluationState: "EVALUATED" | "COMPLETE" | "LEGACY";
  jobHash: string;
  role: string;
  company: string;
  location: string;
  postedRelative: string;
  scrapedFrom: ScrapeSource;
  decision: DecisionVerb;
  recommendation: string;
  whyNow?: string;
  primaryConcern: { dimension: DimensionKey; jdQuote: string } | null;
  positioning: string[];
  primaryProof?: { headline: string; detail: string };
  headspace: Array<{ action: string; benefit: string; effort: "Low" | "Medium" | "High" }>;
  headspaceInvestment?: {
    estimateHours: string;
    window: string;
    leverage: string;
    optional?: string[];
  };
  dimensions: DimensionResult[];
  applyUrl?: string;
  hiringRisk: string;
  alternativePath?: string;
  recommendationResult?: RecommendationViewModel;
  esi?: number;
  diligenceStatus?: "READY" | "INSUFFICIENT" | "STALE" | "FAILED" | "UNKNOWN";
  recommendationArchetype?: string;
  recommendationArchetypeTagline?: string;
  mandateArchetype?: string;
  primaryDriver?: string;
  secondaryDriver?: string;
  primaryRisk?: string;
  tailoringEffort?: "LOW" | "MODERATE" | "HIGH";
  capabilityAlignmentText?: string;
  recommendedAction?: string;
  engineRecommendation?: import("@/domain/decision_v4").EngineRecommendationV4;
  userDecision?: import("@/domain/decision_v4").UserDecisionStateV4 | null;
  effectiveDecision?: import("@/domain/decision_v4").EffectiveDecision;
  reviewWorkflowState?: import("@/domain/decision_v4").ReviewWorkflowState;
  reviewState?: import("@/domain/decision_v4").CanonicalReviewState;
  evaluationContextFingerprint?: string | null;
  evaluationFingerprint?: string | null;
  displayScore?: string;
  uiBadge?: { label: string; variant: "signal" | "caution" | "pass" | "muted" };
  richDossier?: import("@/dossier/contracts").Dossier;
  memoReviewState?: "preparing" | "preparation_attention" | "review_attention" | "reviewed" | "withheld";
};

export type OpportunitySource = {
  evaluationState?: "LEGACY" | "EVALUATED";
  opportunityVersion?: string;
} & Omit<
  EvaluatedOpportunity,
  | "evaluationState"
  | "decision"
  | "recommendation"
  | "whyNow"
  | "positioning"
  | "primaryProof"
  | "headspace"
  | "headspaceInvestment"
  | "hiringRisk"
  | "alternativePath"
> & {
  rawText?: string;
  normalizedText?: string;
  description?: string;
  rawDescription?: string;
  whyNow?: string;
  positioning?: string[];
  primaryProof?: { headline: string; detail: string };
  headspaceInvestment?: {
    estimateHours: string;
    window: string;
    leverage: string;
    optional?: string[];
  };
  hiringRisk?: string;
  alternativePath?: string;
};

export type UnavailableOpportunity = {
  evaluationState: "SPARSE_SPEC" | "NOT_EVALUABLE" | "PROFILE_REQUIRED" | "INVALID" | "ACQUISITION_PENDING" | "ACQUISITION_FAILED" | "EXPIRED";
  jobHash: string;
  role: string;
  company: string;
  location: string;
  postedRelative: string;
  scrapedFrom: ScrapeSource;
  applyUrl?: string;
  reasonCode?: string;
  userDecision?: import("@/domain/decision_v4").UserDecisionStateV4 | null;
  effectiveDecision?: import("@/domain/decision_v4").EffectiveDecision;
  reviewState?: import("@/domain/decision_v4").CanonicalReviewState;
  evaluationContextFingerprint?: string | null;
  evaluationFingerprint?: string | null;
};

export type UnmaterializedOpportunity = {
  evaluationState: "UNMATERIALIZED";
  jobHash: string;
  role: string;
  company: string;
  location: string;
  postedRelative: string;
  scrapedFrom: ScrapeSource;
  applyUrl?: string;
  contextFingerprint: string;
  userDecision?: import("@/domain/decision_v4").UserDecisionStateV4 | null;
  effectiveDecision?: import("@/domain/decision_v4").EffectiveDecision;
  reviewState?: import("@/domain/decision_v4").CanonicalReviewState;
  evaluationContextFingerprint?: string | null;
  evaluationFingerprint?: string | null;
};

export type ServedOpportunity = EvaluatedOpportunity | UnavailableOpportunity | UnmaterializedOpportunity;
export type Opportunity = EvaluatedOpportunity;

export function isEvaluated(opp: ServedOpportunity): opp is EvaluatedOpportunity {
  return opp.evaluationState === "COMPLETE" || opp.evaluationState === "EVALUATED" || opp.evaluationState === "LEGACY";
}

export function isUnavailable(opp: ServedOpportunity): opp is UnavailableOpportunity {
  return opp.evaluationState === "SPARSE_SPEC" ||
    opp.evaluationState === "NOT_EVALUABLE" ||
    opp.evaluationState === "PROFILE_REQUIRED" ||
    opp.evaluationState === "INVALID" ||
    opp.evaluationState === "ACQUISITION_PENDING" ||
    opp.evaluationState === "ACQUISITION_FAILED" ||
    opp.evaluationState === "EXPIRED";
}

export function isUnmaterialized(opp: ServedOpportunity): opp is UnmaterializedOpportunity {
  return opp.evaluationState === "UNMATERIALIZED";
}
