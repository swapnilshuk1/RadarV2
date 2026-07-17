/**
 * ContributionCalculator.ts
 *
 * Calculates relative weighted contributions of capabilities based on continuous scores.
 * Distinguishes between completely absent capabilities (zero partial credit) and weakly matched ones.
 */
import type { EvidenceReference } from "../../domain/entities";
import type { EvaluatedCapability } from "../capability/CapabilityEngine";

export interface CapabilityContribution {
  capabilityId: string;
  capabilityName: string;
  score: number;                 // Continuous score [0.0 - 1.0] from evaluation
  strength: "Strong" | "Moderate" | "Weak";
  weight: number;
  weightedContribution: number;  // score * weight
  supportingEvidence: EvidenceReference[];
}

export class ContributionCalculator {
  /**
   * Evaluates and aggregates contributions for every capability declared in the policy weights.
   */
  public calculate(
    evaluatedCapabilities: EvaluatedCapability[],
    weights: Record<string, number>
  ): CapabilityContribution[] {
    const contributions: CapabilityContribution[] = [];

    // Create lookup index of evaluated capabilities
    const capabilityMap = new Map<string, EvaluatedCapability>();
    for (const cap of evaluatedCapabilities) {
      capabilityMap.set(cap.id, cap);
    }

    for (const [capId, weight] of Object.entries(weights)) {
      const cap = capabilityMap.get(capId);

      if (cap) {
        // Matched capability: use continuous score for maximum fidelity
        contributions.push({
          capabilityId: capId,
          capabilityName: cap.name,
          score: cap.score,
          strength: cap.strength,
          weight,
          weightedContribution: Math.round(cap.score * weight * 100) / 100,
          supportingEvidence: cap.supportingEvidence,
        });
      } else {
        // Absent capability: 0 score, Weak strength (indicates no evidence matches)
        contributions.push({
          capabilityId: capId,
          capabilityName: this.beautifyName(capId),
          score: 0.0,
          strength: "Weak",
          weight,
          weightedContribution: 0.0,
          supportingEvidence: [],
        });
      }
    }

    return contributions;
  }

  /**
   * Helper to format human-readable fallback names for absent capabilities.
   */
  private beautifyName(id: string): string {
    return id
      .replace(/^cap_/i, "")
      .replace(/_/g, " ")
      .split(" ")
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
}
