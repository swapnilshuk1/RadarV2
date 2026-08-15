import type { 
  IdentityAssessment, 
  CapabilityAssessment, 
  OpportunityAssessment, 
  CareerAssessment 
} from "../../domain/semantic";

export interface QualityScoreInput {
  identityDistance: number;
  identity?: IdentityAssessment;
  capability: CapabilityAssessment;
  career: CareerAssessment;
  opportunity: OpportunityAssessment;
  isSparseSpec: boolean;
  criticalFailed: boolean;
}

export interface QualityScoreResult {
  qualityScore: number | null;
  isEligible: boolean;
  ineligibilityReason?: "SPARSE_SPEC" | "IDENTITY_MISMATCH" | "EVIDENCE_INTEGRITY_FAILED";
  componentScores: {
    careerScore: number;
    capabilityScore: number;
    opportunityScore: number;
  };
  normalizedWeights: {
    career: number;
    capability: number;
    opportunity: number;
  };
}

/**
 * Model C Authoritative Intrinsic Quality Score Calculator
 * 
 * Verified Live Base Weights (from decision_policy.json):
 * - Identity: 0.35 (35%)
 * - Career: 0.30 (30%)
 * - Opportunity: 0.20 (20%)
 * - Capability: 0.15 (15%)
 * 
 * Model C Normalized Non-Identity Weights (Non-identity sum = 0.65):
 * - Career: 0.30 / 0.65 = 6/13 ≈ 0.46153846 (46.15%)
 * - Opportunity: 0.20 / 0.65 = 4/13 ≈ 0.30769231 (30.77%)
 * - Capability: 0.15 / 0.65 = 3/13 ≈ 0.23076923 (23.08%)
 * 
 * Identity contributes 0% to quality score (acts purely as an eligibility gate).
 * Pursuit Friction contributes 0% to quality score.
 */
export class QualityScoreCalculator {
  public static readonly WEIGHT_CAREER = 0.30 / 0.65;      // 6/13 ≈ 0.46153846
  public static readonly WEIGHT_OPPORTUNITY = 0.20 / 0.65; // 4/13 ≈ 0.30769231
  public static readonly WEIGHT_CAPABILITY = 0.15 / 0.65;  // 3/13 ≈ 0.23076923

  public static calculate(input: QualityScoreInput): QualityScoreResult {
    const normalizedWeights = {
      career: this.WEIGHT_CAREER,
      capability: this.WEIGHT_CAPABILITY,
      opportunity: this.WEIGHT_OPPORTUNITY
    };

    // 1. Ineligibility Gate 1: SPARSE_SPEC (Insufficient Evidence)
    if (input.isSparseSpec) {
      return {
        qualityScore: null,
        isEligible: false,
        ineligibilityReason: "SPARSE_SPEC",
        componentScores: { careerScore: 0, capabilityScore: 0, opportunityScore: 0 },
        normalizedWeights
      };
    }

    // 2. Ineligibility Gate 2: Executive Identity Distance >= 0.80 (Domain Mismatch)
    if (input.identityDistance >= 0.80) {
      return {
        qualityScore: null,
        isEligible: false,
        ineligibilityReason: "IDENTITY_MISMATCH",
        componentScores: { careerScore: 0, capabilityScore: 0, opportunityScore: 0 },
        normalizedWeights
      };
    }

    // 3. Ineligibility Gate 3: Critical Evidence Integrity Failure
    if (input.criticalFailed) {
      return {
        qualityScore: null,
        isEligible: false,
        ineligibilityReason: "EVIDENCE_INTEGRITY_FAILED",
        componentScores: { careerScore: 0, capabilityScore: 0, opportunityScore: 0 },
        normalizedWeights
      };
    }

    // 4. Component Score Extraction
    const isCapUnavailable = (input.capability as any).evidenceState === "UNAVAILABLE" || 
      input.capability.sufficiency === "INSUFFICIENT" || 
      input.capability.overallFit === null;
      
    const capabilityScore = isCapUnavailable ? 50 : Math.round((input.capability.overallFit || 0) * 100);
    const careerScore = (input.career as any).careerScore || Math.max(0, 80 - (input.career.regressionScore || 0));
    const opportunityScore = (input.opportunity as any).opportunityScore || 80;

    // 5. Model C Intrinsic Quality Score Calculation (Continuous, 0-100)
    // Formula: (6/13)*Career + (3/13)*Capability + (4/13)*Opportunity
    const rawWeighted = 
      this.WEIGHT_CAREER * careerScore +
      this.WEIGHT_CAPABILITY * capabilityScore +
      this.WEIGHT_OPPORTUNITY * opportunityScore;

    const qualityScore = Math.min(100, Math.max(0, Math.round(rawWeighted)));

    return {
      qualityScore,
      isEligible: true,
      componentScores: { careerScore, capabilityScore, opportunityScore },
      normalizedWeights
    };
  }
}
