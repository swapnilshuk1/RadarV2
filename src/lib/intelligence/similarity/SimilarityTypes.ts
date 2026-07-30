// src/lib/intelligence/similarity/SimilarityTypes.ts

import type { Opportunity } from "../../../data/opportunity-fixtures";

export interface CandidateProjectionPlaceholder {
  id: string;
  name: string;
  titles: string[];
  capabilities: string[];
  domains: string[];
}

export interface SimilarityContribution {
  featureName: string;
  score: number;              // 0.00 to 1.00
  weight: number;             // Configured feature weight
  contributionValue: number;  // score * weight
  explanation: string;        // Human-readable executive reason
  evidenceSnippet?: string;   // Supporting CV/JD quote
}

export interface SimilarityResult {
  totalProximityScore: number;
  versionId: string;
  contributions: SimilarityContribution[];
}

export interface SimilarityFeatureProvider {
  name: string;
  calculateScore(candidate: any, opportunity: Opportunity, versionId: string): Promise<SimilarityContribution>;
}

export interface SimilarityConfiguration {
  weights: Record<string, number>;
}
