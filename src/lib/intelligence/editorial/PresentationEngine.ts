// src/lib/intelligence/editorial/PresentationEngine.ts

import type { BriefModel, SectionId } from "./BriefModel";
import type { NarrativeModel, EditorialFragment } from "./NarrativeModel";

export type SectionEmphasis = "HERO" | "PRIMARY" | "SECONDARY" | "SUPPORTING" | "COLLAPSED";
export type DensityToken = "SPACIOUS" | "STANDARD" | "COMPACT";
export type ContrastToken = "ACCENT" | "CARD" | "SUBTLE" | "GHOST";
export type DisclosureToken = "EXPANDED" | "COLLAPSED" | "HIDDEN";

export interface PresentationSection {
  id: SectionId;
  priority: number;
  emphasis: SectionEmphasis;
  density: DensityToken;
  contrast: ContrastToken;
  disclosure: DisclosureToken;
  editorial: EditorialFragment;
}

export interface SemanticStyleMapping {
  container: string;
  titleSize: string;
  cardBorder: string;
  bgTint: string;
  isHero: boolean;
}

export interface PresentationModel {
  sections: PresentationSection[];
  capabilityTitle: string;
}

export class PresentationEngine {
  /**
   * Pure Semantic Presentation Function: Emits a declarative PresentationModel across all 9 sections.
   */
  public static compose(brief: BriefModel, narrative: NarrativeModel): PresentationModel {
    const { primaryFocus } = brief.strategy;

    // Default 9 base sections in exact page hierarchy order
    let sections: PresentationSection[] = [
      { id: "STRATEGIC_CAREER_VALUE", priority: 1, emphasis: "SECONDARY", density: "STANDARD", contrast: "SUBTLE", disclosure: "EXPANDED", editorial: narrative.sections.STRATEGIC_CAREER_VALUE },
      { id: "EXPLAINABLE_REASONING", priority: 2, emphasis: "SECONDARY", density: "STANDARD", contrast: "SUBTLE", disclosure: "EXPANDED", editorial: narrative.sections.EXPLAINABLE_REASONING },
      { id: "THE_CASE", priority: 3, emphasis: "PRIMARY", density: "STANDARD", contrast: "CARD", disclosure: "EXPANDED", editorial: narrative.sections.THE_CASE },
      { id: "THE_ROLE", priority: 4, emphasis: "PRIMARY", density: "STANDARD", contrast: "CARD", disclosure: "EXPANDED", editorial: narrative.sections.THE_ROLE },
      { id: "YOUR_ADVANTAGE", priority: 5, emphasis: "PRIMARY", density: "STANDARD", contrast: "CARD", disclosure: "EXPANDED", editorial: narrative.sections.YOUR_ADVANTAGE },
      { id: "OPEN_QUESTIONS", priority: 6, emphasis: "SECONDARY", density: "STANDARD", contrast: "SUBTLE", disclosure: "EXPANDED", editorial: narrative.sections.OPEN_QUESTIONS },
      { id: "DECISION_BOUNDARIES", priority: 7, emphasis: "SECONDARY", density: "STANDARD", contrast: "SUBTLE", disclosure: "EXPANDED", editorial: narrative.sections.DECISION_BOUNDARIES },
      { id: "SUPPORTING_EVIDENCE", priority: 8, emphasis: "COLLAPSED", density: "COMPACT", contrast: "GHOST", disclosure: "COLLAPSED", editorial: narrative.sections.SUPPORTING_EVIDENCE },
      { id: "DOSSIER_LEDGER", priority: 9, emphasis: "SECONDARY", density: "STANDARD", contrast: "SUBTLE", disclosure: "EXPANDED", editorial: narrative.sections.DOSSIER_LEDGER },
    ];

    // Modify emphasis based on primary focus
    if (primaryFocus === "CAREER") {
      sections[2].emphasis = "HERO";
      sections[2].density = "SPACIOUS";
      sections[2].contrast = "ACCENT";
    } else if (primaryFocus === "COMMERCIAL" || primaryFocus === "EXECUTION") {
      sections[3].emphasis = "HERO";
      sections[3].density = "SPACIOUS";
      sections[3].contrast = "ACCENT";
    } else if (primaryFocus === "RISK" || primaryFocus === "UNKNOWN") {
      sections[5].emphasis = "HERO";
      sections[5].density = "SPACIOUS";
      sections[5].contrast = "ACCENT";
    }

    let capabilityTitle = "Why this role fits your experience";
    if (brief.strategy.narrative.intent === "COMPETITIVE_ADVANTAGE") {
      capabilityTitle = "Your Three Unfair Advantages";
    } else if (brief.strategy.narrative.intent === "LEVERAGE_POINT") {
      capabilityTitle = "Your Strongest Leverage Point";
    }

    return {
      sections,
      capabilityTitle,
    };
  }

  /**
   * Mapping Layer: Maps semantic presentation tokens to design system tokens.
   */
  public static mapTokensToClasses(section: PresentationSection): SemanticStyleMapping {
    const { emphasis } = section;
    switch (emphasis) {
      case "HERO":
        return {
          container: "py-10 px-6 sm:px-8 bg-card border-2 border-accent-ink/50 rounded-xl my-8 shadow-md ring-1 ring-accent-ink/20",
          titleSize: "text-[32px] sm:text-[40px]",
          cardBorder: "border-2 border-accent-ink/60",
          bgTint: "bg-accent-ink/5",
          isHero: true,
        };
      case "PRIMARY":
        return {
          container: "py-10 border-b border-border my-6",
          titleSize: "text-[26px] sm:text-[34px]",
          cardBorder: "border border-border/80",
          bgTint: "bg-card",
          isHero: false,
        };
      case "SECONDARY":
        return {
          container: "py-8 border-b border-border/70 my-4",
          titleSize: "text-[22px] sm:text-[28px]",
          cardBorder: "border border-border/60",
          bgTint: "bg-background",
          isHero: false,
        };
      case "SUPPORTING":
        return {
          container: "py-6 border-b border-border/50 my-2",
          titleSize: "text-[18px] sm:text-[22px]",
          cardBorder: "border border-border/40",
          bgTint: "bg-muted/10",
          isHero: false,
        };
      case "COLLAPSED":
      default:
        return {
          container: "py-6 border-b border-border/40 my-2",
          titleSize: "text-[16px] sm:text-[18px]",
          cardBorder: "border border-border/30",
          bgTint: "bg-background",
          isHero: false,
        };
    }
  }
}
