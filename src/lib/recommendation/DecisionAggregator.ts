/**
 * DecisionAggregator.ts
 *
 * Normalizes weighted scores and maps decisions to threshold bands.
 * Compiles rich, structured, deterministic narrative explanations from matched capability details.
 */
import type { CapabilityContribution } from "./ContributionCalculator";

export type DecisionLabel = "Excellent" | "Good" | "Average" | "Weak Fit" | "Needs More Evidence";

export interface RecommendationResult {
  score: number;                 // Normalized score [0 - 100]
  decision: DecisionLabel;
  policyId: string;
  policyVersion: string;
  capabilityResults: CapabilityContribution[];
  explanation: string;
  generatedAt: string;
}

export class DecisionAggregator {
  /**
   * Aggregates capability contributions against policy thresholds into a finalized RecommendationResult.
   */
  public aggregate(
    contributions: CapabilityContribution[],
    policyId: string,
    policyVersion: string,
    thresholds: Record<string, [number, number]>
  ): RecommendationResult {
    let totalWeightedContribution = 0;
    let totalMaxPossibleWeight = 0;

    for (const contrib of contributions) {
      totalWeightedContribution += contrib.weightedContribution;
      totalMaxPossibleWeight += contrib.weight;
    }

    // Normalized Score [0 - 100]
    const normalizedScore = totalMaxPossibleWeight > 0
      ? Math.round((totalWeightedContribution / totalMaxPossibleWeight) * 100)
      : 0;

    // Resolve Decision Label
    let decision: DecisionLabel = "Needs More Evidence";
    for (const [label, range] of Object.entries(thresholds)) {
      if (normalizedScore >= range[0] && normalizedScore < range[1]) {
        decision = label as DecisionLabel;
        break;
      }
    }

    // Build Deterministic Explanation Narrative
    const explanation = this.compileExplanation(decision, normalizedScore, contributions);

    return {
      score: normalizedScore,
      decision,
      policyId,
      policyVersion,
      capabilityResults: contributions,
      explanation,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Compiles dynamic, structural markdown narrative explanations.
   */
  private compileExplanation(
    decision: DecisionLabel,
    score: number,
    contributions: CapabilityContribution[]
  ): string {
    const strengths = contributions.filter(c => c.score >= 0.4);
    const gaps = contributions.filter(c => c.score < 0.4);

    let markdown = `### Recommendation Decision: **${decision}** (${score}/100)\n\n`;

    if (strengths.length > 0) {
      markdown += `#### Key Strengths & Core Competencies:\n`;
      for (const st of strengths) {
        const percent = Math.round(st.score * 100);
        markdown += `* **${st.capabilityName}** (${percent}% Match, Strength: *${st.strength}*)\n`;
        if (st.supportingEvidence.length > 0) {
          const quotes = st.supportingEvidence
            .map(ev => `"${ev.quote?.trim()}" [Matched: ${ev.matchedValue}]`)
            .join("; ");
          markdown += `  - *Evidence Provenance*: ${quotes}\n`;
        }
      }
      markdown += `\n`;
    }

    if (gaps.length > 0) {
      markdown += `#### Identified Gaps & Areas for Further Diligence:\n`;
      for (const gap of gaps) {
        const percent = Math.round(gap.score * 100);
        if (gap.score === 0.0) {
          markdown += `* **${gap.capabilityName}** (0% Match, Strength: *Absent*)\n`;
          markdown += `  - *Diligence Note*: No verified evidence matching this capability was found in the source documents.\n`;
        } else {
          markdown += `* **${gap.capabilityName}** (${percent}% Match, Strength: *${gap.strength}*)\n`;
          if (gap.supportingEvidence.length > 0) {
            const quotes = gap.supportingEvidence
              .map(ev => `"${ev.quote?.trim()}"`)
              .join("; ");
            markdown += `  - *Diligence Note*: Limited evidence found: ${quotes}\n`;
          }
        }
      }
    }

    return markdown;
  }
}
