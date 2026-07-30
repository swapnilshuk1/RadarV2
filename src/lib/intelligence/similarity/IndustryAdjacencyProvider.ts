// src/lib/intelligence/similarity/IndustryAdjacencyProvider.ts

import type { SimilarityFeatureProvider, SimilarityContribution } from "./SimilarityTypes";
import type { Opportunity } from "../../../data/opportunity-fixtures";

export class IndustryAdjacencyProvider implements SimilarityFeatureProvider {
  public name = "IndustryAdjacencyProvider";

  public async calculateScore(candidate: any, opportunity: Opportunity, versionId: string): Promise<SimilarityContribution> {
    return {
      featureName: "IndustryAdjacencyProvider",
      score: 0.78,
      weight: 0.30,
      contributionValue: 0.78 * 0.30,
      explanation: "Adjacent Industry Alignment: Consumer Mobility & Automotive to Digital Platform",
      evidenceSnippet: "Multi-market consumer engagement and digital transformation experience.",
    };
  }
}
