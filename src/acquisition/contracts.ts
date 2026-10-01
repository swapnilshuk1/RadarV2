export type AcquisitionFeedState =
  | "NOT_PURSUED"
  | "READY"
  | "PREPARING"
  | "PROCESSING"
  | "WAITING"
  | "NEEDS_ATTENTION"
  | "OUTSIDE_SEARCH";

export interface AcquisitionFeedRow {
  readonly id: string;
  readonly version: string;
  readonly jobHash: string;
  readonly role: string;
  readonly company: string;
  readonly location: string;
  readonly source: string;
  readonly state: AcquisitionFeedState;
  readonly decision: string | null;
}

export interface AttentionGateExplanation {
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly impact: "match" | "review" | "exclude";
}

export interface ScreeningDriverDetail {
  readonly id: string;
  readonly requirement: string;
  readonly strength: string;
  readonly status: string;
  readonly reasoning?: string;
  readonly screeningReasoning?: string;
  readonly mappingReasoning?: string;
  readonly gapNature?: string;
  readonly gapReasoning?: string;
}

export interface ScrapedJobDetail {
  readonly id: string;
  readonly version: string;
  readonly jobHash: string;
  readonly role: string;
  readonly company: string;
  readonly location: string;
  readonly source: string;
  readonly canonicalUrl: string | null;
  readonly applyUrl: string | null;
  readonly postedAt: string | null;
  readonly capturedAt: string | null;
  readonly description: string;
  readonly state: AcquisitionFeedState;
  readonly decision: string | null;

  readonly attentionGate: {
    readonly decision: "CANDIDATE" | "NOT_CANDIDATE";
    readonly eligibility: string | null;
    readonly reasonCodes: string[];
    readonly explanations: AttentionGateExplanation[];
    readonly locationPolicy: string | null;
    readonly locationEvidence: string | null;
    readonly createdAt: string;
  } | null;

  readonly evaluation: {
    readonly state: string | null;
    readonly verdict: string | null;
    readonly screeningViability: string | null;
    readonly blockedReason: string | null;
    readonly evaluatedAt: string | null;
    readonly modelId: string | null;
    readonly qualityScore: number | null;
    readonly rationale: string | null;
    readonly screeningDrivers: ScreeningDriverDetail[];
    readonly decisionHinges?: Array<{ requirementIds: string[]; resolutionFields?: string[] }>;
  } | null;

  readonly diagnostics: {
    readonly stage: string;
    readonly status: string;
    readonly details: string;
    readonly recoveryReason: string | null;
    readonly error: string | null;
  };
}
