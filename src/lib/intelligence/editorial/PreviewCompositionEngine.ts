import type { Opportunity } from "../../../data/opportunity-fixtures";
import { EditorialContextBuilder } from "./EditorialContext";
import { EditorialPatternSelector } from "./EditorialPatternSelector";
import { NarrativeComposer } from "./NarrativeComposer";
import { AdvisoryConstitution } from "./AdvisoryConstitution";

export interface PreviewFragment {
  headline: string;
  narrative: string;
  whyItWorks: string;
  watchFor: string;
}

export class PreviewCompositionEngine {
  private static evidenceLimitedPreview(opportunity: Opportunity, message?: string): PreviewFragment {
    const role = opportunity.role || "this role";
    const company = opportunity.company || "the company";
    const limitation = message || "The available evidence is insufficient for an executive recommendation.";
    return {
      headline: `Assessment pending: ${role} at ${company}.`,
      narrative: limitation,
      whyItWorks: "Proceed only after the recruiter confirms the mandate, reporting line, and available resources.",
      watchFor: "Pause application preparation until the published scope is verified.",
    };
  }

  /**
   * Translates the core truth (Opportunity) into the "Preview" cognitive stage using
   * the Editorial Pattern & Narrative Composition pipeline.
   */
  static compose(opportunity: Opportunity, options?: { bypassHistory?: boolean }): PreviewFragment {
    const sufficiency = AdvisoryConstitution.validateDataSufficiency(opportunity);
    if (!sufficiency.isSufficient) {
      return this.evidenceLimitedPreview(opportunity, sufficiency.message);
    }

    try {
      const ctx = EditorialContextBuilder.build(opportunity);
      const pattern = EditorialPatternSelector.select(ctx, opportunity.jobHash, options?.bypassHistory);
      const composed = NarrativeComposer.compose(pattern, opportunity);

      return {
        headline: composed.headline,
        narrative: composed.opening || composed.headline,
        whyItWorks: composed.decisionGuidance.proceedIf,
        watchFor: composed.decisionGuidance.pauseIf,
      };
    } catch (err) {
      console.error("PreviewCompositionEngine error:", err);
      return this.evidenceLimitedPreview(
        opportunity,
        "Editorial composition is unavailable. Confirm the mandate, reporting line, and decision rights before drawing a conclusion.",
      );
    }
  }
}
