// src/lib/intelligence/editorial/PresentationTokens.ts

import type { AttentionWeight } from "./AttentionEngine";

export class PresentationTokens {
  /**
   * Low-emphasis container with generous padding, restrained elevation, and no decorative borders
   * that visually separates the recommendation from supporting analysis.
   */
  public static readonly decisionSummaryContainer =
    "border-y border-border/40 bg-muted/20 p-6 sm:p-8 rounded-xl shadow-none my-6";

  /**
   * Hairline warm-gray rule separators between chapters.
   */
  public static readonly sectionRuleSeparator = "border-b border-border/40 py-12 sm:py-16";

  /**
   * Maps semantic attention weight and density to design classes.
   */
  public static getStylesForWeight(weight: AttentionWeight, density: "COMPACT" | "STANDARD" | "EXPANSIVE") {
    if (weight === "DOMINANT") {
      return {
        titleSize: "text-[34px] sm:text-[42px] font-bold tracking-tight text-foreground leading-[1.15]",
        textSize: "text-[15.5px] sm:text-[16.5px] font-normal leading-relaxed text-foreground/95",
        container: "py-12 sm:py-16 border-b border-border/40",
      };
    }

    if (weight === "SUPPORTING" || density === "STANDARD") {
      return {
        titleSize: "text-[24px] sm:text-[28px] font-semibold text-foreground tracking-tight",
        textSize: "text-[14px] sm:text-[15px] font-normal leading-relaxed text-foreground/90",
        container: "py-8 sm:py-10 border-b border-border/40",
      };
    }

    return {
      titleSize: "text-[18px] sm:text-[20px] font-semibold text-foreground/90",
      textSize: "text-[13.5px] font-normal leading-normal text-muted-foreground",
      container: "py-6 border-b border-border/30",
    };
  }
}
