/**
 * StrategicAdvantageSynthesizer.ts
 *
 * P2-A: Executive Opportunity Intelligence
 *
 * Synthesizes "Why Me?" - the strategic advantage this candidate brings
 * to this specific opportunity based on:
 * - CORE_MANDATE capability matches (highest weight)
 * - Career trajectory alignment
 * - Unique capability combinations
 * - Domain experience transferability
 *
 * This is NOT a score. It is an interpretive synthesis for executive narrative.
 */

import type { RecommendationRecord } from "../record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";

export interface StrategicAdvantage {
  /** The synthesized "Why Me?" statement in executive language */
  statement: string;

  /** The primary advantage category */
  category:
    | "core_mandate_match"
    | "career_trajectory_alignment"
    | "capability_combination"
    | "domain_transfer"
    | "scale_precedent"
    | "transformation_experience"
    | "commercial_ownership";

  /** Evidence grounding for the advantage claim */
  evidence: string[];

  /** Confidence in this advantage assessment (0-1) */
  confidence: number;
}

/**
 * Synthesize strategic advantage from assessment outputs
 */
export function synthesizeStrategicAdvantage(
  record: RecommendationRecord,
  source: OpportunitySource
): StrategicAdvantage {
  const evidence: string[] = [];
  let category: StrategicAdvantage["category"] = "core_mandate_match";
  let confidence = 0.7;

  // 1. Analyze capability matches by tier
  const evidenceMapping = record.trace?.evidenceMapping || [];
  const coreMandateMatches = evidenceMapping.filter(
    (m) => m.confidence >= 0.7
  );
  const strongMatches = evidenceMapping.filter((m) => m.confidence >= 0.8);

  // 2. Extract candidate evidence from matched capabilities
  for (const match of strongMatches.slice(0, 2)) {
    if (match.candidateCapability && match.candidateCapability.length > 5) {
      evidence.push(match.candidateCapability);
    }
  }

  // 3. Determine advantage category based on match patterns
  const hasTransformation = evidenceMapping.some(
    (m) =>
      m.jobCapability?.toLowerCase().includes("transform") ||
      m.reason?.toLowerCase().includes("transform")
  );

  const hasCRM = evidenceMapping.some(
    (m) =>
      m.jobCapability?.toLowerCase().includes("crm") ||
      m.candidateCapability?.toLowerCase().includes("crm") ||
      m.candidateCapability?.toLowerCase().includes("salesforce")
  );

  const hasScale = evidenceMapping.some(
    (m) =>
      m.candidateCapability?.toLowerCase().includes("scale") ||
      m.candidateCapability?.toLowerCase().includes("portfolio") ||
      m.candidateCapability?.toLowerCase().includes("team")
  );

  const hasCommercial = evidenceMapping.some(
    (m) =>
      m.jobCapability?.toLowerCase().includes("commercial") ||
      m.jobCapability?.toLowerCase().includes("growth") ||
      m.jobCapability?.toLowerCase().includes("revenue")
  );

  // 4. Synthesize statement based on pattern
  let statement = "";

  if (hasTransformation && hasCRM && hasScale) {
    category = "transformation_experience";
    statement = `You bring a rare combination: enterprise-scale transformation leadership paired with proven CRM platform execution at ${getScaleDescription(
      evidence
    )}.`;
    confidence = 0.92;
  } else if (hasCRM && hasCommercial) {
    category = "core_mandate_match";
    statement = `Your CRM and commercial growth credentials align precisely with this mandate's core requirements.`;
    confidence = 0.88;
  } else if (hasTransformation && hasScale) {
    category = "transformation_experience";
    statement = `Your precedent running large-scale transformation programs is directly applicable to this scope.`;
    confidence = 0.85;
  } else if (strongMatches.length >= 3) {
    category = "capability_combination";
    statement = `Multiple capability dimensions align: ${strongMatches
      .slice(0, 2)
      .map((m) => m.jobCapability)
      .join(" and ")}.`;
    confidence = 0.82;
  } else if (coreMandateMatches.length >= 1) {
    category = "core_mandate_match";
    statement = `Core mandate requirements match your established capabilities.`;
    confidence = 0.75;
  } else {
    category = "domain_transfer";
    statement = `Adjacent capabilities may transfer; direct precedent is limited.`;
    confidence = 0.55;
  }

  // 5. Add career trajectory context if available
  const careerValue = record.decisionSummary?.careerValue;
  if (careerValue && careerValue > 70) {
    statement += " The role represents clear career progression.";
    confidence = Math.min(0.95, confidence + 0.05);
  }

  return {
    statement,
    category,
    evidence: evidence.slice(0, 3),
    confidence,
  };
}

/**
 * Extract scale description from evidence
 */
function getScaleDescription(evidence: string[]): string {
  const scaleEvidence = evidence.find(
    (e) =>
      e.toLowerCase().includes("market") ||
      e.toLowerCase().includes("portfolio") ||
      e.toLowerCase().includes("team") ||
      e.toLowerCase().includes("p&l")
  );

  if (scaleEvidence) {
    // Extract scale indicator
    const matches = scaleEvidence.match(
      /(\d+)\s*(market|portfolio|team|member|people|crore|cr|million|mn)/i
    );
    if (matches) {
      return `${matches[1]}+ ${matches[2].toLowerCase()} scale`;
    }
  }

  return "multi-market scale";
}

/**
 * Format strategic advantage for presentation
 */
export function formatStrategicAdvantage(
  advantage: StrategicAdvantage
): string {
  if (advantage.confidence < 0.6) {
    return `Strategic advantage unclear: ${advantage.statement}`;
  }
  return advantage.statement;
}
