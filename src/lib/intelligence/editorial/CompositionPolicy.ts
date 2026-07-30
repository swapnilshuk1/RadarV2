// src/lib/intelligence/editorial/CompositionPolicy.ts

export interface CompositionPolicy {
  maxEvidence: number;
  maxUnknowns: number;
  maxRisks: number;
  confidenceThreshold: number;
  collapseEvidenceByDefault: boolean;
}

export const DEFAULT_COMPOSITION_POLICY: CompositionPolicy = {
  maxEvidence: 3,
  maxUnknowns: 3,
  maxRisks: 2,
  confidenceThreshold: 0.8,
  collapseEvidenceByDefault: true,
};
