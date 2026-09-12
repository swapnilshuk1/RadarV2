export interface EvaluationMetrics {
  overallScore: number;       // Normalized [0..100]
  capabilityFitScore: number; // [0..100]
  alignmentScore: number;     // [0..100]
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
  metrics: EvaluationMetrics;
  findings: EvaluationFindings;
  recommendation: {
    verb: "PURSUE" | "CONSIDER" | "PASS";
    rationale: string;
    primaryConcern?: string;
  };
  evaluatedAt: string;
}
