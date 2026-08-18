/**
 * ConfidenceSynthesizer.ts
 *
 * P2-F: Confidence / Uncertainty Intelligence
 *
 * Makes confidence actionable. Does NOT implement blanket:
 * - confidence < 0.50 → PASS
 *
 * Instead:
 * - HIGH confidence: decisive recommendation
 * - MODERATE confidence: recommendation + relevant validation point
 * - LOW confidence: explicitly identify what is uncertain
 * - SPARSE_SPEC / NOT_EVALUABLE: no fabricated recommendation
 *
 * Question: "What does RADAR not know that matters?"
 */

import type { RecommendationRecord } from "../record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";

export type ConfidenceLevel = "high" | "moderate" | "low" | "insufficient";

export interface ConfidenceInterpretation {
  /** Confidence level category */
  level: ConfidenceLevel;

  /** Numerical confidence score */
  score: number;

  /** Interpretive statement about confidence */
  statement: string;

  /** What RADAR knows with confidence */
  known: string[];

  /** What RADAR does not know that matters */
  unknowns: string[];

  /** Specific validation needed */
  validationNeeded?: string;

  /** Whether to trust the recommendation */
  trustLevel: "proceed" | "proceed_with_validation" | "pause_and_validate" | "insufficient_evidence";

  /** Evidence grounding for confidence assessment */
  evidence: string[];

  /** Confidence in this interpretation */
  confidence: number;
}

/**
 * Synthesize confidence interpretation
 */
export function synthesizeConfidence(
  record: RecommendationRecord,
  source: OpportunitySource
): ConfidenceInterpretation {
  const evidence: string[] = [];
  const known: string[] = [];
  const unknowns: string[] = [];

  // Extract confidence from record
  const confidenceScore = record.confidence ?? 0.5;
  const confidences = record.confidences;
  const vetoed = record.vetoed;
  const verb = record.verb;

  // Build known/unknown based on evidence
  if (confidences) {
    if (confidences.parsing >= 0.7) {
      known.push("Job specification is well-parsed");
      evidence.push(`Parsing confidence: ${confidences.parsing}`);
    } else {
      unknowns.push("Job specification parsing quality");
    }

    if (confidences.matching >= 0.7) {
      known.push("Capability matches are well-grounded");
      evidence.push(`Matching confidence: ${confidences.matching}`);
    } else {
      unknowns.push("Capability matching quality");
    }

    if (confidences.recommendation >= 0.7) {
      known.push("Recommendation is well-supported");
      evidence.push(`Recommendation confidence: ${confidences.recommendation}`);
    } else {
      unknowns.push("Recommendation strength");
    }
  }

  // Check for missing evidence
  if (record.claimPermissions?.explicitUnknowns?.length) {
    record.claimPermissions.explicitUnknowns.forEach((u) => {
      unknowns.push(u.replace(/\[.*?\]/g, "").trim());
    });
  }

  // Determine confidence level and build interpretation
  let level: ConfidenceLevel;
  let statement: string;
  let trustLevel: ConfidenceInterpretation["trustLevel"];
  let validationNeeded: string | undefined;

  if (verb === "SPARSE_SPEC" || verb === "NOT_EVALUABLE") {
    level = "insufficient";
    trustLevel = "insufficient_evidence";
    statement = "Insufficient evidence to form a reliable assessment.";
    unknowns.push("Complete job specification");
    validationNeeded = "Request full job description before assessment";
  } else if (confidenceScore >= 0.75) {
    level = "high";
    trustLevel = "proceed";
    statement = "High confidence assessment based on strong evidence grounding.";

    if (vetoed) {
      statement += " Veto triggered by clear disqualifying factor.";
    }
  } else if (confidenceScore >= 0.5) {
    level = "moderate";
    trustLevel = "proceed_with_validation";
    statement = "Moderate confidence assessment. Proceed with specific validation.";

    if (unknowns.length > 0) {
      validationNeeded = `Validate: ${unknowns.slice(0, 3).join("; ")}`;
    }
  } else {
    level = "low";
    trustLevel = "pause_and_validate";
    statement = "Low confidence assessment. Significant uncertainty exists.";

    if (unknowns.length > 0) {
      validationNeeded = `Critical gaps: ${unknowns.slice(0, 3).join("; ")}`;
    } else {
      validationNeeded = "Request additional information before proceeding";
    }
  }

  return {
    level,
    score: Math.round(confidenceScore * 100) / 100,
    statement,
    known,
    unknowns,
    validationNeeded,
    trustLevel,
    evidence,
    confidence: Math.max(confidenceScore, 0.5)
  };
}

/**
 * Format confidence for presentation
 */
export function formatConfidence(conf: ConfidenceInterpretation): string {
  if (conf.level === "insufficient") {
    return `${conf.statement} ${conf.validationNeeded || ""}`;
  }
  return `${conf.statement} ${conf.validationNeeded || ""}`;
}

/**
 * Get confidence indicator for UI
 */
export function getConfidenceIndicator(conf: ConfidenceInterpretation): {
  label: string;
  color: "green" | "amber" | "red" | "neutral";
} {
  switch (conf.level) {
    case "high":
      return { label: "High Confidence", color: "green" };
    case "moderate":
      return { label: "Moderate Confidence", color: "amber" };
    case "low":
      return { label: "Low Confidence", color: "red" };
    default:
      return { label: "Insufficient Evidence", color: "neutral" };
  }
}
