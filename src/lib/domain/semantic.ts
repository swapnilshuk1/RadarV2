// src/lib/domain/semantic.ts

export type OperatingLevel = "EXECUTIVE" | "STRATEGIC" | "MANAGERIAL" | "TACTICAL" | "INDIVIDUAL_CONTRIBUTOR" | "UNKNOWN";

export type WorkNature = "EXECUTIVE_WORK" | "STRATEGIC_WORK" | "MANAGERIAL_WORK" | "TACTICAL_WORK" | "SPECIALIST_WORK" | "UNKNOWN";

export type DecisionAuthority = "ENTERPRISE" | "BUSINESS_UNIT" | "FUNCTION" | "TEAM" | "SELF" | "UNKNOWN";

export type CommercialScope = "ENTERPRISE" | "PORTFOLIO" | "PRODUCT" | "CAMPAIGN" | "NONE" | "UNKNOWN";

// Unified frozen classifier result
export interface ClassifierResult<T> {
  value: T;
  evidenceIds: string[];
  confidence: number;
}

export type AssessmentStatus = "COMPLETE" | "FAILED" | "NOT_APPLICABLE";

export type EvidenceSufficiency = "SUFFICIENT" | "INSUFFICIENT";

export type FailureCode = 
  | "EMPTY_CAPABILITIES"
  | "EMPTY_THEMES"
  | "CSS_POLLUTION"
  | "SCRAPER_TIMEOUT"
  | "UNKNOWN_WORK_NATURE"
  | "UNKNOWN_OPERATING_LEVEL"
  | "LLM_FAILURE";

export interface EvidenceSummary {
  extractedSignals: number;
  inferredSignals: number;
  ignoredSignals: number;
  conflictingSignals: number;
}

export interface AssessmentMetadata {
  status: AssessmentStatus;
  sufficiency: EvidenceSufficiency;
  evidenceCount: number;
  evidenceSummary?: EvidenceSummary;
  failureCode?: FailureCode;
  parsingConfidence?: number;
  matchingConfidence?: number;
}

export interface IdentityAssessment extends AssessmentMetadata {
  coverage: number;                 // Asymmetric theme coverage (0.00 to 1.00)
  matchedThemes: string[];          // Canonical Ontology IDs matched (e.g. "theme_growth")
  missingThemes: string[];          // Canonical Ontology IDs missing (e.g. "theme_it_infra")
  verdict: "MATCH" | "MISMATCH";    // Determined by coverage threshold (>= 0.30)
}

export interface EvidenceMatch {
  jobCapability: string;
  candidateCapability: string;
  confidence: number;
  reason: string;
}

export interface CapabilityAssessment extends AssessmentMetadata {
  overallFit: number;               // Composite balanced score (0.0 to 1.0)
  capabilityPotential?: number;     // Executive potential fit (0.0 to 1.0)
  evidenceStrength?: number;        // Direct proof evidence density (0.0 to 1.0)
  matchedCapabilities: string[];
  missingCapabilities: string[];
  missingInferredCapabilities?: string[];
  matches?: EvidenceMatch[];
}

export type ScopeType = "STRATEGIC_MANDATE" | "MIXED" | "EXECUTION" | "UNKNOWN";

export type SenioritySignalType = 
  | "QUALIFIED_EXECUTIVE" 
  | "BORDERLINE_MANDATE" 
  | "SUB_TIER_SIGNAL" 
  | "CRITICAL_SENIORITY_CONTRADICTION";

export interface ExecutiveSeniorityAssessment {
  minYearsExperience?: number;
  maxYearsExperience?: number;
  scopeType: ScopeType;
  signalType: SenioritySignalType;
  mandateSeniority: "QUALIFIED" | "BORDERLINE" | "SUB_TIER";
  evidence: string[];
  contradictions: string[];
}

