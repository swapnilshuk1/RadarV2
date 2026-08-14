/**
 * CapabilityImportanceSynthesizer.ts
 *
 * P2-B: Capability Importance Interpretation
 *
 * Answers: "Which requirements actually matter most for this specific opportunity?"
 *
 * Interprets the capability taxonomy (CORE_MANDATE, EXECUTION_CAPABILITY,
 * TECHNOLOGY_STACK, DOMAIN_FAMILIARITY) to help executives understand:
 * - What the role fundamentally requires
 * - Where their strongest evidence aligns
 * - Which gaps actually matter
 * - Which gaps are peripheral
 *
 * Uses existing authoritative assessment and evidence.
 * Does NOT recompute scores or change DecisionPolicy semantics.
 */

import type { RecommendationRecord } from "../record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";

export interface CapabilityImportanceProfile {
  /** What the role fundamentally requires */
  fundamentalRequirements: string;

  /** Which capability tier matters most */
  primaryTier: "core_mandate" | "execution_capability" | "balanced" | "unclear";

  /** Where candidate evidence is strongest */
  strongestAlignment: string;

  /** Which gaps actually matter */
  materialGaps: string[];

  /** Which gaps are peripheral (don't block pursuit) */
  peripheralGaps: string[];

  /** Interpretive statement for executive */
  statement: string;

  /** Evidence grounding */
  evidence: string[];

  /** Confidence in interpretation */
  confidence: number;
}

/**
 * Synthesize capability importance profile
 */
