export interface RecommendationPolicy {
  id: string;
  version: string;
  name: string;
  description: string;
  createdAt: string;
  author: string;
  status: "CHAMPION" | "CANDIDATE" | "ARCHIVED";
  weights: Record<string, number>;
  thresholds: {
    confidenceCutoff: number;
  };
  decisionThresholds: {
    excellent: number;
    good: number;
    average: number;
  };
  dimensionRules?: Record<string, any>;
  partialScoringRules?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface PolicyComparison {
  id: string;
  timestamp: string;
  championPolicyId: string;
  candidatePolicyId: string;
  corpusHash: string;
  profileHash: string;
  stabilityIndex: number;
  volatility: number;
  excellentDelta: number;
  goodDelta: number;
  averageDelta: number;
  weakDelta: number;
  insufficientEvidenceDelta: number;
  winner: string;
  metadata?: Record<string, any>;
}
