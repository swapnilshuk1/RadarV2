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
 *
 * Evidence Sources:
 * - decisionRisks[]: authoritative risks from DecisionPolicyEngine
 * - trace.evidenceMapping[]: capability match evidence with confidence
 * - claimPermissions.explicitUnknowns/explicitRisks: known gaps
 * - explanation.missingEvidence: evidence gaps that create uncertainty
 * - career trajectory: FORWARD/LATERAL/BACKWARD status
 * - mandateSeniority: QUALIFIED/BORDERLINE/SUB_TIER status
 */

import type { RecommendationRecord } from "../record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";

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
 *
 * Returns a risk statement that explains:
 * 1. What the risk is
 * 2. Why it matters for this specific opportunity
 * 3. What candidate evidence creates or mitigates the risk
 * 4. Where appropriate, what the executive can do about it
 */
export function synthesizePrincipalRisk(
  record: RecommendationRecord,
  source: OpportunitySource
): PrincipalRisk {
  const evidence: string[] = [];
  let confidence = 0.7;
  let severity: PrincipalRisk["severity"] = "medium";

  // 1. Analyze authoritative decision risks (highest priority)
  const decisionRisks = record.decisionRisks || [];
  const hasDecisionRisks = decisionRisks.length > 0;

  // 2. Extract capability gaps from trace
  const evidenceMapping = record.trace?.evidenceMapping || [];
  const lowConfidenceMatches = evidenceMapping.filter((m) => m.confidence < 0.5);
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

  const hasCapabilityGap = decisionRisks.some(
    (r) => r.factor.toLowerCase().includes("capability gap")
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
        statement: `Core mandate requires ${gapCapability.toLowerCase()} where your precedent is limited. Your adjacent capabilities may transfer, but this remains a primary interview validation point.`,
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
      statement: `Limited evidence of ${gapCapability.toLowerCase()} — a core requirement for this mandate. This gap will likely surface in screening.`,
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
      statement: `The operating level and scope represent a step back from your current trajectory. The primary risk is career deceleration, not capability mismatch.`,
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
      statement: `This role operates in a different functional domain than your core executive expertise. The principal risk is positioning credibility in a non-native territory.`,
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
      statement: `Key details are unavailable in the posting — ${keyGaps.join(", ")}. The risk is pursuing an opportunity with undefined scope or expectations.`,
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
      statement: `The location or working model creates practical friction. This is a lifestyle alignment risk rather than a capability concern.`,
      category: "engagement_lifestyle_concern",
      evidence: evidence.slice(0, 3),
      mitigation: "Verify flexibility in working arrangement before proceeding",
      confidence,
      severity,
    };
  }

  // Priority 6: No material risk for PURSUE with strong matches (check before peripheral gaps)
  if (record.verb === "PURSUE") {
    confidence = 0.85;
    severity = "low";
    return {
      statement: `No material risk identified in current assessment. Proceed with standard due diligence.`,
      category: "no_material_risk",
      evidence: ["Comprehensive capability match", "Strong evidence grounding"],
      confidence,
      severity,
    };
  }

  // Priority 7: Execution/technology gaps (less critical than core mandate, only if not PURSUE)
  if (executionGaps.length > 0 || techStackGaps.length > 0) {
    const gap = executionGaps[0] || techStackGaps[0];
    const gapCapability = extractCapabilityName(gap);
    evidence.push(`Execution gap: ${gapCapability}`);

    confidence = 0.6;
    severity = "low";
    return {
      statement: `${gapCapability} is listed in the requirements; this is a bridgeable execution gap rather than a core mandate mismatch.`,
      category: "material_capability_gap",
      evidence: evidence.slice(0, 3),
      mitigation: "Prepare examples of adjacent tool/platform experience",
      confidence,
      severity,
    };
  }

  // Priority 8: Domain familiarity gaps
  if (domainGaps.length > 0) {
    const domainGap = domainGaps[0];
    const gapCapability = extractCapabilityName(domainGap);
    evidence.push(`Domain gap: ${gapCapability}`);

    confidence = 0.55;
    severity = "medium";
    return {
      statement: `The industry domain requires ${gapCapability.toLowerCase()} where your direct precedent is limited. This may affect initial credibility.`,
      category: "identity_domain_concern",
      evidence: evidence.slice(0, 3),
      mitigation: "Frame transferable domain patterns from adjacent industries",
      confidence,
      severity,
    };
  }

  // Priority 9: Low-confidence evidence matches
  if (lowConfidenceMatches.length > 0 && record.verb === "CONSIDER") {
    evidence.push("Multiple capability matches below confidence threshold");

    confidence = 0.5;
    severity = "medium";
    return {
      statement: `Several claimed capability matches lack strong evidentiary support. The risk is overestimating fit based on weak signal.`,
      category: "missing_evidence",
      evidence: evidence.slice(0, 3),
      mitigation: "Validate key capabilities with specific examples in initial conversation",
      confidence,
      severity,
    };
  }

  // Default for PASS or edge cases
  confidence = 0.5;
  severity = "medium";
  return {
    statement: hasDecisionRisks
      ? `${decisionRisks[0].factor}: ${decisionRisks[0].evidence}`
      : `Assessment identified concerns that warrant careful consideration before proceeding.`,
    category: hasDecisionRisks ? "material_capability_gap" : "job_spec_uncertainty",
    evidence: decisionRisks.length > 0 ? [decisionRisks[0].evidence] : ["Assessment analysis"],
    confidence,
    severity,
  };
}

/**
 * Extract clean capability name from gap string
 */
function extractCapabilityName(gapString: string): string {
  // Remove tier markers like [CORE_MANDATE], [EXECUTION_CAPABILITY], etc.
  return gapString
    .replace(/\s*\[[^\]]+\]\s*/g, "")
    .replace(/_/g, " ")
    .trim();
}

/**
 * Format principal risk for presentation
 */
export function formatPrincipalRisk(risk: PrincipalRisk): string {
  if (risk.confidence < 0.5) {
    return `Risk unclear: ${risk.statement}`;
  }
  return risk.statement;
}

/**
 * Get risk severity indicator for UI
 */
export function getRiskSeverityIndicator(risk: PrincipalRisk): {
  label: string;
  color: "red" | "amber" | "green";
} {
  if (risk.severity === "high") {
    return { label: "High Risk", color: "red" };
  } else if (risk.severity === "medium") {
    return { label: "Moderate Risk", color: "amber" };
  }
  return { label: "Low Risk", color: "green" };
}
