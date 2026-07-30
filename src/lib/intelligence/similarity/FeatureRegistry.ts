// src/lib/intelligence/similarity/FeatureRegistry.ts

import { SimilarityFeatureProvider, SimilarityContribution, SimilarityResult } from "./SimilarityTypes";
import { GraphDistanceProvider } from "./GraphDistanceProvider";
import { CareerTrajectoryProvider } from "./CareerTrajectoryProvider";
import { IndustryAdjacencyProvider } from "./IndustryAdjacencyProvider";
import type { Opportunity } from "../../../data/opportunity-fixtures";

export interface FeatureRegistryItem {
  provider: SimilarityFeatureProvider;
  weight: number;
  enabled: boolean;
  version: string;
}

export class FeatureRegistry {
  private static registry: Map<string, FeatureRegistryItem> = new Map();
  private static initialized: boolean = false;

  public static initializeDefaultProviders() {
    if (this.initialized) return;
    this.register("GraphDistanceProvider", new GraphDistanceProvider(), 0.35);
    this.register("CareerTrajectoryProvider", new CareerTrajectoryProvider(), 0.35);
    this.register("IndustryAdjacencyProvider", new IndustryAdjacencyProvider(), 0.30);
    this.initialized = true;
  }

  public static register(name: string, provider: SimilarityFeatureProvider, weight: number, enabled: boolean = true, version: string = "1.0.0") {
    this.registry.set(name, { provider, weight, enabled, version });
  }

  public static getActiveProviders(): { name: string; item: FeatureRegistryItem }[] {
    this.initializeDefaultProviders();
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
