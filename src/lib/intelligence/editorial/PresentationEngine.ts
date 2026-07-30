// src/lib/intelligence/editorial/PresentationEngine.ts

import type { BriefModel } from "./BriefModel";

export type SectionEmphasis = "HERO" | "PRIMARY" | "SECONDARY" | "SUPPORTING" | "COLLAPSED";
export type SectionId = "CAREER" | "DELIVERABLES" | "FIT" | "UNKNOWNS" | "EVIDENCE";

export interface PresentationSection {
  id: SectionId;
  priority: number;
  emphasis: SectionEmphasis;
  isCollapsed: boolean;
}

export interface PresentationModel {
  sections: PresentationSection[];
  capabilityTitle: string;
}

export class PresentationEngine {
  /**
   * Pure Presentation Function: Emits a declarative PresentationModel from a BriefModel.
   * Zero CSS or framework coupling.
   */
  public static compose(brief: BriefModel): PresentationModel {
    const { primaryFocus } = brief.strategy;

    // Determine section priority and emphasis declaratively
    let sections: PresentationSection[] = [
      { id: "FIT", priority: 1, emphasis: "PRIMARY", isCollapsed: false },
      { id: "DELIVERABLES", priority: 2, emphasis: "PRIMARY", isCollapsed: false },
      { id: "CAREER", priority: 3, emphasis: "SECONDARY", isCollapsed: false },
      { id: "UNKNOWNS", priority: 4, emphasis: "SECONDARY", isCollapsed: false },
      { id: "EVIDENCE", priority: 5, emphasis: "COLLAPSED", isCollapsed: true },
    ];

    if (primaryFocus === "CAREER") {
      sections = [
        { id: "CAREER", priority: 1, emphasis: "HERO", isCollapsed: false },
        { id: "DELIVERABLES", priority: 2, emphasis: "PRIMARY", isCollapsed: false },
        { id: "FIT", priority: 3, emphasis: "PRIMARY", isCollapsed: false },
        { id: "UNKNOWNS", priority: 4, emphasis: "SECONDARY", isCollapsed: false },
        { id: "EVIDENCE", priority: 5, emphasis: "COLLAPSED", isCollapsed: true },
      ];
    } else if (primaryFocus === "COMMERCIAL" || primaryFocus === "EXECUTION") {
      sections = [
        { id: "DELIVERABLES", priority: 1, emphasis: "HERO", isCollapsed: false },
        { id: "FIT", priority: 2, emphasis: "PRIMARY", isCollapsed: false },
        { id: "CAREER", priority: 3, emphasis: "SECONDARY", isCollapsed: false },
        { id: "UNKNOWNS", priority: 4, emphasis: "SECONDARY", isCollapsed: false },
        { id: "EVIDENCE", priority: 5, emphasis: "COLLAPSED", isCollapsed: true },
      ];
    } else if (primaryFocus === "RISK" || primaryFocus === "UNKNOWN") {
      sections = [
        { id: "UNKNOWNS", priority: 1, emphasis: "HERO", isCollapsed: false },
        { id: "FIT", priority: 2, emphasis: "PRIMARY", isCollapsed: false },
        { id: "DELIVERABLES", priority: 3, emphasis: "SECONDARY", isCollapsed: false },
        { id: "CAREER", priority: 4, emphasis: "SECONDARY", isCollapsed: false },
        { id: "EVIDENCE", priority: 5, emphasis: "COLLAPSED", isCollapsed: true },
      ];
    }

    // Map semantic capability narrative to human presentation title
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
}