export interface OpportunityAssessment extends AssessmentMetadata {
  operatingLevelAssessment: "MATCH" | "PROMOTION" | "REGRESSION_MINOR" | "REGRESSION_MAJOR" | "UNKNOWN";
  workNatureAssessment: "MATCH" | "PROMOTION" | "REGRESSION" | "UNKNOWN";
  scopeAssessment: "MATCH" | "PROMOTION" | "REGRESSION" | "UNKNOWN";
  mandateSeniority?: "QUALIFIED" | "BORDERLINE" | "SUB_TIER";
  seniorityAssessment?: ExecutiveSeniorityAssessment;
  opportunityScore?: number;
}

export interface CareerAssessment extends AssessmentMetadata {
  trajectory: "FORWARD" | "LATERAL" | "BACKWARD" | "UNKNOWN";
  growthPotential: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  regressionScore: number;          // Severity of career level downgrade (0 to 100)
}

export interface LifestyleAssessment extends AssessmentMetadata {
  locationFit: boolean;
  travelFit: boolean;
  scheduleFit: boolean;
  compensationFit: boolean;
}

export interface DimensionHeuristic {
  value: number;
  reason: string;
  status?: "KNOWN" | "UNKNOWN" | "ESTIMATED";
}

export interface CareerValueBreakdown {
  titleProgression: DimensionHeuristic;
  scopeExpansion: DimensionHeuristic;
  commercialScale: DimensionHeuristic;
  futureOptionality: DimensionHeuristic;
  brandSignal: DimensionHeuristic;
}

// Immutable Type-Safe Condition Field Unions
export type IdentityField = "coverage" | "matchedThemes" | "missingThemes" | "verdict";
export type CapabilityField = "overallFit" | "matchedCapabilities" | "missingCapabilities";
export type OpportunityField = "operatingLevelAssessment" | "workNatureAssessment" | "scopeAssessment";
export type CareerField = "trajectory" | "growthPotential" | "regressionScore";
export type LifestyleField = "locationFit" | "travelFit" | "scheduleFit" | "compensationFit";

export type RuleCondition = 
  | { dimension: "IDENTITY"; field: IdentityField; operator: "EQUALS" | "NOT_EQUALS" | "LESS_THAN" | "GREATER_THAN"; value: string | number | boolean }
  | { dimension: "CAPABILITY"; field: CapabilityField; operator: "EQUALS" | "NOT_EQUALS" | "LESS_THAN" | "GREATER_THAN"; value: string | number | boolean }
  | { dimension: "OPPORTUNITY"; field: OpportunityField; operator: "EQUALS" | "NOT_EQUALS" | "LESS_THAN" | "GREATER_THAN"; value: string | number | boolean }
  | { dimension: "CAREER"; field: CareerField; operator: "EQUALS" | "NOT_EQUALS" | "LESS_THAN" | "GREATER_THAN"; value: string | number | boolean }
  | { dimension: "LIFESTYLE"; field: LifestyleField; operator: "EQUALS" | "NOT_EQUALS" | "LESS_THAN" | "GREATER_THAN"; value: string | number | boolean };

export type DecisionVerdict = "PASS" | "CONSIDER" | "PURSUE" | "NOT_EVALUABLE";

// Data-driven decision rule with explicit output verbs
export interface DecisionRule {
  id: string;
  priority: number; // Frozen structural priority tiers
  conditions: RuleCondition[];
  action: "PASS" | "CONSIDER" | "PURSUE" | "ADJUST_CONFIDENCE" | "NOT_EVALUABLE";
  rationale: string;
  confidenceAdjustment?: number;
}

// Frozen Priority Tiers Documented & Enforced
export enum DecisionPriorityTier {
  MANDATORY_LEGAL = 1000,
  EXECUTIVE_REGRESSION = 900,
  WORK_NATURE_REGRESSION = 800,
  LIFESTYLE_HARD_VETO = 700,
  CAREER_MISMATCH = 500,
  CAPABILITY_GAP = 300,
  COSMETIC_MODIFIER = 100
}
