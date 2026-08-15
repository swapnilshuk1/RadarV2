/**
 * PrincipalRiskSynthesizer.ts
 *
 * P2-A.2: Principal Risk Intelligence
 *
 * Synthesizes "What is the main thing that could prevent this executive from
 * being shortlisted or make this opportunity less attractive?"
 *
 * Converts authoritative evidence + assessment + decision information into
 * a concise executive-facing risk statement.
 *
 * This is NOT a re-ranking or scoring change. It is interpretive synthesis
 * that explains the principal risk in executive language.
 */

import type { RecommendationRecord } from "../record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";
import { unwrapEvidenceValue } from "./SemanticNaturalLanguageResolver";

export interface PrincipalRisk {
  /** The synthesized risk statement in executive language */
  statement: string;

  /** The primary risk category */
  category:
    | "material_capability_gap"
    | "missing_evidence"
    | "career_trajectory_concern"
    | "identity_domain_concern"
    | "engagement_lifestyle_concern"
    | "job_spec_uncertainty"
    | "no_material_risk";

  /** Evidence grounding for the risk claim */
  evidence: string[];

  /** What the executive can do about this risk, if applicable */
  mitigation?: string;

  /** Confidence in this risk assessment (0-1) */
  confidence: number;

  /** Severity level for executive attention */
  severity: "high" | "medium" | "low";
}

/**
 * Synthesize principal risk from assessment outputs
 */
