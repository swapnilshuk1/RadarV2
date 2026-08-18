import { useState, useEffect } from "react";

export type SectionId =
  | "verdict"
  | "qualityScore"
  | "context"
  | "mandate"
  | "evidence"
  | "opinion"
  | "strategy"
  | "appendix";

export type SectionState = "open" | "collapsed";

export type SectionPreferences = Record<string, SectionState>;

const STORAGE_KEY = "radar_section_preferences_v1";

/**
 * Computes the recommended default section open/collapsed state based on RADAR intelligence rules:
 * - PURSUE: Focus on opportunity rationale, mandate requirements, and recommended action. Evidence collapsed by default.
 * - CONSIDER: Focus on principal risk, mandate conditions, and evidence to clarify uncertainties.
 * - PASS: Focus on top-line verdict and primary pass rationale; deeper sections collapsed for rapid processing.
 * - Archetype adjustments: Founder-led auto-expands mandate; PE/Turnaround auto-expands strategy/opinion.
 */
export function getRecommendedSectionState(
  sectionId: SectionId,
  decision: string,
  archetype?: string
): SectionState {
  const normDecision = (decision || "").toUpperCase();

  switch (sectionId) {
    case "verdict":
    case "qualityScore":
      return "open";

    case "context": // Why This Opportunity
      return normDecision === "PASS" ? "collapsed" : "open";

    case "mandate": // What Success Requires
      if (archetype === "founder" || archetype === "pe_operator") return "open";
      return normDecision === "PASS" ? "collapsed" : "open";

    case "opinion": // Executive Bottom Line
      return "open";

    case "evidence": // Proof Points
      if (normDecision === "CONSIDER") return "open";
      return "collapsed";

    case "strategy": // Career Trajectory
      if (normDecision === "PURSUE") return "open";
      return "collapsed";

    case "appendix": // Evidence Lineage & Methodology
      return "collapsed";

    default:
      return "open";
  }
}

export function useSectionPreferences(decision: string, archetype?: string) {
  const [userPrefs, setUserPreferences] = useState<SectionPreferences>(() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(userPrefs));
    } catch (e) {
      console.error("Failed to persist section preferences:", e);
    }
  }, [userPrefs]);

  const getSectionState = (sectionId: SectionId): SectionState => {
    if (userPrefs[sectionId]) {
      return userPrefs[sectionId];
    }
    return getRecommendedSectionState(sectionId, decision, archetype);
  };

  const toggleSection = (sectionId: SectionId) => {
    setUserPreferences((prev) => {
      const currentState = prev[sectionId] || getRecommendedSectionState(sectionId, decision, archetype);
      const newState: SectionState = currentState === "open" ? "collapsed" : "open";
      return { ...prev, [sectionId]: newState };
    });
  };

  const resetToDefaults = () => {
    setUserPreferences({});
  };

  return {
    getSectionState,
    toggleSection,
    resetToDefaults,
    userPrefs,
  };
}
