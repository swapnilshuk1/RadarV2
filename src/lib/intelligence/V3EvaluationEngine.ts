/**
 * V3EvaluationEngine.ts
 *
 * Implements Phase 5 (Stateless Evaluation Engine).
 * A pure, stateless domain compiler that evaluates a candidate snapshot against opportunity.
 *
 * Invariant: Always produces identical metrics, findings, and recommendations for the same input.
 */

import { CapabilityRegistry } from "../capability/Registry";
import type { CandidateProjection } from "../domain/candidate";
import type { CandidateIntent } from "../domain/intent";
import type { OpportunityIdentity } from "../domain/opportunity";
import type { EvaluationResult, EvaluationMetrics, EvaluationFindings } from "../domain/evaluation";

export class V3EvaluationEngine {
  /**
   * Evaluates Candidate Snapshots, Intent, and Job Requirements to output structured match evaluations.
   */
  public static evaluate(
    candidate: CandidateProjection,
    intent: CandidateIntent,
    opportunity: OpportunityIdentity
  ): EvaluationResult {
    const jobHash = opportunity.id;

    // 1. Calculate Capability Fit
    const matchedCapabilities: string[] = [];
    const unmatchedCapabilities: string[] = [];
    const strengths: EvaluationFindings["strengths"] = [];
    const gaps: EvaluationFindings["gaps"] = [];

    // Map candidate skills to capability IDs using registry for fast O(1) synonym mapping
    const candidateCapIds = new Set<string>();
    for (const skill of candidate.skills) {
      const match = CapabilityRegistry.lookup(skill);
      if (match) {
        candidateCapIds.add(match.id);
      }
    }

    // Map candidate claims to capability IDs
    for (const claim of candidate.claims) {
      const match = CapabilityRegistry.lookup(claim.statement);
      if (match) {
        candidateCapIds.add(match.id);
      }
    }

    const requiredCaps = opportunity.requiredCapabilities.length > 0 
      ? opportunity.requiredCapabilities 
      : ["cap_crm_strategy"]; // Default fallback if job lists nothing

    for (const capId of requiredCaps) {
      const registryEntry = CapabilityRegistry.lookup(capId);
      const capName = registryEntry ? registryEntry.name : capId;

      if (candidateCapIds.has(capId)) {
        matchedCapabilities.push(capId);
        
        // Find matching claims and evidence
        const matchingClaims = candidate.claims.filter(c => {
          const m = CapabilityRegistry.lookup(c.statement);
          return m && m.id === capId;
        });

        const matchedEvidenceIds = Array.from(new Set(matchingClaims.flatMap(c => c.evidenceIds)));

        strengths.push({
          capability: capName,
          statement: matchingClaims[0]?.statement || `Demonstrated capacity in ${capName}.`,
          matchingEvidenceIds: matchedEvidenceIds
        });
      } else {
        unmatchedCapabilities.push(capId);
        gaps.push({
          capability: capName,
          description: `No active claims found confirming hands-on skill in ${capName}.`,
          severity: "MODERATE"
        });
      }
    }

    let capabilityFitScore = Math.round((matchedCapabilities.length / requiredCaps.length) * 100);

    // Apply density discount for sparse descriptions
    if (requiredCaps.length === 1) {
      capabilityFitScore = Math.round(capabilityFitScore * 0.70);
    } else if (requiredCaps.length === 2) {
      capabilityFitScore = Math.round(capabilityFitScore * 0.85);
    }

    // --- EXECUTIVE MANDATE SENIORITY ASSESSMENT ENGINE ---
    const titleLower = (opportunity.canonicalTitle || "").toLowerCase();
    const descLower = (opportunity.description || "").toLowerCase();

    // Parse experience range from description (e.g. "3-7 years", "3 to 6 yrs", "0-2 years", "10+ years")
    let minExp: number | null = null;
    let maxExp: number | null = null;
    const expMatch = descLower.match(/(?:(\d{1,2})\s*(?:-|–|to|\+)\s*(\d{1,2})?|\b(\d{1,2})\b)\s*(?:years?|yrs?)(?:\s*(?:of\s*)?exp)?/i);
    if (expMatch) {
      if (expMatch[1]) minExp = parseInt(expMatch[1], 10);
      if (expMatch[2]) maxExp = parseInt(expMatch[2], 10);
      else if (expMatch[3] && !minExp) minExp = parseInt(expMatch[3], 10);
    }

    const isExecutiveTitle = 
      titleLower.includes("chief") || 
      titleLower.includes("cmo") || 
      titleLower.includes("cgo") || 
      titleLower.includes("coo") || 
      titleLower.includes("cro") || 
      titleLower.includes("vp") || 
      titleLower.includes("vice president") || 
      titleLower.includes("svp") || 
      titleLower.includes("director") || 
      titleLower.includes("country head") ||
      (titleLower.includes("head") && !titleLower.includes("assistant"));

    const isSubTierTitle = 
      (titleLower.includes("executive") && !titleLower.includes("chief executive")) ||
      titleLower.includes("assistant manager") ||
      titleLower.includes("bde") ||
      titleLower.includes("junior") ||
      titleLower.includes("intern") ||
      titleLower.includes("analyst") ||
      titleLower.includes("specialist") ||
      titleLower.includes("coordinator") ||
      (titleLower.includes("associate") && !titleLower.includes("associate director"));

    // Scope Classification (scopeType)
    const hasStrategicSignals = 
      descLower.includes("p&l") || 
      descLower.includes("profit and loss") || 
      descLower.includes("ebitda") || 
      descLower.includes("board of directors") || 
      descLower.includes("c-suite") || 
      descLower.includes("direct report to ceo") || 
      descLower.includes("global capability center") || 
      descLower.includes("enterprise transformation") || 
      descLower.includes("revenue ownership");

    const hasExecutionSignals = 
      descLower.includes("hands-on") || 
      descLower.includes("campaign execution") || 
      descLower.includes("a/b testing") || 
      descLower.includes("lead generation") || 
      descLower.includes("paid media") || 
      descLower.includes("social media") || 
      descLower.includes("form capture") || 
      descLower.includes("list import") || 
      descLower.includes("day-to-day");

    let scopeType: "STRATEGIC_MANDATE" | "MIXED" | "EXECUTION" | "UNKNOWN" = "UNKNOWN";
    if (hasStrategicSignals && !hasExecutionSignals) scopeType = "STRATEGIC_MANDATE";
    else if (hasExecutionSignals && !hasStrategicSignals) scopeType = "EXECUTION";
    else if (hasStrategicSignals || hasExecutionSignals) scopeType = "MIXED";

    // Evaluate Mandate Seniority Matrix
    let signalType: "QUALIFIED_EXECUTIVE" | "BORDERLINE_MANDATE" | "SUB_TIER_SIGNAL" | "CRITICAL_SENIORITY_CONTRADICTION" = "BORDERLINE_MANDATE";
    let mandateSeniority: "QUALIFIED" | "BORDERLINE" | "SUB_TIER" = "BORDERLINE";
    const contradictions: string[] = [];
    const evidence: string[] = [];

    if (isExecutiveTitle && minExp !== null && minExp < 8 && scopeType === "EXECUTION") {
      signalType = "CRITICAL_SENIORITY_CONTRADICTION";
      mandateSeniority = "SUB_TIER";
      contradictions.push("Seniority contradiction: Executive title conflicts with required 3–7 year execution-oriented requirement.");
    } else if (isSubTierTitle || (minExp !== null && minExp < 8 && scopeType === "EXECUTION")) {
      signalType = "SUB_TIER_SIGNAL";
      mandateSeniority = "SUB_TIER";
      contradictions.push("Sub-tier mandate: Role scope is below executive baseline.");
    } else if (
      isExecutiveTitle &&
      scopeType !== "EXECUTION" &&
      (
        (minExp !== null && minExp >= 12) ||
        (minExp !== null && minExp >= 8 && (scopeType === "STRATEGIC_MANDATE" || hasStrategicSignals)) ||
        (minExp === null && (scopeType === "STRATEGIC_MANDATE" || hasStrategicSignals))
      )
    ) {
      signalType = "QUALIFIED_EXECUTIVE";
      mandateSeniority = "QUALIFIED";
      evidence.push("Verified executive mandate matching or exceeding experience baseline.");
    } else if (
      (minExp !== null && minExp >= 8) ||
      (minExp !== null && minExp < 8 && (scopeType === "STRATEGIC_MANDATE" || hasStrategicSignals)) ||
      scopeType === "MIXED" ||
      scopeType === "EXECUTION"
    ) {
      signalType = "BORDERLINE_MANDATE";
      mandateSeniority = "BORDERLINE";
      evidence.push("Borderline mandate seniority: Requires verification of strategic scope.");
    } else {
      signalType = "SUB_TIER_SIGNAL";
      mandateSeniority = "SUB_TIER";
      contradictions.push("Role scope or experience is below executive baseline.");
    }

    // QUESTION 1: CAN THIS ROLE MATERIALLY ADVANCE AN EXECUTIVE CAREER?
    // Component 1A: Role Altitude (R_A) - Organizational Position & Authority (0-100)
    let reportingScore = 15;
    if (isSubTierTitle) {
      reportingScore = 5;
    } else if (titleLower.includes("country head") || titleLower.includes("chief") || titleLower.includes("founder") || titleLower.includes("cmo") || titleLower.includes("cgo") || titleLower.includes("coo")) {
      reportingScore = mandateSeniority === "SUB_TIER" ? 15 : 40;
    } else if (titleLower.includes("vp") || titleLower.includes("vice president") || titleLower.includes("svp")) {
      reportingScore = mandateSeniority === "SUB_TIER" ? 15 : 35;
    } else if (titleLower.includes("director") || titleLower.includes("associate director")) {
      reportingScore = 25;
    } else if (titleLower.includes("head") || titleLower.includes("lead")) {
      reportingScore = mandateSeniority === "SUB_TIER" ? 10 : 18;
    }

    let pnlScore = 15;
    if (isSubTierTitle) {
      pnlScore = 5;
    } else if (titleLower.includes("country head") || titleLower.includes("chief") || titleLower.includes("coo") || titleLower.includes("cmo") || titleLower.includes("cro") || titleLower.includes("p&l")) {
      pnlScore = mandateSeniority === "SUB_TIER" ? 10 : 35;
    } else if (titleLower.includes("director") || titleLower.includes("vp") || titleLower.includes("commercial")) {
      pnlScore = 25;
    } else if (titleLower.includes("head") || titleLower.includes("growth")) {
      pnlScore = mandateSeniority === "SUB_TIER" ? 10 : 18;
    } else {
      pnlScore = 10;
    }

    let scopeScore = 10;
    if (isSubTierTitle) {
      scopeScore = 5;
    } else if (titleLower.includes("global") || titleLower.includes("international")) {
      scopeScore = 25;
    } else if (titleLower.includes("enterprise") || titleLower.includes("country")) {
      scopeScore = 20;
    } else {
      scopeScore = 15;
    }

    let calculatedAltitude = reportingScore + pnlScore + scopeScore;
    if (mandateSeniority === "SUB_TIER") {
      calculatedAltitude = Math.min(25, calculatedAltitude);
    }

    const roleAltitudeScore = Math.min(100, Math.max(15, calculatedAltitude));

    // Component 1B: Observable Mandate Value (M_V)
    let cTransformation = 15;
    if (titleLower.includes("transformation") || titleLower.includes("re-architecture") || titleLower.includes("modernization")) cTransformation = 30;
    else if (titleLower.includes("turnaround") || titleLower.includes("pivot")) cTransformation = 25;

    let cCommercialChange = 15;
    if (titleLower.includes("growth") || titleLower.includes("expansion") || titleLower.includes("cro") || titleLower.includes("demand")) cCommercialChange = 30;
    else if (titleLower.includes("commercial") || titleLower.includes("revenue")) cCommercialChange = 25;

    let cVisibility = 15;
    if (titleLower.includes("chief") || titleLower.includes("country head") || titleLower.includes("advisor") || titleLower.includes("board")) cVisibility = 25;
    else if (titleLower.includes("vp") || titleLower.includes("director")) cVisibility = 20;

    let cAccountability = 10;
    if (titleLower.includes("head") || titleLower.includes("director") || titleLower.includes("chief") || titleLower.includes("lead")) cAccountability = 15;

    let calculatedMandate = cTransformation + cCommercialChange + cVisibility + cAccountability;
    if (mandateSeniority === "SUB_TIER") {
      calculatedMandate = Math.min(25, calculatedMandate);
    }

    const observableMandateValue = Math.min(100, Math.max(15, calculatedMandate));
    const careerAdvancementValue = Math.round(0.50 * roleAltitudeScore + 0.50 * observableMandateValue);

    // QUESTION 2: CAN THIS EXECUTIVE SUCCESSFULLY DELIVER? (Execution Confidence E_C)
    const strongClaimsCount = strengths.filter(s => s.matchingEvidenceIds.length > 0).length;
    const capabilityProofIndex = matchedCapabilities.length > 0 ? (strongClaimsCount / matchedCapabilities.length) * 100 : 80;
    const graphTransferability = capabilityFitScore;
    const evidenceCertaintyScore = 90;

    const executionConfidenceScore = Math.round(0.45 * capabilityProofIndex + 0.35 * graphTransferability + 0.20 * evidenceCertaintyScore);

    // QUESTION 3: ARE THE PRACTICAL CONDITIONS ACCEPTABLE? (Practical Compatibility P_C)
    let salaryGatePassed = true;
    if (opportunity.salaryBounds && opportunity.salaryBounds.max) {
      if (opportunity.salaryBounds.max < intent.salaryBand.min) {
        salaryGatePassed = false;
      }
    }

    let locationFriction: "COMPATIBLE" | "MODERATE_FRICTION" | "HIGH_FRICTION" = "COMPATIBLE";
    if (opportunity.location) {
      const jobLocLower = opportunity.location.toLowerCase();
      const isRemote = jobLocLower.includes("remote");
      const isIndianMetro = ["india", "mumbai", "bengaluru", "bangalore", "gurugram", "gurgaon", "delhi", "noida", "hyderabad", "pune", "chennai"].some(city => jobLocLower.includes(city));

      if (!isRemote && !isIndianMetro) {
        locationFriction = "HIGH_FRICTION";
      }
    }

    const baseScore = Math.round((0.45 * executionConfidenceScore) + (0.35 * observableMandateValue) + (0.20 * roleAltitudeScore));

    // INTERACTION POLICY FRAMEWORK & SCORE DERIVATION
    let derivedScore = baseScore;

    if (executionConfidenceScore < 50) {
      derivedScore = Math.min(derivedScore, 70);
    }

    if (careerAdvancementValue < 50) {
      derivedScore = Math.min(derivedScore, 75);
    }

    const overallScore = derivedScore;
    const alignmentScore = careerAdvancementValue;
    const evidenceSufficiencyIndex = matchedCapabilities.length > 0 
      ? Math.round((strongClaimsCount / matchedCapabilities.length) * 100) / 100
      : 1.0;
    const certainty = Math.round(evidenceCertaintyScore) / 100;

    // Build Metrics
    const metrics: EvaluationMetrics = {
      overallScore,
      capabilityFitScore: executionConfidenceScore,
      alignmentScore,
      evidenceSufficiencyIndex,
      certainty
    };

    // Build Findings & Friction Callouts
    const contextualRisks: string[] = [];
    if (!salaryGatePassed) {
      contextualRisks.push("Opportunity salary bounds fall below preferred target threshold.");
    }
    if (locationFriction === "HIGH_FRICTION") {
      contextualRisks.push("On-site location in unlisted geography requires relocation or remote negotiation.");
    }
    if (gaps.length > 0) {
      contextualRisks.push(`Missing core competency validation for ${unmatchedCapabilities.length} required capability domains.`);
    }
    if (mandateSeniority === "SUB_TIER") {
      contextualRisks.push(contradictions[0] || "Sub-tier mandate: Role scope or experience is below executive baseline.");
    }

    const findings: EvaluationFindings = {
      strengths,
      gaps,
      contextualRisks,
      marketUrgencyNotes: opportunity.postingWindow ? `Job is highly active, posted ${opportunity.postingWindow}.` : undefined
    };

    // RESOLVE DECISION POLICY VERB (DecisionEngine Policy Layer)
    let verb: "PURSUE" | "CONSIDER" | "PASS" = "PASS";
    let rationale = "";
    let primaryConcern: string | undefined = undefined;

    if (!salaryGatePassed) {
      verb = "PASS";
      rationale = `Disqualified by hard compensation gate. Max offer falls below minimum required threshold.`;
      primaryConcern = "Salary below target threshold.";
    } else if (mandateSeniority === "SUB_TIER") {
      verb = "PASS";
      primaryConcern = signalType === "CRITICAL_SENIORITY_CONTRADICTION"
        ? "Seniority contradiction: Executive title conflicts with required 3–7 year execution-oriented scope."
        : "Sub-tier mandate: Role scope is below executive baseline.";
      rationale = primaryConcern;
    } else if (mandateSeniority === "QUALIFIED" && executionConfidenceScore >= 50 && roleAltitudeScore >= 40) {
      verb = "PURSUE";
      rationale = `High execution confidence (${executionConfidenceScore}%) and verified executive mandate (${roleAltitudeScore}% altitude).`;
    } else if (overallScore >= 50 || mandateSeniority === "BORDERLINE") {
      verb = "CONSIDER";
      rationale = `Borderline mandate or capability fit warrants verification (${roleAltitudeScore}% altitude).`;
      if (locationFriction === "HIGH_FRICTION") {
        primaryConcern = "Geographical location friction.";
      } else if (gaps.length > 0) {
        primaryConcern = `Competency gaps in: ${gaps.map(g => g.capability).join(", ")}`;
      } else {
        primaryConcern = "Mandate scope requires verification.";
      }
    } else {
      verb = "PASS";
      rationale = `Insufficient career advancement value (${careerAdvancementValue}%) or executive altitude (${roleAltitudeScore}%). Preserve bandwidth.`;
      primaryConcern = "Low intrinsic fit score or sub-executive altitude.";
    }

    return {
      jobHash,
      metrics,
      findings,
      recommendation: {
        verb,
        rationale,
        primaryConcern
      },
      evaluatedAt: new Date().toISOString()
    };
  }
}
