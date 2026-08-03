import type { OrganizationType, TransformationStage } from "./EditorialContext";

export type EditorialConfidence = "assertive" | "balanced" | "cautious";

export type EditorialPurpose =
  | "Increase conviction"
  | "Highlight trade-off"
  | "Surface hidden risk"
  | "Explain recommendation"
  | "Surface hidden upside"
  | "Frame career move";

export type ExecutiveIdentity =
  | "Builder"
  | "Scaler"
  | "Operator"
  | "Turnaround Leader"
  | "Board Executive"
  | "Global Executive"
  | "Category Leader";

export type EditorialRisk =
  | "execution"
  | "governance"
  | "commercial"
  | "political"
  | "technical"
  | "career";

export interface EditorialVariableMap {
  role: string;
  company: string;
  location: string;
  pnlScale?: string;
  primaryCapability?: string;
}

export interface EditorialPatternConstraints {
  requires?: {
    organizationType?: OrganizationType[];
    transformationStage?: TransformationStage[];
    hasPnlOwnership?: boolean;
    minScore?: number;
  };
  avoids?: {
    organizationType?: OrganizationType[];
    maxScore?: number;
  };
}

export interface EditorialPattern {
  id: string;
  strategyId: "GROWTH_EXPANSION" | "SCALE_TRANSFORMATION" | "FOUNDER_EXPOSURE" | "CAREER_CAPITAL";
  angleId: "COMMERCIAL_OWNERSHIP" | "CAREER_ACCELERATION" | "FOUNDER_ACCESS" | "CATEGORY_LEADERSHIP" | "TURNAROUND_EXECUTION";
  executiveIdentity: ExecutiveIdentity; // Author / Analytics Metadata
  editorialPurpose: EditorialPurpose;  // Author Intent
  editorialRisk?: EditorialRisk;      // Editorial Risk Emphasis
  editorialThesis: string;
  primaryQuestion?: string;           // Author Documentation
  editorialIntent: {
    primaryMessage: string;
    supportingThemes: string[];
    avoidThemes: string[];
  };
  constraints: EditorialPatternConstraints;
  slots: {
    headline: (v: EditorialVariableMap) => string;
    opening?: (v: EditorialVariableMap) => string;          // Optional
    editorialBridge?: (v: EditorialVariableMap) => string;  // Optional
    decisionGuidance: {
      proceedIf: (v: EditorialVariableMap) => string;
      pauseIf: (v: EditorialVariableMap) => string;
      closing?: (v: EditorialVariableMap) => string;        // Optional
    };
  };
}
