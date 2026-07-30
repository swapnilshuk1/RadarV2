import type { Opportunity } from "../../../data/opportunity-fixtures";
import { BriefCompositionEngine } from "./BriefCompositionEngine";

export interface PreviewFragment {
  headline: string;
  narrative: string;
  whyItWorks: string;
  watchFor: string;
}

export class PreviewCompositionEngine {
  /**
   * Translates the core truth (Opportunity) into the "Preview" cognitive stage.
   * Answers: "Should I invest five minutes reading this?"
   */
  static compose(opportunity: Opportunity): PreviewFragment {
    const brief = BriefCompositionEngine.compose(opportunity);

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
