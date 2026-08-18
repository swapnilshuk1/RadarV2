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
import { unwrapEvidenceValue } from "./SemanticNaturalLanguageResolver";

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

function cleanCapName(rawCap: any): string {
  if (!rawCap) return "core functional requirements";
  const unwrapped = unwrapEvidenceValue(rawCap);
  if (!unwrapped || unwrapped.startsWith("{") || unwrapped.includes("value")) {
    return "core functional requirements";
  }
  // If it's a long sentence from JD, extract up to 40 chars or return fallback
  if (unwrapped.length > 50) {
    const firstPhrase = unwrapped.split(/[,.;:-]/)[0]?.trim();
    if (firstPhrase && firstPhrase.length <= 40) return firstPhrase;
    return "core functional requirements";
  }
  return unwrapped;
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

  const roleTitle = source.role || "Executive Role";
  const companyName = source.company || "Target Company";

  // 1. Analyze capability matches by tier
  const evidenceMapping = record.trace?.evidenceMapping || [];
  const coreMandateMatches = evidenceMapping.filter(
    (m) => m.confidence >= 0.7
  );
  const strongMatches = evidenceMapping.filter((m) => m.confidence >= 0.8);

  // 2. Check for domain or functional mismatches in decision risks
  const decisionRisks = record.decisionRisks || [];
  const hasDomainMismatch = decisionRisks.some(
    (r) =>
      r.factor.toLowerCase().includes("domain") ||
      r.factor.toLowerCase().includes("identity") ||
      r.factor.toLowerCase().includes("distance") ||
      r.evidence?.toLowerCase().includes("functional domain")
  );

  const hasCoreMandateGap = decisionRisks.some(
    (r) =>
      r.factor.toLowerCase().includes("capability gap") ||
      r.evidence?.toLowerCase().includes("precedent is limited") ||
      r.evidence?.toLowerCase().includes("lacks core mandate")
  );

  // Extract candidate evidence from matched capabilities
  for (const match of strongMatches.slice(0, 2)) {
    if (match.candidateCapability && match.candidateCapability.length > 5) {
      evidence.push(unwrapEvidenceValue(match.candidateCapability));
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

  if (hasDomainMismatch) {
    category = "domain_transfer";
    statement = `Your executive leadership track at scale provides strategic perspective for ${companyName}, though this ${roleTitle} mandate sits in a distinct functional domain.`;
    confidence = 0.55;
  } else if (hasCoreMandateGap) {
    category = "domain_transfer";
    const gapCap = cleanCapName(strongMatches[0]?.jobCapability);
    statement = `Your commercial trajectory offers adjacent transferability for ${companyName}, though direct operational precedent in ${gapCap} remains limited.`;
    confidence = 0.60;
  } else if (hasTransformation && hasCRM && hasScale) {
    category = "transformation_experience";
    statement = `You bring a rare combination for ${companyName}: enterprise-scale transformation leadership paired with proven CRM platform execution.`;
    confidence = 0.92;
  } else if (hasCRM && hasCommercial) {
    category = "core_mandate_match";
    statement = `Your CRM and commercial growth credentials align precisely with ${companyName}'s ${roleTitle} requirements.`;
    confidence = 0.88;
  } else if (hasTransformation && hasScale) {
    category = "transformation_experience";
    statement = `Your precedent running large-scale transformation programs directly matches ${companyName}'s ${roleTitle} mandate.`;
    confidence = 0.85;
  } else if (strongMatches.length >= 2) {
    category = "capability_combination";
    const cap1 = cleanCapName(strongMatches[0].jobCapability);
    const cap2 = cleanCapName(strongMatches[1].jobCapability);
    statement = `Your experience in ${cap1} and ${cap2} aligns directly with ${companyName}'s expectations for this ${roleTitle} seat.`;
    confidence = 0.82;
  } else if (coreMandateMatches.length >= 1) {
    category = "core_mandate_match";
    const cap = cleanCapName(coreMandateMatches[0].jobCapability);
    statement = `Your background in ${cap} aligns directly with the core requirements for the ${roleTitle} role at ${companyName}.`;
    confidence = 0.75;
  } else {
    category = "domain_transfer";
    statement = `Your broad executive portfolio offers transferable leadership for ${companyName}'s ${roleTitle} opening, though direct sector precedent is limited.`;
    confidence = 0.55;
  }

  // 5. Add career trajectory context if available
  const careerValue = record.decisionSummary?.careerValue;
  if (careerValue && careerValue > 70 && !hasDomainMismatch && !hasCoreMandateGap) {
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

export function formatStrategicAdvantage(sa: StrategicAdvantage): string {
  return sa.statement;
}
