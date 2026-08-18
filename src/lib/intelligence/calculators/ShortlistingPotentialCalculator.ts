/**
 * ShortlistingPotentialCalculator.ts
 *
 * P3-A: Authoritative Shortlisting Potential Calculator
 *
 * Centralized calculation for Shortlisting Potential (P2-C independent signal).
 * Refactored to use pre-decision authoritative assessments only.
 *
 * Question: "How likely is this profile to survive initial hiring scrutiny?"
 *
 * Inputs (pre-decision authoritative assessments):
 * - evidenceMapping: Capability matches with confidence
 * - missingCapabilities: Explicit unknowns/gaps
 * - matchingConfidence: Evidence matching confidence
 * - identityAssessment: Identity match verdict and coverage
 * - capabilityAssessment: Capability fit and sufficiency
 * - careerAssessment: Career trajectory and regression
 * - opportunityAssessment: Operating level and seniority assessment
 *
 * Output: Numeric score 0-100 (independent interpretive signal)
 *
 * P2-C Weights (preserved):
 * - Requirements alignment: 35%
 * - Evidence strength: 25%
 * - Title/scope alignment: 20%
 * - Seniority fit: 10%
 * - Domain fit: 10%
 */

import type { EvidenceMatch } from "../../domain/semantic";
import type { IdentityAssessment, CapabilityAssessment, CareerAssessment, OpportunityAssessment } from "../../domain/semantic";

/**
 * P2-C Legacy Interface (for backward compatibility with existing tests)
 * Uses decision-dependent inputs (vetoed, verb, vetoReason)
 */
export interface ShortlistingPotentialInputsLegacy {
  evidenceMapping: EvidenceMatch[];
  missingCapabilities: string[];
  matchingConfidence: number;
  recommendationConfidence: number;
  vetoed: boolean;
  verb: string;
  vetoReason: string | null;
}

/**
 * P3-A New Interface (authoritative pre-decision assessments)
 * Replaces decision-dependent inputs with authoritative assessments
 */
export interface ShortlistingPotentialInputs {
  // Core capability evidence
  evidenceMapping: EvidenceMatch[];
  missingCapabilities: string[];
  matchingConfidence: number;
  recommendationConfidence: number;
  
  // P3-A: Pre-decision authoritative assessments (replacing decision-dependent inputs)
  identityAssessment: IdentityAssessment;
  capabilityAssessment: CapabilityAssessment;
  careerAssessment: CareerAssessment;
  opportunityAssessment: OpportunityAssessment;
}

/**
 * Union type for backward compatibility
 * P3-A: Use type guards to distinguish between legacy and new inputs
 */
export type ShortlistingPotentialInputsUnion = ShortlistingPotentialInputs | ShortlistingPotentialInputsLegacy;

/**
 * Type guard to check if inputs are legacy (P2-C) format
 */
function isLegacyInputs(inputs: ShortlistingPotentialInputsUnion): inputs is ShortlistingPotentialInputsLegacy {
  return 'vetoed' in inputs && 'verb' in inputs;
}

export interface ShortlistingPotentialCalculation {
  score: number; // 0-100
  requirementsScore: number;
  evidenceStrengthScore: number;
  titleScopeScore: number;
  seniorityScore: number;
  domainScore: number;
}

/**
 * Calculate Shortlisting Potential score (0-100)
 *
 * P3-A Refactored to use pre-decision authoritative assessments.
 * P2-C Weights preserved exactly:
 * - Requirements alignment (35%): Based on high-confidence capability matches
 * - Evidence strength (25%): Based on matching/recommendation confidence
 * - Title/scope alignment (20%): Based on identity/capability/career fit
 * - Seniority fit (10%): Based on opportunity seniority assessment
 * - Domain fit (10%): Based on DOMAIN_FAMILIARITY gaps
 * 
 * P3-A: Backward compatible with P2-C legacy interface via type guard
 */
