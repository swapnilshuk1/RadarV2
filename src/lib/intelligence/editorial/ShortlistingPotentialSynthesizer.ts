/**
 * ShortlistingPotentialSynthesizer.ts
 *
 * P2-C.2: Shortlisting Potential — Independent Signal
 *
 * Question: "How likely is my profile to survive initial hiring scrutiny?"
 *
 * Conceptually independent from:
 * - Career Value (different question)
 * - Pursuit Friction (different question)
 * - Overall fit score (orthogonal concept)
 *
 * P3-A Update: Now consumes the authoritative SP value from the calculator.
 * The synthesizer generates the interpretive statement, but the numeric score
 * comes from ShortlistingPotentialCalculator to ensure single source of truth.
 */

import type { RecommendationRecord } from "../record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";
import { calculateShortlistingPotentialFromRecord } from "../calculators/ShortlistingPotentialCalculator";
// P3-A: SP is now calculated once in engine.ts and persisted in record
// Synthesizer consumes the persisted value, does not recalculate

export interface ShortlistingPotential {
  /** Likelihood of surviving initial screening */
  likelihood: "high" | "moderate" | "low" | "uncertain";

  /** Score 0-100 */
  score: number;

  /** Interpretive statement */
  statement: string;

  /** Key factors affecting shortlisting */
  factors: {
    requirementsAlignment: { status: "strong" | "moderate" | "weak"; evidence: string };
    titleScopeAlignment: { status: "aligned" | "borderline" | "mismatched"; evidence: string };
    evidenceStrength: { status: "strong" | "moderate" | "insufficient"; evidence: string };
    seniorityFit: { status: "qualified" | "aspirational" | "overqualified"; evidence: string };
    domainFit: { status: "native" | "transferable" | "distant"; evidence: string };
  };

  /** Primary concern for shortlisting */
  primaryConcern?: string;

  /** What to emphasize in initial outreach */
  positioningAdvice: string;

  /** Evidence grounding */
  evidence: string[];

  /** Confidence in assessment */
  confidence: number;
}

/**
 * Synthesize shortlisting potential as independent signal
 *
 * P3-A: Now uses authoritative calculator for the numeric score.
 * This ensures decisionSummary.shortlistingPotential and the synthesizer
 * use the exact same calculation.
 */
