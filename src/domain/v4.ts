/**
 * RADAR V4 API Contract and Domain Specifications
 *
 * Implements the official, frozen RADAR V4 domain models and API contracts,
 * decoupling factual findings from prose and providing confidence scores,
 * versioned role model keys, and configuration-driven decision policies.
 */

export interface EvidenceReference {
  sourceId: string;    // e.g., "resume.claim.42", "linkedin.exp.7"
  textSegment?: string; // Excerpt/quote for UI rendering
}

export interface Finding {
  title: string;
  summary: string;
  confidence: number; // 0.0 to 1.0 representing LLM certainty
  evidenceRefs: EvidenceReference[];
}

export interface RequiredGap {
  dimension: string;
  requirement: string;
  confidence: number;
  evidenceRefs: EvidenceReference[];
  rationale: string;
}

export interface StrategicAdvantage {
  dimension: string;
  capability: string;
  confidence: number;
  evidenceRefs: EvidenceReference[];
  rationale: string;
}

export interface DimensionUtilization {
  level: "High" | "Moderate" | "Low";
  confidence: number;
  reason: string;
}

export interface UtilizationProfile {
  strategy: DimensionUtilization;
  commercial: DimensionUtilization;
  leadership: DimensionUtilization;
  technical: DimensionUtilization;
  transformation: DimensionUtilization;
}

export interface DevelopmentRecommendation {
  capability: string;
  expectedByMarket: string;
  confidence: number;
  evidenceRefs: EvidenceReference[];
  actionableAdvice: string;
}

export interface SuggestedAction {
  actionItem: string;
  type: "NEGOTIATION" | "INTERVIEW_PREP" | "REFERENCE_CHECK";
  confidence: number;
  rationale: string;
}

export interface CareerAlignment {
  level: "HIGH" | "MEDIUM" | "LOW";
  score: number; // 0 - 100
  rationale: string;
  supportingFactors: string[];
  confidence: number;
}

// ============================================================================
// Core RADAR V4 Structural Outputs
// ============================================================================

export interface OpportunityEvaluation {
  requiredFit: number;               // Explicit fit score (0 - 100)
  requiredGaps: RequiredGap[];       // Explicit JD requirements lacking evidence
  strategicAdvantages: StrategicAdvantage[]; // Extra high-value capabilities
}

export interface ExecutiveGrowth {
  careerAlignment: CareerAlignment;
  capabilityUtilization: UtilizationProfile;
  developmentRecommendations: DevelopmentRecommendation[];
}

export interface DecisionIntelligence {
  verdict: "PURSUE" | "CONSIDER" | "PASS";
  strategicRationale: string;
  nextActions: SuggestedAction[];
}

export interface EvaluationResponse {
  opportunity: OpportunityEvaluation;
  growth: ExecutiveGrowth;
  decision: DecisionIntelligence;
}

export interface EvaluationMetadata {
  evaluationVersion: string;   // e.g. "4.0.0"
  promptVersion: string;       // e.g. "v4.2-pro"
  roleModelVersion: string;    // e.g. "VP_Growth@1.2"
  decisionPolicyVersion: string; // e.g. "policy-v1.0"
  generatedAt: string;         // ISO-8601 Timestamp
}

/**
 * The ultimate immutable delivery container for RADAR V4
 */
export interface EvaluationEnvelope {
  metadata: EvaluationMetadata;
  response: EvaluationResponse;
}

// ============================================================================
// Configurable Decision Policy Specification
// ============================================================================

export interface DecisionPolicyRule {
  minFit: number;
  minAlignment: "HIGH" | "MEDIUM" | "LOW";
  minStrategicAdvantages?: number;
}

export interface DecisionPolicy {
  version: string;
  rules: {
    pursue: DecisionPolicyRule;
    consider: DecisionPolicyRule;
  };
}
