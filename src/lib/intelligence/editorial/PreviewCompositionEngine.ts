import type { Opportunity } from "../../../data/opportunity-fixtures";
import { EditorialContextBuilder } from "./EditorialContext";
import { EditorialPatternSelector } from "./EditorialPatternSelector";
import { NarrativeComposer } from "./NarrativeComposer";

export interface PreviewFragment {
  headline: string;
  narrative: string;
  whyItWorks: string;
  watchFor: string;
}

export class PreviewCompositionEngine {
  /**
   * Translates the core truth (Opportunity) into the "Preview" cognitive stage using
   * the Editorial Pattern & Narrative Composition pipeline.
   */
  static compose(opportunity: Opportunity): PreviewFragment {
    try {
      const ctx = EditorialContextBuilder.build(opportunity);
      const pattern = EditorialPatternSelector.select(ctx, opportunity.jobHash);
      const composed = NarrativeComposer.compose(pattern, opportunity);

      return {
        headline: composed.headline,
        narrative: composed.opening,
        whyItWorks: composed.decisionGuidance.proceedIf,
        watchFor: composed.decisionGuidance.pauseIf,
      };
    } catch (err) {
      console.error("PreviewCompositionEngine error:", err);
      // Safe fallback
      let headline = opportunity.mandateArchetype || "Commercial expansion opportunity.";
      if (!headline.endsWith(".") && !headline.endsWith("!") && !headline.endsWith("?")) {
        headline = headline + ".";
      }

      return {
        headline,
        narrative: opportunity.recommendation || "",
        whyItWorks: opportunity.primaryDriver || "Strategic alignment with your profile.",
        watchFor: opportunity.primaryRisk || "Standard organizational alignment review.",
      };
    }
  }
}
