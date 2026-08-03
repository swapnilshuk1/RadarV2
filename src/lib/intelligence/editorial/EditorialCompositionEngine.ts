// src/lib/intelligence/editorial/EditorialCompositionEngine.ts

import type { BriefModel } from "./BriefModel";
import type { NarrativeModel } from "./NarrativeModel";

export class EditorialCompositionEngine {
  /**
   * Translates the BriefModel strategy into human-readable editorial expression
   * across all 9 page-hierarchy sections.
   */
  public static compose(brief: BriefModel): NarrativeModel {
    const { primaryFocus, narrative } = brief.strategy;
    const score = brief.score;

    // 1. STRATEGIC_CAREER_VALUE
    const strategicValueExpression = "Key strategic levers and career capital upside.";

    // 2. EXPLAINABLE_REASONING
    const reasoningExpression = "Multi-layer reasoning chain backed by evidence precedent.";

    // 3. THE_CASE
    let caseExpression = "Should you pursue this opportunity?";
    if (primaryFocus === "CAREER") {
      caseExpression = "Consider this recommendation against your long-term trajectory.";
    } else if (primaryFocus === "COMMERCIAL") {
      caseExpression = "Read against the ambition of scaling P&L and commercial authority.";
    }

    let caseDecisionBridge: string | undefined = undefined;
    if (primaryFocus === "CAREER") {
      caseDecisionBridge = "If you accept this trajectory, the next question is whether the day-to-day mandate aligns with your operating style.";
    } else {
      caseDecisionBridge = "You've decided this career trade is worthwhile. Now ask whether the operating model matches your strengths.";
    }

    // 4. THE_ROLE
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

    // 5. YOUR_ADVANTAGE
    let advantageExpression = "Evidence-backed alignment.";
    if (narrative.intent === "COMPETITIVE_ADVANTAGE") {
      advantageExpression = "Where your experience creates a moat that will be difficult for competing candidates to match.";
    } else if (narrative.intent === "LEVERAGE_POINT") {
      advantageExpression = "Why this company is likely to trust you quickly.";
    }

    // 6. OPEN_QUESTIONS
    let questionsExpression = "Screening priorities & recruiter call checklist.";
    if (brief.certaintyLevel === "LOW") {
      questionsExpression = "These are critical uncertainties that must be resolved before committing.";
    } else if (brief.topUnknownPreview) {
      questionsExpression = "These answers could strengthen—or weaken—the recommendation.";
    }

    // 7. DECISION_BOUNDARIES
    const boundariesExpression = "Actionable boundary conditions and trade-off limits.";

    // 8. SUPPORTING_EVIDENCE
    const evidenceExpression = "Forensic evidence signals verified across JD and candidate profile.";

    // 9. DOSSIER_LEDGER
    const ledgerExpression = "Supporting dossier ledger & verified claims inventory.";

    return {
      sections: {
        STRATEGIC_CAREER_VALUE: {
          identity: "STRATEGIC CAREER VALUE",
          expression: strategicValueExpression,
        },
        EXPLAINABLE_REASONING: {
          identity: "EXPLAINABLE REASONING",
          expression: reasoningExpression,
        },
        THE_CASE: {
          identity: "THE CASE",
          expression: caseExpression,
          decisionBridge: caseDecisionBridge,
        },
        THE_ROLE: {
          identity: "THE ROLE",
          expression: roleExpression,
          decisionBridge: roleDecisionBridge,
        },
        YOUR_ADVANTAGE: {
          identity: "YOUR ADVANTAGE",
          expression: advantageExpression,
        },
        OPEN_QUESTIONS: {
          identity: "OPEN QUESTIONS",
          expression: questionsExpression,
        },
        DECISION_BOUNDARIES: {
          identity: "DECISION BOUNDARIES",
          expression: boundariesExpression,
        },
        SUPPORTING_EVIDENCE: {
          identity: "SUPPORTING EVIDENCE",
          expression: evidenceExpression,
        },
        DOSSIER_LEDGER: {
          identity: "DOSSIER LEDGER",
          expression: ledgerExpression,
        },
      },
    };
  }
}