export function synthesizeCapabilityImportance(
  record: RecommendationRecord,
  source: OpportunitySource
): CapabilityImportanceProfile {
  const evidenceMapping = record.trace?.evidenceMapping || [];
  const missingCapabilities = record.claimPermissions?.explicitUnknowns || [];

  // Analyze matches by tier
  const coreMatches = evidenceMapping.filter(m =>
    m.jobCapability?.includes("[CORE_MANDATE]") && m.confidence >= 0.7
  );
  const executionMatches = evidenceMapping.filter(m =>
    m.jobCapability?.includes("[EXECUTION_CAPABILITY]") && m.confidence >= 0.6
  );
  const techMatches = evidenceMapping.filter(m =>
    m.jobCapability?.includes("[TECHNOLOGY_STACK]") && m.confidence >= 0.5
  );
  const domainMatches = evidenceMapping.filter(m =>
    m.jobCapability?.includes("[DOMAIN_FAMILIARITY]") && m.confidence >= 0.5
  );

  // Analyze gaps by tier
  const coreGaps = missingCapabilities.filter(c => c.includes("[CORE_MANDATE]"));
  const executionGaps = missingCapabilities.filter(c => c.includes("[EXECUTION_CAPABILITY]"));
  const techGaps = missingCapabilities.filter(c => c.includes("[TECHNOLOGY_STACK]"));
  const domainGaps = missingCapabilities.filter(c => c.includes("[DOMAIN_FAMILIARITY]"));

  // Collect evidence
  const evidence: string[] = [];
  if (coreMatches.length > 0) {
    evidence.push(`${coreMatches.length} strong CORE_MANDATE matches`);
  }
  if (coreGaps.length > 0) {
    evidence.push(`${coreGaps.length} CORE_MANDATE gaps`);
  }
  if (executionMatches.length > 0) {
    evidence.push(`${executionMatches.length} EXECUTION_CAPABILITY matches`);
  }

  // Determine primary tier importance
  let primaryTier: CapabilityImportanceProfile["primaryTier"];
  let fundamentalRequirements: string;
  let statement: string;
  let confidence: number;

  // Pattern 1: Core-mandate dominant role
  if (coreMatches.length >= 2 || (coreMatches.length >= 1 && coreGaps.length === 0)) {
    primaryTier = "core_mandate";
    confidence = 0.85;

    const matchedCore = coreMatches.slice(0, 2).map(m =>
      m.jobCapability?.replace(/\[.*?\]/g, "").trim()
    ).join(" and ");

    fundamentalRequirements = `The role is fundamentally about ${matchedCore || "strategic leadership"}. These core mandate requirements are non-negotiable for success.`;

    if (coreGaps.length === 0) {
      statement = `This role's success depends most on ${matchedCore || "core strategic capabilities"}, where your evidence is strong. The fundamental requirements align with your established executive profile.`;
    } else {
      const gapNames = coreGaps.slice(0, 2).map(g => g.replace(/\[.*?\]/g, "").trim()).join(" and ");
      statement = `This role fundamentally requires ${matchedCore || "strategic leadership"}. While you match core elements, ${gapNames} ${coreGaps.length > 1 ? "are" : "is"} central to the mandate and may require validation.`;
    }

  // Pattern 2: Execution capability heavy
  } else if (executionMatches.length >= 3 && coreGaps.length <= 1) {
    primaryTier = "execution_capability";
    confidence = 0.75;

    fundamentalRequirements = "The role emphasizes operational execution and delivery capabilities alongside strategic direction.";

    statement = `While strategic mandate matters, this role places significant weight on execution capabilities${executionGaps.length > 0 ? ", where some gaps exist" : " that you demonstrate well"}. The requirement is for leaders who can both set direction and drive implementation.`;

  // Pattern 3: Balanced / mixed
  } else if (coreMatches.length + executionMatches.length >= 2) {
    primaryTier = "balanced";
    confidence = 0.7;

    fundamentalRequirements = "The role requires a balance of strategic mandate ownership and execution delivery.";

    statement = `The role values both strategic mandate clarity and execution capability. Neither dominates absolutely; success requires credible evidence across both dimensions.`;

  // Pattern 4: Unclear / limited evidence
  } else {
    primaryTier = "unclear";
    confidence = 0.5;

    fundamentalRequirements = "Fundamental requirements are not clearly specified in available evidence.";

    statement = `Available evidence does not clearly indicate which capability tiers matter most. Direct validation with the hiring team would clarify the actual priority of strategic vs. execution requirements.`;
  }

  // Identify strongest alignment
  let strongestAlignment: string;
  if (coreMatches.length > 0 && coreMatches[0].confidence >= 0.8) {
    strongestAlignment = `Strongest evidence in core mandate: ${coreMatches[0].candidateCapability?.slice(0, 60) || "strategic capabilities"}...`;
  } else if (executionMatches.length > 0 && executionMatches[0].confidence >= 0.7) {
    strongestAlignment = `Strong evidence in execution: ${executionMatches[0].candidateCapability?.slice(0, 60) || "delivery capabilities"}...`;
  } else if (techMatches.length > 0) {
    strongestAlignment = `Demonstrated technology/platform experience`;
  } else {
    strongestAlignment = `Evidence strength varies; validation recommended`;
  }

  // Separate material vs peripheral gaps
  const materialGaps: string[] = [];
  const peripheralGaps: string[] = [];

  // Core mandate gaps are always material
  coreGaps.forEach(gap => {
    const cleanGap = gap.replace(/\[.*?\]/g, "").trim();
    materialGaps.push(cleanGap);
  });

  // Execution gaps are material if core is solid
  if (coreGaps.length === 0) {
    executionGaps.slice(0, 2).forEach(gap => {
      const cleanGap = gap.replace(/\[.*?\]/g, "").trim();
      materialGaps.push(cleanGap);
    });
  } else {
    executionGaps.forEach(gap => {
      const cleanGap = gap.replace(/\[.*?\]/g, "").trim();
      peripheralGaps.push(cleanGap);
    });
  }

  // Tech/domain gaps are peripheral unless they're the primary concern
  if (primaryTier === "execution_capability") {
    techGaps.slice(0, 1).forEach(gap => {
      const cleanGap = gap.replace(/\[.*?\]/g, "").trim();
      materialGaps.push(cleanGap);
    });
    techGaps.slice(1).forEach(gap => {
      const cleanGap = gap.replace(/\[.*?\]/g, "").trim();
      peripheralGaps.push(cleanGap);
    });
  } else {
    techGaps.forEach(gap => {
      const cleanGap = gap.replace(/\[.*?\]/g, "").trim();
      peripheralGaps.push(cleanGap);
    });
  }

  domainGaps.forEach(gap => {
    const cleanGap = gap.replace(/\[.*?\]/g, "").trim();
    peripheralGaps.push(cleanGap);
  });

  return {
    fundamentalRequirements,
    primaryTier,
    strongestAlignment,
    materialGaps: materialGaps.slice(0, 3),
    peripheralGaps: peripheralGaps.slice(0, 3),
    statement,
    evidence: evidence.slice(0, 4),
    confidence
  };
}

/**
 * Format capability importance for presentation
 */
export function formatCapabilityImportance(profile: CapabilityImportanceProfile): string {
  return profile.statement;
}

/**
 * Get capability tier indicator for UI
 */
export function getCapabilityTierIndicator(profile: CapabilityImportanceProfile): {
  label: string;
  color: "green" | "amber" | "blue" | "neutral";
} {
  switch (profile.primaryTier) {
    case "core_mandate":
      return { label: "Core Mandate Focus", color: "green" };
    case "execution_capability":
      return { label: "Execution Heavy", color: "amber" };
    case "balanced":
      return { label: "Balanced Requirements", color: "blue" };
    default:
      return { label: "Unclear Priorities", color: "neutral" };
  }
}