export function calculateShortlistingPotential(
  inputs: ShortlistingPotentialInputsUnion
): ShortlistingPotentialCalculation {
  // Extract common fields
  const {
    evidenceMapping,
    missingCapabilities,
    matchingConfidence,
    recommendationConfidence
  } = inputs;

  // 1. Requirements alignment (35% weight)
  // Based on high-confidence capability matches (confidence >= 0.7)
  const highConfidenceMatches = evidenceMapping.filter(m => m.confidence >= 0.7).length;
  const totalCapabilities = evidenceMapping.length + missingCapabilities.length;
  const requirementsScore = totalCapabilities > 0
    ? Math.min(100, (highConfidenceMatches / Math.max(totalCapabilities, 3)) * 100 + 40)
    : 50;

  // 2. Evidence strength (25% weight)
  // Use matching confidence if available, otherwise recommendation confidence
  const evidenceStrengthScore = matchingConfidence > 0
    ? matchingConfidence * 100
    : recommendationConfidence > 0
      ? recommendationConfidence * 100
      : 60;

  // 3. Title/scope alignment (20% weight) & 4. Seniority fit (10% weight)
  // P3-A: Use type guard to support both legacy and new interfaces
  let titleScopeScore: number;
  let seniorityScore: number;
  
  if (isLegacyInputs(inputs)) {
    // P2-C Legacy: Use decision-dependent inputs (vetoed, verb, vetoReason)
    const { vetoed, verb, vetoReason } = inputs;
    
    // Title/scope from veto status (legacy behavior)
    titleScopeScore = vetoed === false && verb !== "PASS"
      ? 80
      : vetoed === true && vetoReason?.includes("REGRESSION")
        ? 40
        : 60;
    
    // Seniority from vetoReason (legacy behavior)
    if (vetoReason?.includes("SUB-TIER") || vetoReason?.includes("REGRESSION")) {
      seniorityScore = 60; // overqualified
    } else if (vetoReason?.includes("PROMOTION") || vetoReason?.includes("IDENTITY")) {
      seniorityScore = 50; // aspirational
    } else {
      seniorityScore = 80; // qualified
    }
  } else {
    // P3-A: Use pre-decision authoritative assessments
    const { identityAssessment, capabilityAssessment, careerAssessment, opportunityAssessment } = inputs;
    
    // Title/scope from assessments
    const identityAligned = identityAssessment.verdict === "MATCH" && identityAssessment.coverage >= 0.30;
    const capabilityAligned = capabilityAssessment.overallFit !== null && capabilityAssessment.overallFit >= 0.40;
    const careerNotBackward = careerAssessment.trajectory !== "BACKWARD";
    
    if (identityAligned && capabilityAligned && careerNotBackward) {
      titleScopeScore = 80;
    } else if (identityAssessment.verdict === "MISMATCH" || careerAssessment.trajectory === "BACKWARD") {
      titleScopeScore = 40;
    } else {
      titleScopeScore = 60;
    }
    
    // Seniority from OpportunityAssessment
    const opAssessment = opportunityAssessment;
    const seniorityAssessment = opAssessment.seniorityAssessment;
    
    if (opAssessment.operatingLevelAssessment?.includes("REGRESSION") || 
        seniorityAssessment?.mandateSeniority === "SUB_TIER") {
      seniorityScore = 60;
    } else if (opAssessment.operatingLevelAssessment === "PROMOTION" ||
               seniorityAssessment?.signalType === "BORDERLINE_MANDATE") {
      seniorityScore = 50;
    } else {
      seniorityScore = 80;
    }
  }

  // 5. Domain fit (10% weight)
  // Based on DOMAIN_FAMILIARITY gaps (unchanged)
  const domainGaps = missingCapabilities.filter(c => c.includes("[DOMAIN_FAMILIARITY]"));
  let domainScore: number;
  if (domainGaps.length === 0) {
    domainScore = 90; // native
  } else if (domainGaps.length <= 1) {
    domainScore = 70; // transferable
  } else {
    domainScore = 40; // distant
  }

  // Calculate weighted composite score (P2-C formula preserved)
  const score = Math.round(
    requirementsScore * 0.35 +
    evidenceStrengthScore * 0.25 +
    titleScopeScore * 0.20 +
    seniorityScore * 0.10 +
    domainScore * 0.10
  );

  return {
    score,
    requirementsScore,
    evidenceStrengthScore,
    titleScopeScore,
    seniorityScore,
    domainScore
  };
}

