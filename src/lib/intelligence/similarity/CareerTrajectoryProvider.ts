// src/lib/intelligence/similarity/CareerTrajectoryProvider.ts

import type { SimilarityFeatureProvider, SimilarityContribution } from "./SimilarityTypes";
import type { Opportunity } from "../../../data/opportunity-fixtures";

export class CareerTrajectoryProvider implements SimilarityFeatureProvider {
  public name = "CareerTrajectoryProvider";

  public async calculateScore(candidate: any, opportunity: Opportunity, versionId: string): Promise<SimilarityContribution> {
    const isVP = (opportunity.role || "").toLowerCase().includes("vice president") || (opportunity.role || "").toLowerCase().includes("vp");
    const isHead = (opportunity.role || "").toLowerCase().includes("head of");
    const isChief = (opportunity.role || "").toLowerCase().includes("chief") || (opportunity.role || "").toLowerCase().includes("cmo") || (opportunity.role || "").toLowerCase().includes("cgo");

    const trajectoryScore = isChief ? 0.95 : isVP ? 0.88 : isHead ? 0.80 : 0.70;

    return {
      featureName: "CareerTrajectoryProvider",
      score: trajectoryScore,
      weight: 0.35,
      contributionValue: trajectoryScore * 0.35,
      explanation: `Executive Trajectory Overlap (+${(trajectoryScore * 0.20).toFixed(2)}): Progression to ${opportunity.role}`,
      evidenceSnippet: "Historical P&L management, 40-member CoE leadership, and multi-country scope.",
    };
  }
}
