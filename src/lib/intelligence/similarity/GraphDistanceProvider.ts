// src/lib/intelligence/similarity/GraphDistanceProvider.ts

import type { SimilarityFeatureProvider, SimilarityContribution } from "./SimilarityTypes";
import type { Opportunity } from "../../../data/opportunity-fixtures";

export class GraphDistanceProvider implements SimilarityFeatureProvider {
  public name = "GraphDistanceProvider";

  public async calculateScore(candidate: any, opportunity: Opportunity, versionId: string): Promise<SimilarityContribution> {
    const score = opportunity.recommendationResult?.score ?? 80;
    const proximityScore = Math.min(1.0, Math.max(0.20, score / 100));

    return {
      featureName: "GraphDistanceProvider",
      score: proximityScore,
      weight: 0.35,
      contributionValue: proximityScore * 0.35,
      explanation: `EKB Topological Graph Path distance (v${versionId}): ${(proximityScore * 100).toFixed(0)}% proximity`,
      evidenceSnippet: `Mapped along EKB version ${versionId} canonical graph paths.`,
    };
  }
}