/**
 * P3-A: Convenience function for engine.ts pre-decision calculation
 * 
 * Calculates SP BEFORE DecisionPolicyEngine using authoritative assessments.
 * This breaks the circular dependency by ensuring SP is available for decision logic.
 */
export function calculateShortlistingPotentialFromAssessments(
  identity: IdentityAssessment,
  capability: CapabilityAssessment,
  career: CareerAssessment,
  opportunity: OpportunityAssessment,
  recommendationConfidence: number
): ShortlistingPotentialCalculation {
  return calculateShortlistingPotential({
    evidenceMapping: capability.matches || [],
    missingCapabilities: capability.missingCapabilities || [],
    matchingConfidence: capability.matchingConfidence || 0,
    recommendationConfidence,
    identityAssessment: identity,
    capabilityAssessment: capability,
    careerAssessment: career,
    opportunityAssessment: opportunity
  });
}

/**
 * P2-C Legacy: Calculate SP from a RecommendationRecord for backward compatibility
 * Used by ShortlistingPotentialSynthesizer when full calculation is not in trace
 */
export function calculateShortlistingPotentialFromRecord(params: {
  evidenceMapping: EvidenceMatch[];
  missingCapabilities: string[];
  matchingConfidence: number;
  recommendationConfidence: number;
  vetoed: boolean;
  verb: string;
  vetoReason: string | null;
}): ShortlistingPotentialCalculation {
  const {
    evidenceMapping,
    missingCapabilities,
    matchingConfidence,
    recommendationConfidence,
    vetoed,
    verb,
    vetoReason
  } = params;

  // 1. Requirements alignment (35% weight)
  const highConfidenceMatches = evidenceMapping.filter(m => m.confidence >= 0.7).length;
  const totalCapabilities = evidenceMapping.length + missingCapabilities.length;
  const requirementsScore = totalCapabilities > 0
    ? Math.min(100, (highConfidenceMatches / Math.max(totalCapabilities, 3)) * 100 + 40)
    : 50;

  // 2. Evidence strength (25% weight)
  const evidenceStrengthScore = matchingConfidence > 0
    ? matchingConfidence * 100
    : recommendationConfidence > 0
      ? recommendationConfidence * 100
      : 60;

  // 3. Title/scope alignment (20% weight)
  // P2-C legacy: uses veto status and decision outcome
  const titleScopeScore = vetoed === false && verb !== "PASS"
    ? 80
    : vetoed === true && vetoReason?.includes("REGRESSION")
      ? 40
      : 60;

  // 4. Seniority fit (10% weight)
  // P2-C legacy: uses vetoReason
  let seniorityScore: number;
  if (vetoReason?.includes("SUB-TIER") || vetoReason?.includes("REGRESSION")) {
    seniorityScore = 60; // overqualified
  } else if (vetoReason?.includes("PROMOTION") || vetoReason?.includes("IDENTITY")) {
    seniorityScore = 50; // aspirational
  } else {
    seniorityScore = 80; // qualified
  }

  // 5. Domain fit (10% weight)
  const domainGaps = missingCapabilities.filter(c => c.includes("[DOMAIN_FAMILIARITY]"));
  let domainScore: number;
  if (domainGaps.length === 0) {
    domainScore = 90; // native
  } else if (domainGaps.length <= 1) {
    domainScore = 70; // transferable
  } else {
    domainScore = 40; // distant
  }

  // Calculate weighted composite score (P2-C formula preserved)
  const score = Math.round(
    requirementsScore * 0.35 +
    evidenceStrengthScore * 0.25 +
    titleScopeScore * 0.20 +
    seniorityScore * 0.10 +
    domainScore * 0.10
  );

  return {
    score,
    requirementsScore,
    evidenceStrengthScore,
    titleScopeScore,
    seniorityScore,
    domainScore
  };
}
