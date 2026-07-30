// src/lib/intelligence/editorial/PresentationEngine.ts

import type { BriefModel } from "./BriefModel";

export type SectionEmphasis = "HERO" | "PRIMARY" | "SECONDARY" | "SUPPORTING" | "COLLAPSED";
export type DensityToken = "SPACIOUS" | "STANDARD" | "COMPACT";
export type ContrastToken = "ACCENT" | "CARD" | "SUBTLE" | "GHOST";
export type DisclosureToken = "EXPANDED" | "COLLAPSED" | "HIDDEN";

export type SectionId = "CAREER" | "DELIVERABLES" | "FIT" | "UNKNOWNS" | "EVIDENCE";

export interface PresentationSection {
  id: SectionId;
  priority: number;
  emphasis: SectionEmphasis;
  density: DensityToken;
  contrast: ContrastToken;
  disclosure: DisclosureToken;
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
   * Pure Semantic Presentation Function: Emits a declarative PresentationModel with zero CSS coupling.
   */
  public static compose(brief: BriefModel): PresentationModel {
    const { primaryFocus } = brief.strategy;

    // Role-based presentation policy mapping primaryFocus -> section priority & semantic tokens
    let sections: PresentationSection[] = [
      { id: "FIT", priority: 1, emphasis: "PRIMARY", density: "STANDARD", contrast: "CARD", disclosure: "EXPANDED" },
      { id: "DELIVERABLES", priority: 2, emphasis: "PRIMARY", density: "STANDARD", contrast: "CARD", disclosure: "EXPANDED" },
      { id: "CAREER", priority: 3, emphasis: "SECONDARY", density: "STANDARD", contrast: "SUBTLE", disclosure: "EXPANDED" },
      { id: "UNKNOWNS", priority: 4, emphasis: "SECONDARY", density: "STANDARD", contrast: "SUBTLE", disclosure: "EXPANDED" },
      { id: "EVIDENCE", priority: 5, emphasis: "COLLAPSED", density: "COMPACT", contrast: "GHOST", disclosure: "COLLAPSED" },
    ];

    if (primaryFocus === "CAREER") {
      sections = [
        { id: "CAREER", priority: 1, emphasis: "HERO", density: "SPACIOUS", contrast: "ACCENT", disclosure: "EXPANDED" },
        { id: "DELIVERABLES", priority: 2, emphasis: "PRIMARY", density: "STANDARD", contrast: "CARD", disclosure: "EXPANDED" },
        { id: "FIT", priority: 3, emphasis: "PRIMARY", density: "STANDARD", contrast: "CARD", disclosure: "EXPANDED" },
        { id: "UNKNOWNS", priority: 4, emphasis: "SECONDARY", density: "STANDARD", contrast: "SUBTLE", disclosure: "EXPANDED" },
        { id: "EVIDENCE", priority: 5, emphasis: "COLLAPSED", density: "COMPACT", contrast: "GHOST", disclosure: "COLLAPSED" },
      ];
    } else if (primaryFocus === "COMMERCIAL" || primaryFocus === "EXECUTION") {
      sections = [
        { id: "DELIVERABLES", priority: 1, emphasis: "HERO", density: "SPACIOUS", contrast: "ACCENT", disclosure: "EXPANDED" },
        { id: "FIT", priority: 2, emphasis: "PRIMARY", density: "STANDARD", contrast: "CARD", disclosure: "EXPANDED" },
        { id: "CAREER", priority: 3, emphasis: "SECONDARY", density: "STANDARD", contrast: "SUBTLE", disclosure: "EXPANDED" },
        { id: "UNKNOWNS", priority: 4, emphasis: "SECONDARY", density: "STANDARD", contrast: "SUBTLE", disclosure: "EXPANDED" },
        { id: "EVIDENCE", priority: 5, emphasis: "COLLAPSED", density: "COMPACT", contrast: "GHOST", disclosure: "COLLAPSED" },
      ];
    } else if (primaryFocus === "RISK" || primaryFocus === "UNKNOWN") {
      sections = [
        { id: "UNKNOWNS", priority: 1, emphasis: "HERO", density: "SPACIOUS", contrast: "ACCENT", disclosure: "EXPANDED" },
        { id: "FIT", priority: 2, emphasis: "PRIMARY", density: "STANDARD", contrast: "CARD", disclosure: "EXPANDED" },
        { id: "DELIVERABLES", priority: 3, emphasis: "SECONDARY", density: "STANDARD", contrast: "SUBTLE", disclosure: "EXPANDED" },
        { id: "CAREER", priority: 4, emphasis: "SECONDARY", density: "STANDARD", contrast: "SUBTLE", disclosure: "EXPANDED" },
        { id: "EVIDENCE", priority: 5, emphasis: "COLLAPSED", density: "COMPACT", contrast: "GHOST", disclosure: "COLLAPSED" },
      ];
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
   * Mapping Layer: Maps semantic presentation tokens to Tailwind design system tokens.
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