export function synthesizeShortlistingPotential(
  record: RecommendationRecord,
  source: OpportunitySource
): ShortlistingPotential {
  const evidence: string[] = [];

  // P3-A: Consume the authoritative SP calculation from record.trace
  // The SP was calculated once in engine.ts using pre-decision assessments
  // Fallback to P2-C behavior for backward compatibility with old test mocks
  const spCalculation = record.trace?.shortlistingPotentialCalculation;
  
  // If full calculation is available (P3-A), use it; otherwise compute from record (P2-C legacy)
  let score: number;
  let requirementsScore: number;
  let evidenceStrengthScore: number;
  let titleScopeScore: number;
  let seniorityScore: number;
  let domainScore: number;
  
  if (spCalculation) {
    // P3-A: Use authoritative pre-calculated values
    score = spCalculation.score;
    requirementsScore = spCalculation.requirementsScore;
    evidenceStrengthScore = spCalculation.evidenceStrengthScore;
    titleScopeScore = spCalculation.titleScopeScore;
    seniorityScore = spCalculation.seniorityScore;
    domainScore = spCalculation.domainScore;
  } else {
    // P2-C Legacy: Compute from record for backward compatibility
    const legacyCalc = calculateShortlistingPotentialFromRecord({
      evidenceMapping: record.trace?.evidenceMapping || [],
      missingCapabilities: record.claimPermissions?.explicitUnknowns || [],
      matchingConfidence: record.confidences?.matching || 0,
      recommendationConfidence: record.confidences?.recommendation || 0,
      vetoed: record.vetoed || false,
      verb: record.verb,
      vetoReason: record.vetoReason || null
    });
    
    score = legacyCalc.score;
    requirementsScore = legacyCalc.requirementsScore;
    evidenceStrengthScore = legacyCalc.evidenceStrengthScore;
    titleScopeScore = legacyCalc.titleScopeScore;
    seniorityScore = legacyCalc.seniorityScore;
    domainScore = legacyCalc.domainScore;
  }

  // Extract component values for factor building
  const evidenceMapping = record.trace?.evidenceMapping || [];
  const missingCapabilities = record.claimPermissions?.explicitUnknowns || [];
  const highConfidenceMatches = evidenceMapping.filter(m => m.confidence >= 0.7).length;
  const totalCapabilities = evidenceMapping.length + missingCapabilities.length;

  // Build requirements alignment factor
  const requirementsAlignment: ShortlistingPotential["factors"]["requirementsAlignment"] =
    requirementsScore >= 75
      ? { status: "strong", evidence: `${highConfidenceMatches} strong capability matches` }
      : requirementsScore >= 50
        ? { status: "moderate", evidence: `Partial capability alignment` }
        : { status: "weak", evidence: `Limited explicit capability matches` };

  if (highConfidenceMatches > 0) {
    evidence.push(`Requirements: ${highConfidenceMatches} strong matches`);
  }

  // Build title/scope alignment factor
  const titleScopeAlignment: ShortlistingPotential["factors"]["titleScopeAlignment"] =
    titleScopeScore >= 75
      ? { status: "aligned", evidence: "Title and scope expectations align" }
      : titleScopeScore >= 50
        ? { status: "borderline", evidence: "Title or scope may require clarification" }
        : { status: "mismatched", evidence: "Title/scope concerns flagged" };

  // Build evidence strength factor
  const evidenceStrength: ShortlistingPotential["factors"]["evidenceStrength"] =
    evidenceStrengthScore >= 75
      ? { status: "strong", evidence: "High confidence in evidence" }
      : evidenceStrengthScore >= 50
        ? { status: "moderate", evidence: "Moderate evidence confidence" }
        : { status: "insufficient", evidence: "Limited or weak evidence" };

  evidence.push(`Evidence confidence: ${Math.round(evidenceStrengthScore)}%`);

  // 4. Seniority fit (P3-A: use seniorityScore instead of vetoReason)
  // The seniorityScore was computed from OpportunityAssessment/ExecutiveSeniorityAssessment
  let seniorityFit: ShortlistingPotential["factors"]["seniorityFit"];
  if (seniorityScore <= 60) {
    // overqualified (was 60 in P2-C calculation)
    seniorityFit = { status: "overqualified", evidence: "Seniority exceeds role requirements" };
    evidence.push("Seniority: overqualified for role scope");
  } else if (seniorityScore <= 70) {
    // aspirational/stretch (was 50 in P2-C calculation)
    seniorityFit = { status: "aspirational", evidence: "Role represents stretch or domain pivot" };
    evidence.push("Seniority: aspirational/stretch opportunity");
  } else {
    // qualified (was 80 in P2-C calculation)
    seniorityFit = { status: "qualified", evidence: "Seniority aligns with role requirements" };
    evidence.push("Seniority: qualified for role scope");
  }

  // 5. Domain fit (based on DOMAIN_FAMILIARITY gaps)
  const domainGaps = missingCapabilities.filter(c => c.includes("[DOMAIN_FAMILIARITY]"));
  let domainFit: ShortlistingPotential["factors"]["domainFit"];
  if (domainGaps.length === 0) {
    domainFit = { status: "native", evidence: "No domain familiarity gaps" };
    evidence.push("Domain: native fit");
  } else if (domainGaps.length <= 1) {
    domainFit = { status: "transferable", evidence: "Minor domain gap; adjacent experience transfers" };
    evidence.push("Domain: transferable with minor gaps");
  } else {
    domainFit = { status: "distant", evidence: "Multiple domain familiarity gaps" };
    evidence.push("Domain: distant; may affect initial screening");
  }

  // Determine likelihood and build statement
  let likelihood: ShortlistingPotential["likelihood"];
  let statement: string;
  let positioningAdvice: string;
  let primaryConcern: string | undefined;
  let confidence: number;

  if (score >= 75 && seniorityFit.status === "qualified" && domainFit.status !== "distant") {
    likelihood = "high";
    confidence = 0.85;
    statement = `Your profile should survive initial screening. ${highConfidenceMatches} strong capability matches and clear seniority alignment make you a credible candidate for shortlisting.`;
    positioningAdvice = `Emphasize ${highConfidenceMatches > 0 ? "specific capability matches" : "relevant experience"} in your initial outreach.`;
  } else if (score >= 60 || (seniorityFit.status === "aspirational" && score >= 50)) {
    likelihood = "moderate";
    confidence = 0.7;
    const concern = seniorityFit.status === "aspirational"
      ? "The stretch nature of the role may require validation"
      : domainFit.status === "distant"
        ? "Domain familiarity gap may raise initial questions"
        : "Some capability gaps may surface in screening";
    statement = `Moderate shortlisting potential. ${concern}, but your profile has sufficient alignment to warrant consideration.`;
    positioningAdvice = "Prepare specific examples addressing potential concerns before initial screening.";
    if (seniorityFit.status === "aspirational") primaryConcern = "Demonstrating readiness for the scope";
  } else if (score >= 40) {
    likelihood = "low";
    confidence = 0.65;
    statement = `Initial shortlisting is uncertain. ${requirementsAlignment.status === "weak" ? "Limited explicit capability matches" : "Concerns about fit"} may lead to early exclusion despite some relevant experience.`;
    positioningAdvice = "Consider whether a warm intro or targeted positioning could overcome initial screening filters.";
    primaryConcern = "Surviving initial capability filtering";
  } else {
    likelihood = "low";
    confidence = 0.75;
    statement = `Low probability of shortlisting. Significant gaps in required capabilities or seniority misalignment make initial screening unlikely.`;
    positioningAdvice = "Unless there are compelling strategic reasons, this may not justify the application effort.";
    primaryConcern = "Fundamental capability/seniority mismatch";
  }

  return {
    likelihood,
    score,
    statement,
    factors: {
      requirementsAlignment,
      titleScopeAlignment,
      evidenceStrength,
      seniorityFit,
      domainFit
    },
    primaryConcern,
    positioningAdvice,
    evidence: evidence.slice(0, 5),
    confidence
  };
}

/**
 * Format shortlisting potential for presentation
 */
export function formatShortlistingPotential(potential: ShortlistingPotential): string {
  return potential.statement;
}

/**
 * Get shortlisting indicator for UI
 */
export function getShortlistingIndicator(potential: ShortlistingPotential): {
  label: string;
  color: "green" | "amber" | "red" | "neutral";
} {
  switch (potential.likelihood) {
    case "high":
      return { label: "High Shortlisting Potential", color: "green" };
    case "moderate":
      return { label: "Moderate Shortlisting Potential", color: "amber" };
    case "low":
      return { label: "Low Shortlisting Potential", color: "red" };
    default:
      return { label: "Uncertain", color: "neutral" };
  }
}
