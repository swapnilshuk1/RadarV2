// src/lib/intelligence/editorial/EditorialCompositionEngine.ts

import type { BriefModel } from "./BriefModel";
import type { NarrativeModel } from "./NarrativeModel";

export class EditorialCompositionEngine {
  /**
   * Translates the BriefModel strategy into human-readable editorial expression.
   * Maintains completely stable identity for chapters, but adapts expression
   * and selectively injects Decision Bridges based on strategy.
   */
  public static compose(brief: BriefModel): NarrativeModel {
    const { primaryFocus, narrative } = brief.strategy;
    const score = brief.score;

    // 1. CAREER (THE CASE)
    let careerExpression = "Should you pursue this opportunity?";
    if (primaryFocus === "CAREER") {
      careerExpression = "Consider this recommendation against your long-term trajectory.";
    } else if (primaryFocus === "COMMERCIAL") {
      careerExpression = "Read against the ambition of scaling P&L and commercial authority.";
    }

    let careerDecisionBridge: string | undefined = undefined;
    if (primaryFocus === "CAREER") {
      careerDecisionBridge = "If you accept this trajectory, the next question is whether the day-to-day mandate aligns with your operating style.";
    } else {
      careerDecisionBridge = "You've decided this career trade is worthwhile. Now ask whether the operating model matches your strengths.";
    }

    // 2. DELIVERABLES (THE ROLE)
    let roleExpression = "What success looks like.";
    if (primaryFocus === "COMMERCIAL") {
      roleExpression = "The commercial scale and P&L mandate you will inherit.";
    } else if (primaryFocus === "TRANSFORMATION") {
      roleExpression = "The transformation roadmap you will be expected to execute.";
    }

    let roleDecisionBridge: string | undefined = undefined;
    if (score >= 80) {
      roleDecisionBridge = "Assuming you can deliver against that mandate, what gives you an unfair advantage over competing candidates?";
    }

    // 3. FIT (YOUR ADVANTAGE)
    let fitExpression = "Why you're unusually well positioned.";
    if (narrative.intent === "COMPETITIVE_ADVANTAGE") {
      fitExpression = "Where your experience creates a moat that will be difficult for competing candidates to match.";
    } else if (narrative.intent === "LEVERAGE_POINT") {
      fitExpression = "Why this company is likely to trust you quickly.";
    }

    // 4. UNKNOWNS (OPEN QUESTIONS)
    let unknownsExpression = "What remains uncertain.";
    if (brief.certaintyLevel === "LOW") {
      unknownsExpression = "These are critical uncertainties that must be resolved before committing.";
    } else if (brief.topUnknownPreview) {
      unknownsExpression = "These answers could strengthen—or weaken—the recommendation.";
    }

    // 5. EVIDENCE (SUPPORTING EVIDENCE)
    const evidenceExpression = "How RADAR reached this conclusion.";

    return {
      sections: {
        CAREER: {
          identity: "THE CASE",
          expression: careerExpression,
          decisionBridge: careerDecisionBridge,
        },
        DELIVERABLES: {
          identity: "THE ROLE",
          expression: roleExpression,
          decisionBridge: roleDecisionBridge,
        },
        FIT: {
          identity: "YOUR ADVANTAGE",
          expression: fitExpression,
        },
        UNKNOWNS: {
          identity: "OPEN QUESTIONS",
          expression: unknownsExpression,
        },
        EVIDENCE: {
          identity: "SUPPORTING EVIDENCE",
          expression: evidenceExpression,
        },
      },
    };
  }
}
