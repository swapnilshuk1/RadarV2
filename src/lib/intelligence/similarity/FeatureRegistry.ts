// src/lib/intelligence/similarity/FeatureRegistry.ts

import { SimilarityFeatureProvider, SimilarityContribution, SimilarityResult } from "./SimilarityTypes";
import type { Opportunity } from "../../../data/opportunity-fixtures";

export interface FeatureRegistryItem {
  provider: SimilarityFeatureProvider;
  weight: number;
  enabled: boolean;
  version: string;
}

export class FeatureRegistry {
  private static registry: Map<string, FeatureRegistryItem> = new Map();

  public static register(name: string, provider: SimilarityFeatureProvider, weight: number, enabled: boolean = true, version: string = "1.0.0") {
    this.registry.set(name, { provider, weight, enabled, version });
  }

  public static getActiveProviders(): { name: string; item: FeatureRegistryItem }[] {
    return Array.from(this.registry.entries())
      .filter(([_, item]) => item.enabled)
      .map(([name, item]) => ({ name, item }));
  }

  public static async calculateSimilarity(
    candidate: any,
    opportunity: Opportunity,
    versionId: string = "14.2.1"
  ): Promise<SimilarityResult> {
    const active = this.getActiveProviders();
    const contributions: SimilarityContribution[] = [];

    let weightedSum = 0;
    let totalWeight = 0;

    for (const { name, item } of active) {
      try {
        const contrib = await item.provider.calculateScore(candidate, opportunity, versionId);
        contributions.push(contrib);
        weightedSum += contrib.contributionValue;
        totalWeight += contrib.weight;
      } catch (err) {
        console.warn(`[FeatureRegistry] Feature provider ${name} failed:`, err);
      }
    }

    const totalProximityScore = totalWeight > 0 ? Math.min(1.0, Math.max(0.0, weightedSum / totalWeight)) : 0.50;

    return {
      totalProximityScore,
      versionId,
      contributions,
    };
  }
}