export function synthesizePrincipalRisk(
  record: RecommendationRecord,
  source: OpportunitySource
): PrincipalRisk {
  const evidence: string[] = [];
  let confidence = 0.7;
  let severity: PrincipalRisk["severity"] = "medium";

  const roleTitle = source.role || "Executive Role";
  const companyName = source.company || "Target Company";

  // 1. Analyze authoritative decision risks (highest priority)
  const decisionRisks = record.decisionRisks || [];

  // 2. Extract capability gaps from trace
  const evidenceMapping = record.trace?.evidenceMapping || [];
  const missingCapabilities = record.claimPermissions?.explicitUnknowns || [];

  // 3. Categorize gaps by tier
  const coreMandateGaps: string[] = [];
  const executionGaps: string[] = [];
  const techStackGaps: string[] = [];
  const domainGaps: string[] = [];

  for (const gap of missingCapabilities) {
    if (gap.includes("[CORE_MANDATE]")) {
      coreMandateGaps.push(gap);
    } else if (gap.includes("[EXECUTION_CAPABILITY]")) {
      executionGaps.push(gap);
    } else if (gap.includes("[TECHNOLOGY_STACK]")) {
      techStackGaps.push(gap);
    } else if (gap.includes("[DOMAIN_FAMILIARITY]")) {
      domainGaps.push(gap);
    }
  }

  // 4. Check for specific risk patterns in decision risks
  const hasCareerRegression = decisionRisks.some(
    (r) =>
      r.factor.toLowerCase().includes("regression") ||
      r.evidence?.toLowerCase().includes("regression")
  );

  const hasIdentityMismatch = decisionRisks.some(
    (r) =>
      r.factor.toLowerCase().includes("identity") ||
      r.factor.toLowerCase().includes("distance")
  );

  const hasLocationFriction = decisionRisks.some(
    (r) =>
      r.factor.toLowerCase().includes("location") ||
      r.evidence?.toLowerCase().includes("location")
  );

  // 5. Check for evidence gaps
  const missingEvidence = record.explanation?.missingEvidence || [];
  const hasMissingEvidence = missingEvidence.length > 0;

  // 6. Synthesize risk based on priority hierarchy

  // Priority 1: Material CORE_MANDATE gap - fundamental to role
  if (coreMandateGaps.length > 0) {
    const gapCapability = extractCapabilityName(coreMandateGaps[0]);
    evidence.push(`Missing core mandate: ${gapCapability}`);

    // Check if we have any mitigating evidence
    const mitigatingEvidence = evidenceMapping.filter(
      (m) => m.confidence >= 0.6 && m.candidateCapability
    );

    if (mitigatingEvidence.length > 0) {
      evidence.push(
        `Mitigating: ${mitigatingEvidence[0].candidateCapability.slice(0, 60)}...`
      );
      confidence = 0.65;
      severity = "medium";
      return {
        statement: `The ${roleTitle} mandate at ${companyName} requires ${gapCapability.toLowerCase()} where your direct precedent is limited. This remains a primary interview validation point.`,
        category: "material_capability_gap",
        evidence: evidence.slice(0, 3),
        mitigation:
          "Prepare a narrative showing transferable skills from similar contexts",
        confidence,
        severity,
      };
    }

    confidence = 0.55;
    severity = "high";
    return {
      statement: `Limited evidence of ${gapCapability.toLowerCase()} for the ${roleTitle} opening at ${companyName}. This core gap will likely surface in initial screening.`,
      category: "material_capability_gap",
      evidence: evidence.slice(0, 3),
      confidence,
      severity,
    };
  }

  // Priority 2: Career regression concern
  if (hasCareerRegression) {
    const regressionRisk = decisionRisks.find((r) =>
      r.factor.toLowerCase().includes("regression")
    );
    evidence.push(regressionRisk?.evidence || "Career trajectory analysis");

    confidence = 0.75;
    severity = "high";
    return {
      statement: `The operating level and scope for ${roleTitle} at ${companyName} represent a step back from your current trajectory. The primary risk is career deceleration.`,
      category: "career_trajectory_concern",
      evidence: evidence.slice(0, 3),
      mitigation: "Verify if there's a fast-track path to broader scope within 12-18 months",
      confidence,
      severity,
    };
  }

  // Priority 3: Identity/domain mismatch
  if (hasIdentityMismatch) {
    const identityRisk = decisionRisks.find(
      (r) =>
        r.factor.toLowerCase().includes("identity") ||
        r.factor.toLowerCase().includes("distance")
    );
    evidence.push(identityRisk?.evidence || "Identity alignment analysis");

    confidence = 0.8;
    severity = "high";
    return {
      statement: `This ${roleTitle} role at ${companyName} operates in a separate functional domain from your core executive expertise. Positioning credibility is the primary bottleneck.`,
      category: "identity_domain_concern",
      evidence: evidence.slice(0, 3),
      mitigation: "Consider whether domain pivot is intentional career strategy",
      confidence,
      severity,
    };
  }

  // Priority 4: Missing evidence / job spec uncertainty
  if (hasMissingEvidence && record.verb !== "PASS") {
    const keyGaps = missingEvidence.slice(0, 2);
    evidence.push(`Missing evidence on: ${keyGaps.join(", ")}`);

    confidence = 0.5;
    severity = "medium";
    return {
      statement: `Key details are unavailable in ${companyName}'s posting — ${keyGaps.join(", ")}. The risk is pursuing an opportunity with undefined scope or expectations.`,
      category: "job_spec_uncertainty",
      evidence: evidence.slice(0, 3),
      mitigation: "Request full JD and direct reporting line details before investing time",
      confidence,
      severity,
    };
  }

  // Priority 5: Location/lifestyle friction
  if (hasLocationFriction) {
    const locationRisk = decisionRisks.find(
      (r) =>
        r.factor.toLowerCase().includes("location") ||
        r.evidence?.toLowerCase().includes("location")
    );
    evidence.push(locationRisk?.evidence || "Location analysis");

    confidence = 0.7;
    severity = "medium";
    return {
      statement: `The location or working model for ${roleTitle} at ${companyName} creates practical friction. This is a lifestyle alignment risk.`,
      category: "engagement_lifestyle_concern",
      evidence: evidence.slice(0, 3),
      mitigation: "Verify flexibility in working arrangement before proceeding",
      confidence,
      severity,
    };
  }

  // Priority 6: No material risk for PURSUE
  if (record.verb === "PURSUE") {
    confidence = 0.85;
    severity = "low";
    return {
      statement: `No material structural risk identified for ${roleTitle} at ${companyName}. Proceed with standard executive due diligence.`,
      category: "no_material_risk",
      evidence: ["Comprehensive capability match", "Strong evidence grounding"],
      confidence,
      severity,
    };
  }

  // Default: Secondary execution or domain gaps
  if (executionGaps.length > 0 || techStackGaps.length > 0) {
    const gap = executionGaps[0] || techStackGaps[0];
    const gapName = extractCapabilityName(gap);
    evidence.push(`Secondary gap: ${gapName}`);

    confidence = 0.6;
    severity = "low";
    return {
      statement: `Secondary execution gap in ${gapName.toLowerCase()} for ${roleTitle}. Manageable through team composition or strategic advisory.`,
      category: "material_capability_gap",
      evidence: evidence.slice(0, 3),
      confidence,
      severity,
    };
  }

  // Fallback
  return {
    statement: `Standard evaluation risks apply for ${roleTitle} at ${companyName}. Verify reporting line, P&L ceiling, and strategic mandate during initial conversation.`,
    category: "job_spec_uncertainty",
    evidence: ["Standard assessment baseline"],
    confidence: 0.5,
    severity: "low",
  };
}

export function formatPrincipalRisk(risk: PrincipalRisk): string {
  return risk.statement;
}

/**
 * Extract clean capability name from tag string
 */
function extractCapabilityName(tag: string): string {
  const unwrapped = unwrapEvidenceValue(tag);
  return unwrapped
    .replace(/\[CORE_MANDATE\]/g, "")
    .replace(/\[EXECUTION_CAPABILITY\]/g, "")
    .replace(/\[TECHNOLOGY_STACK\]/g, "")
    .replace(/\[DOMAIN_FAMILIARITY\]/g, "")
    .replace(/_/g, " ")
    .trim();
}
