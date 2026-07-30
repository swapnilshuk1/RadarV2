import type { BriefModel } from "./BriefModel";
import type { SectionEmphasis } from "./PresentationEngine";

export interface StyleClasses {
  sectionPadding: string;
  titleSize: string;
  cardBorder: string;
  bgTint: string;
  isHero: boolean;
}

export type SectionType = "CAREER" | "DELIVERABLES" | "FIT" | "UNKNOWNS" | "EVIDENCE";

export class LayoutEngine {
  /**
   * Returns ordered list of sections based on primary and secondary focus.
   */
  public static getSectionOrder(brief: BriefModel): SectionType[] {
    const { primaryFocus } = brief.strategy;

    if (primaryFocus === "CAREER") {
      return ["CAREER", "DELIVERABLES", "FIT", "UNKNOWNS", "EVIDENCE"];
    }
    if (primaryFocus === "COMMERCIAL" || primaryFocus === "EXECUTION") {
      return ["DELIVERABLES", "FIT", "CAREER", "UNKNOWNS", "EVIDENCE"];
    }
    if (primaryFocus === "RISK" || primaryFocus === "UNKNOWN") {
      return ["UNKNOWNS", "FIT", "DELIVERABLES", "CAREER", "EVIDENCE"];
    }
    return ["FIT", "DELIVERABLES", "CAREER", "UNKNOWNS", "EVIDENCE"];
  }

  /**
   * Returns Tailwind styling classes based on SectionEmphasis.
   */
  public static getSectionStyle(weight: SectionEmphasis): StyleClasses {
    switch (weight) {
      case "HERO":
        return {
          sectionPadding: "py-12 px-6 sm:px-8 bg-card/40 border border-accent-ink/30 rounded-lg my-6 shadow-md",
          titleSize: "text-[32px] sm:text-[40px]",
          cardBorder: "border-2 border-accent-ink/60",
          bgTint: "bg-accent-ink/5",
          isHero: true,
        };
      case "PRIMARY":
        return {
          sectionPadding: "py-10 px-4 sm:px-6 border-b border-border/80 my-4",
          titleSize: "text-[26px] sm:text-[34px]",
          cardBorder: "border border-border/80",
          bgTint: "bg-card",
          isHero: false,
        };
      case "SECONDARY":
        return {
          sectionPadding: "py-8 px-4 border-b border-border/60 my-2",
          titleSize: "text-[22px] sm:text-[28px]",
          cardBorder: "border border-border/60",
          bgTint: "bg-background",
          isHero: false,
        };
      case "SUPPORTING":
        return {
          sectionPadding: "py-6 px-3 border-b border-border/40",
          titleSize: "text-[18px] sm:text-[22px]",
          cardBorder: "border border-border/40",
          bgTint: "bg-muted/10",
          isHero: false,
        };
      case "COLLAPSED":
      default:
        return {
          sectionPadding: "py-4 px-3 border-b border-border/30",
          titleSize: "text-[16px]",
          cardBorder: "border border-border/30",
          bgTint: "bg-background",
          isHero: false,
        };
    }
  }
}
