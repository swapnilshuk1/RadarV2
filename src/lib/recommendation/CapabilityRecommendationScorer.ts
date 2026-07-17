/**
 * CapabilityRecommendationScorer.ts
 *
 * Orchestrates the thin Decision Engine.
 * Evaluates continuous capability score inputs against declarative policy weights and thresholds.
 */
import { type EvaluatedCapability } from "../capability/CapabilityEngine";
import { ContributionCalculator, type CapabilityContribution } from "./ContributionCalculator";
import { DecisionAggregator, type RecommendationResult, type DecisionLabel } from "./DecisionAggregator";
import defaultPolicy from "../../../config/policies/recommendation-policy.json";

export interface RecommendationPolicyConfig {
  id: string;
  version: string;
  description: string;
  author: string;
  created: string;
  weights: Record<string, number>;
  decisionThresholds: Record<string, [number, number]>;
}

export class CapabilityRecommendationScorer {
  private calculator = new ContributionCalculator();
  private aggregator = new DecisionAggregator();
  private policy: RecommendationPolicyConfig;

  constructor(policyConfig?: RecommendationPolicyConfig) {
    this.policy = policyConfig || (defaultPolicy as RecommendationPolicyConfig);
  }

  /**
   * Evaluates capability inputs against policy and outputs a structured RecommendationResult decision.
   */
  public score(
    evaluatedCapabilities: EvaluatedCapability[],
    policyOverride?: RecommendationPolicyConfig
  ): RecommendationResult {
    const activePolicy = policyOverride || this.policy;

    // 1. Calculate weighted capability contributions
    const contributions = this.calculator.calculate(evaluatedCapabilities, activePolicy.weights);

    // 2. Normalize and aggregate finalized decisions
    return this.aggregator.aggregate(
      contributions,
      activePolicy.id,
      activePolicy.version,
      activePolicy.decisionThresholds
    );
  }

  /**
   * Helper to retrieve currently loaded policy.
   */
  public getPolicy(): RecommendationPolicyConfig {
    return this.policy;
  }
}
