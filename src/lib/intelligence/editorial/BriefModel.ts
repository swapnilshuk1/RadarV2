// src/lib/intelligence/editorial/BriefModel.ts

export interface FocusWeights {
  career: number;      // 0.0 - 1.0 (e.g. 0.82)
  execution: number;   // 0.0 - 1.0 (e.g. 0.64)
  commercial: number;  // 0.0 - 1.0 (e.g. 0.91)
  risk: number;        // 0.0 - 1.0 (e.g. 0.22)
  unknown: number;     // 0.0 - 1.0 (e.g. 0.31)
  confidence: number;  // Editorial choice confidence (0.0 - 1.0)
}

export type FocusArea =
  | "CAREER"
  | "COMMERCIAL"
  | "EXECUTION"
  | "LEADERSHIP"
  | "TRANSFORMATION"
  | "RISK"
  | "UNKNOWN";

export interface CapabilityNarrative {
  intent: "COMPETITIVE_ADVANTAGE" | "LEVERAGE_POINT" | "CAPABILITY_FIT";
  strengthCount: number;
}

export interface BriefStrategy {
  primaryFocus: FocusArea;
  secondaryFocus: FocusArea;
  tertiaryFocus: FocusArea;
  focusTitle: string;
  heroAnchor: string;
  narrative: CapabilityNarrative;
}

export interface BriefMemory {
  headline: string;
  retentionSentence: string;    // e.g. "Essentially a CCO stepping-stone role with regional ownership"
  primaryOpportunity: string;  // e.g. "Direct P&L and regional growth expansion"
  primaryRisk: string;         // e.g. "Reporting line hierarchy unstated"
  recommendedAction: string;   // e.g. "PURSUE — Submit direct application"
  decision: "PURSUE" | "CONSIDER" | "PASS" | null;
  tradeoff: string;            // e.g. "Smaller team (-15% span) for direct C-suite visibility"
  first90Days: string;         // e.g. "Restructure marketing agency roster before Q2 launch"
  whyNow: string;              // e.g. "Company entering $50M regional expansion phase following CEO hire"
}

export interface RankedUnknown {
  rank: "CRITICAL" | "IMPORTANT" | "SECONDARY";
  label: string;
  question: string;
}

export interface ProofPointItem {
  category: "Direct Evidence" | "Transferable Experience";
  headline: string;
  detail: string;
}

export interface QualitativeReasoningRow {
  layer: "Identity Alignment" | "Capability Coverage" | "Career Capital Value";
  ratingLabel: "Exceptional" | "Strong Alignment" | "Adjacent Alignment" | "Moderate" | "Limited Upside";
  becausePoints: string[];
  evidenceSnippet: string;
}

export interface OpportunityInOneMinute {
  whyPursue: string[];
  watchFor: string[];
  bottomLine: string;
}

export interface DecisionSensitivity {
  becomesPursueIf: string[];
  becomesPassIf: string[];
}

export interface StrategicUpside {
  headline: string;
  points: string[];
}

export type SectionId =
  | "STRATEGIC_CAREER_VALUE"
  | "EXPLAINABLE_REASONING"
  | "THE_CASE"
  | "THE_ROLE"
  | "YOUR_ADVANTAGE"
  | "OPEN_QUESTIONS"
  | "DECISION_BOUNDARIES"
  | "SUPPORTING_EVIDENCE"
  | "DOSSIER_LEDGER";

export interface BriefSectionMeta {
  id: SectionId;
  name: string;          // e.g. "Strategic Career Value"
  eyebrow: string;       // e.g. "STRATEGIC CAREER VALUE"
  numeral?: string;      // e.g. "I", "II", "III", "IV", "V"
  title: string;         // e.g. "Why this role is interesting"
  expression?: string;   // Editorial subtitle or description
}

export interface BriefModel {
  opportunityId: string;
  score: number;
  certaintyPct: number;
  evidenceQuality: "High Evidence Quality" | "Medium Evidence Quality" | "Inferred Evidence";
  qualitativeRecommendation: "Strong Pursue Recommendation" | "Conditional Consideration" | "Strategic Pass" | "Pending Assessment";
  whyNotStronger: string;
  sections: BriefSectionMeta[];
  oneMinuteTLDR: OpportunityInOneMinute;
  qualitativeReasoningChain: QualitativeReasoningRow[];
  strategicUpside: StrategicUpside;
  decisionSensitivity: DecisionSensitivity;
  strategy: BriefStrategy;
  weights: FocusWeights;
  memory: BriefMemory;
  headline: string;
  frictionPreview?: string;
  topUnknownPreview?: string;
  deliverablesWork: string[];
  deliverablesValue: string[];
  deliverablesProvenance: Array<"Observed in JD" | "Inferred from Role Pattern">;
  proofPoints: ProofPointItem[];
  fitProofs: string[];
  rankedUnknowns: RankedUnknown[];
  certaintyLevel: "HIGH" | "MEDIUM" | "LOW";
  certaintyGuidance: string;
}
