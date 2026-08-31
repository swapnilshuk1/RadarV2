import type { EvaluationState } from "./canonical_acquisition";

export type { EvaluationState };

export interface EvaluationMetrics {
  overallScore: number | null;       // Normalized [0..100], null if un-evaluable / sparse
  capabilityFitScore: number | null; // [0..100]
  alignmentScore: number | null;     // [0..100]
  evidenceSufficiencyIndex: number; // ESI [0.0..1.0]
  certainty: number;          // [0.0..1.0]
}

export interface EvaluationFindings {
  strengths: Array<{
    capability: string;
    statement: string;
    matchingEvidenceIds: string[];
  }>;
  gaps: Array<{
    capability: string;
    description: string;
    severity: "CRITICAL" | "MODERATE" | "MINOR";
  }>;
  contextualRisks: string[];
  marketUrgencyNotes?: string;
}

export interface EvaluationResult {
  jobHash: string;
  evaluationState: EvaluationState;
  metrics: EvaluationMetrics;
  findings: EvaluationFindings;
  recommendation: {
    verb: "PURSUE" | "CONSIDER" | "PASS" | "SPARSE_SPEC" | null;
    rationale: string;
    primaryConcern?: string;
  };
  evaluatedAt: string;
}
