export interface EditorialSurfacePolicy {
  readingMode: "deliberate" | "rapid";
  maxNarrativeDensity: "comprehensive" | "high-density";
  maxEvidenceDepth: number;
  interactionStyle: "immersive" | "drilldown";
  emphasisOrder: Array<"verdict" | "opinion" | "before-proceed" | "opportunities" | "uncertainties" | "evidence" | "workspace">;
}

export const ReadingSurfacePolicy: EditorialSurfacePolicy = {
  readingMode: "deliberate",
  maxNarrativeDensity: "comprehensive",
  maxEvidenceDepth: 10,
  interactionStyle: "immersive",
  emphasisOrder: ["verdict", "opinion", "opportunities", "before-proceed", "evidence", "workspace"]
};

export const ExecutiveBriefingPolicy: EditorialSurfacePolicy = {
  readingMode: "rapid",
  maxNarrativeDensity: "high-density",
  maxEvidenceDepth: 3,
  interactionStyle: "drilldown",
  emphasisOrder: ["verdict", "before-proceed", "opinion", "opportunities", "uncertainties", "workspace", "evidence"]
};
