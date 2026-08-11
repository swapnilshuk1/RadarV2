import { IdentityAssessment, CapabilityAssessment, OpportunityAssessment, CareerAssessment, LifestyleAssessment, DecisionVerdict, EvaluationStatus, Recommendation } from "../../domain/semantic";
import decisionPolicy from "@/data/ontology/decision_policy.json";
import { IdentityDistanceCalculator } from "../utils/IdentityDistanceCalculator";
import { EvidenceGate } from "../gates/EvidenceGate";

export interface PipelineStage {
  stage: string;
  status: string;
  score?: number | null;
  reason?: string | Record<string, any>;
}

export interface DecisionDriver {
  factor: string;
  impact: "positive" | "negative";
  strength: "high" | "medium" | "low";
  evidence: string;
}

export interface DecisionPolicyResult {
  verdict: DecisionVerdict;
  evaluationStatus: EvaluationStatus;
  recommendation: Recommendation;
  priorityScore: number | null;
  structuralConviction: boolean;
  uiLabel: string;
  confidences: {
    parsing: number;
    matching: number;
    recommendation: number;
  };
  tailoringEffort: "LOW" | "MODERATE" | "HIGH";
  trajectoryUpside: string;
  relativeDifferentiator: string;
  triggeredRuleIds: string[];
  pipeline: PipelineStage[];
  decisionDrivers: DecisionDriver[];
  decisionRisks: DecisionDriver[];
}

export class DecisionPolicyEngine {
  public static evaluate(
    identity: IdentityAssessment,
    capability: CapabilityAssessment,
    opportunity: OpportunityAssessment,
    career: CareerAssessment,
    lifestyle: LifestyleAssessment,
    jobExecutiveIdentityValue?: string,
    candidateIdentityValue: string = "Commercial & Marketing Leadership",
    jobDescriptionText?: string
  ): DecisionPolicyResult {
    const triggeredRuleIds: string[] = [];
    
    // Step 0: Evidence Gate Precedence Check
    const roleTitle = (opportunity as any).role || (opportunity as any).originalOpportunity?.role || "";
    const companyName = (opportunity as any).company || "";
    const gateResult = EvidenceGate.evaluate(
      jobDescriptionText || "",
      roleTitle,
      companyName
    );

    if (gateResult.evaluationStatus === "SPARSE_SPEC") {
      return {
        verdict: "SPARSE_SPEC",
        evaluationStatus: "SPARSE_SPEC",
        recommendation: null,
        priorityScore: null,
        structuralConviction: false,
        uiLabel: "Needs More Signal",
        confidences: { parsing: 0.3, matching: 0.3, recommendation: 0.3 },
        tailoringEffort: "HIGH",
        trajectoryUpside: "Insufficient Specification",
        relativeDifferentiator: gateResult.reason || "Posting is too limited (< 25 words) to evaluate mandate scope or capability fit without guessing.",
        triggeredRuleIds: ["G-EVIDENCE-GATE-SPARSE-SPEC"],
        pipeline: [
          { stage: "EvidenceGate", status: "SPARSE_SPEC", score: null, reason: "Needs More Signal: < 25 words in job specification." }
        ],
        decisionDrivers: [],
        decisionRisks: [
          { factor: "Insufficient Evidence", impact: "negative", strength: "high", evidence: "Specification contains fewer than 25 words." }
        ]
      };
    }

    // Evaluate Topological Semantic Distance d in [0, 1]
    const identityDistance = IdentityDistanceCalculator.calculate(
      candidateIdentityValue, 
      jobExecutiveIdentityValue || "Commercial & Marketing Leadership",
      jobDescriptionText
    );

    // Hard Exclusion Gate: Incompatible Domain Shift (d >= 0.80)
    if (identityDistance >= 0.80) {
      return {
        verdict: "PASS",
        evaluationStatus: "EVALUATED",
        recommendation: "PASS",
        priorityScore: 0,
        structuralConviction: false,
        uiLabel: "Pass",
        confidences: { parsing: 0.9, matching: 0.9, recommendation: 0.95 },
        tailoringEffort: "HIGH",
        trajectoryUpside: "N/A",
        relativeDifferentiator: `Excluded due to structural identity distance (${identityDistance.toFixed(2)} >= 0.80) between ${candidateIdentityValue} and ${jobExecutiveIdentityValue}.`,
        triggeredRuleIds: ["G-EXECUTIVE-IDENTITY-MISMATCH"],
        pipeline: [
          { stage: "Identity", status: "FAILED", reason: `Semantic Distance: ${identityDistance.toFixed(2)} (Required < 0.80)` }
        ],
        decisionDrivers: [],
        decisionRisks: [
          { factor: "Professional Identity Distance", impact: "negative", strength: "high", evidence: `Semantic distance ${identityDistance.toFixed(2)} exceeds threshold 0.80` }
        ]
      };
    }

    // Pre-Gate: Critical Evidence Integrity Check
    const criticalFailed = 
      identity.status === "FAILED" || 
      capability.status === "FAILED" || 
      career.status === "FAILED";

    if (criticalFailed) {
      const failedDetails: string[] = [];
      if (identity.status === "FAILED") failedDetails.push(`Identity [${identity.failureCode}]`);
      if (capability.status === "FAILED") failedDetails.push(`Capability [${capability.failureCode}]`);
      if (career.status === "FAILED") failedDetails.push(`Career [${career.failureCode}]`);

      return {
        verdict: "NOT_EVALUABLE",
        evaluationStatus: "NOT_EVALUABLE",
        recommendation: null,
        priorityScore: null,
        structuralConviction: false,
        uiLabel: "Not Evaluable",
        confidences: { parsing: 0.0, matching: 0.0, recommendation: 0.0 },
        tailoringEffort: "HIGH",
        trajectoryUpside: "Uncertain / Insufficient Signals",
        relativeDifferentiator: "Insufficient scraped evidence to evaluate executive mandate.",
        triggeredRuleIds: ["G-EVIDENCE-INTEGRITY-FAILED"],
        pipeline: [
          { stage: "Integrity", status: "FAILED", reason: `Critical evidence missing: ${failedDetails.join(", ")}` }
        ],
        decisionDrivers: [],
        decisionRisks: [
          { factor: "Evidence Integrity", impact: "negative", strength: "high", evidence: failedDetails.join(", ") }
        ]
      };
    }

    const policyConfig: any = decisionPolicy;
    const baseWeights = policyConfig.weights;
    const t = policyConfig.thresholds;

    const identityScore = Math.round((identity.coverage || (1.0 - identityDistance)) * 100);
    const isCapUnavailable = (capability as any).evidenceState === "UNAVAILABLE" || capability.sufficiency === "INSUFFICIENT" || capability.overallFit === null;
    const capabilityScore = isCapUnavailable ? 50 : Math.round((capability.overallFit || 0) * 100);
    const careerScore = (career as any).careerScore || Math.max(0, 80 - (career.regressionScore || 0));
    const opportunityScore = (opportunity as any).opportunityScore || 80;
    const locationFriction = (lifestyle as any).locationFrictionPenalty || 0;

    // Non-Additive Cross-Dimensional Interaction Scaling
    const capabilityInteractionMultiplier = Math.max(0.20, 1.0 - 0.70 * identityDistance);
    const careerInteractionMultiplier = Math.max(0.30, 1.0 - 0.50 * identityDistance);

    const effectiveCapWeight = baseWeights.capability * capabilityInteractionMultiplier;
    const effectiveCareerWeight = baseWeights.career * careerInteractionMultiplier;

    // Differentiated Continuous Score Calibration
    const titleLower = roleTitle.toLowerCase();
    
    // Altitude modifier based on role executive authority
    let altitudeModifier = 0;
    if (titleLower.includes("chief") || titleLower.includes("cmo") || titleLower.includes("cro") || titleLower.includes("cgo") || titleLower.includes("coo")) {
      altitudeModifier = 12;
    } else if (titleLower.includes("vp") || titleLower.includes("vice president") || titleLower.includes("svp")) {
      altitudeModifier = 8;
    } else if (titleLower.includes("director") || titleLower.includes("country head")) {
      altitudeModifier = 4;
    } else if (titleLower.includes("head")) {
      altitudeModifier = 1;
    }

    // P&L & Scale modifier from description evidence
    const descText = (jobDescriptionText || (opportunity as any).originalOpportunity?.normalizedText || "").toLowerCase();
    let scopeBonus = 0;
    if (descText.includes("p&l") || descText.includes("profit and loss") || descText.includes("ebitda") || descText.includes("board of directors")) {
      scopeBonus += 5;
    }
    if (descText.includes("global") || descText.includes("international") || descText.includes("enterprise")) {
      scopeBonus += 3;
    }

    // Hash-seeded deterministic micro-variance to ensure distinct fractional tie-breaking
    let hashSeed = 0;
    const seedStr = (opportunity as any).jobHash || roleTitle;
    for (let i = 0; i < seedStr.length; i++) {
      hashSeed = (hashSeed * 31 + seedStr.charCodeAt(i)) & 0xffffffff;
    }
    const microVariance = ((Math.abs(hashSeed) % 11) - 5) * 0.8; // [-4.0, +4.0]

    const calibratedOpportunityScore = Math.min(98, Math.max(30, opportunityScore + altitudeModifier + scopeBonus + microVariance));

    // Calculate Uncompressed Interactive Priority Score
    const rawInteractiveScore = 
      baseWeights.identity * identityScore +
      effectiveCareerWeight * careerScore +
      baseWeights.opportunity * calibratedOpportunityScore +
      effectiveCapWeight * capabilityScore -
      locationFriction;

    // Direct linear score bounded between 0 and 100
    const priorityScore = Math.min(100, Math.max(0, Math.round(rawInteractiveScore)));

    const parsingConfidence = Math.min(1.0, 
      (identity.evidenceCount > 0 ? 0.9 : 0.6) * 
      (capability.evidenceCount > 0 ? 0.95 : 0.5)
    );

    const matchingConfidence = capability.matchingConfidence || 0.8;
    
    const evidenceCount = (identity.evidenceCount || 0) + (capability.evidenceCount || 0);
    let recommendationConfidence = (parsingConfidence * 0.4) + (matchingConfidence * 0.6);
    if (evidenceCount < 3) recommendationConfidence -= 0.15;
    if (capability.missingCapabilities.length > 2) recommendationConfidence -= 0.10;
    if (locationFriction > 10) recommendationConfidence -= 0.10;
    recommendationConfidence = Number(Math.max(0.35, Math.min(0.98, recommendationConfidence)).toFixed(2));

    const confidences = {
      parsing: Number(parsingConfidence.toFixed(2)),
      matching: Number(matchingConfidence.toFixed(2)),
      recommendation: recommendationConfidence
    };
    
    const pipeline: PipelineStage[] = [
      { 
        stage: "Identity", 
        status: identity.verdict, 
        score: identityScore, 
        reason: {
          vectorSimilarity: `${identityScore}%`,
          distance: identityDistance.toFixed(2)
        }
      },
      { 
        stage: "Capability", 
        status: capabilityScore >= (t.capabilityCutoff || 40) ? "PASS" : "FAIL", 
        score: capabilityScore, 
        reason: {
          matched: capability.matchedCapabilities,
          missing: capability.missingCapabilities,
          interactionScale: capabilityInteractionMultiplier.toFixed(2)
        }
      },
      { stage: "Career", status: career.regressionScore < (t.regressionCutoff || 50) ? "PASS" : "FAIL", score: careerScore, reason: `Trajectory: ${(career as any).trajectory}` },
      { stage: "Lifestyle", status: locationFriction <= 10 ? "PASS" : "FAIL", score: 100 - locationFriction, reason: `Location Friction: ${locationFriction}` }
    ];

    const decisionDrivers: DecisionDriver[] = [];
    const decisionRisks: DecisionDriver[] = [];

    if (identityScore >= 70) decisionDrivers.push({ factor: "Identity Alignment", impact: "positive", strength: "high", evidence: `${identityScore}% vector similarity` });
    else if (identityScore < 50) decisionRisks.push({ factor: "Identity Distance", impact: "negative", strength: "high", evidence: `Distance ${identityDistance.toFixed(2)} reduces capability weight` });

    if (capabilityScore >= 80) decisionDrivers.push({ factor: "Execution Readiness", impact: "positive", strength: "high", evidence: "Purpose-aligned capability match" });
    else if (capability.missingCapabilities.length > 0) decisionRisks.push({ factor: "Capability Gaps", impact: "negative", strength: "medium", evidence: `Missing ${capability.missingCapabilities.length} core capabilities` });

    if ((career as any).trajectory === "FORWARD") decisionDrivers.push({ factor: "Career Growth", impact: "positive", strength: "high", evidence: "Forward trajectory" });
    if (career.regressionScore > 20) decisionRisks.push({ factor: "Career Regression", impact: "negative", strength: "high", evidence: `Regression score: ${career.regressionScore}` });

    let tailoringEffort: "LOW" | "MODERATE" | "HIGH" = "LOW";
    if (capabilityScore < 80 || identityScore < 80) tailoringEffort = "MODERATE";
    if (capabilityScore < 60 || identityScore < 60) tailoringEffort = "HIGH";

    const trajectoryUpside = (career as any).trajectory === "FORWARD" 
      ? "High Advancement Leverage" 
      : (career as any).trajectory === "LATERAL" 
        ? "Strategic P&L Scale Consolidation" 
        : "Operational Repositioning";

    const relativeDifferentiator = `Score ${priorityScore}/100 with ${Math.round(identityScore)}% Identity similarity and ${capabilityScore}% Capability fit.`;

    pipeline.push({ stage: "Ranking", status: "COMPLETE", score: priorityScore });

    // Exclusion Gates (Hard Vetoes)
    if (
      opportunity.mandateSeniority === "SUB_TIER" || 
      (opportunity as any).seniorityAssessment?.mandateSeniority === "SUB_TIER"
    ) {
      return {
        verdict: "PASS",
        evaluationStatus: "EVALUATED",
        recommendation: "PASS",
        priorityScore: Math.min(priorityScore, 40),
        structuralConviction: false,
        uiLabel: "Pass",
        confidences,
        tailoringEffort: "HIGH",
        trajectoryUpside: "Sub-tier Mandate",
        relativeDifferentiator: (opportunity as any).seniorityAssessment?.signalType === "CRITICAL_SENIORITY_CONTRADICTION"
          ? "Seniority contradiction: Executive title conflicts with required 3–7 year execution-oriented scope."
          : "Sub-tier mandate: Role scope is below executive baseline.",
        triggeredRuleIds: ["G-SUB-TIER-MANDATE-VETO"],
        pipeline,
        decisionDrivers,
        decisionRisks: [...decisionRisks, { factor: "Sub-Tier Mandate Veto", impact: "negative", strength: "high", evidence: "Role scope is below executive baseline" }]
      };
    }

    if (identity.verdict === "MISMATCH" || identityScore < t.identityCutoff) {
      return {
        verdict: "PASS",
        evaluationStatus: "EVALUATED",
        recommendation: "PASS",
        priorityScore: Math.min(priorityScore, 50),
        structuralConviction: false,
        uiLabel: "Pass",
        confidences,
        tailoringEffort: "HIGH",
        trajectoryUpside,
        relativeDifferentiator: "Excluded due to identity alignment mismatch.",
        triggeredRuleIds: ["G-IDENTITY-VETO"],
        pipeline,
        decisionDrivers,
        decisionRisks: [...decisionRisks, { factor: "Identity Veto", impact: "negative", strength: "high", evidence: "Identity distance mismatch" }]
      };
    }

    if (capability.overallFit < t.capabilityCutoff) {
      return {
        verdict: "PASS",
        evaluationStatus: "EVALUATED",
        recommendation: "PASS",
        priorityScore: Math.min(priorityScore, 55),
        structuralConviction: false,
        uiLabel: "Pass",
        confidences,
        tailoringEffort: "HIGH",
        trajectoryUpside,
        relativeDifferentiator: "Excluded due to critical capability gaps.",
        triggeredRuleIds: ["G-EXECUTION-VETO"],
        pipeline,
        decisionDrivers,
        decisionRisks: [...decisionRisks, { factor: "Execution Veto", impact: "negative", strength: "high", evidence: "Critical capability gaps" }]
      };
    }

    if (career.regressionScore >= t.regressionCutoff) {
      return {
        verdict: "PASS",
        evaluationStatus: "EVALUATED",
        recommendation: "PASS",
        priorityScore: Math.min(priorityScore, 50),
        structuralConviction: false,
        uiLabel: "Pass",
        confidences,
        tailoringEffort: "HIGH",
        trajectoryUpside,
        relativeDifferentiator: "Excluded due to major operating level regression.",
        triggeredRuleIds: ["G-COMPATIBILITY-REGRESSION-VETO"],
        pipeline,
        decisionDrivers,
        decisionRisks: [...decisionRisks, { factor: "Regression Veto", impact: "negative", strength: "high", evidence: "Unacceptable operating level regression" }]
      };
    }

    // Structural Conviction Calibration (Controlled Policy Experiment)
    // Applies strictly AFTER all hard vetoes have passed
    const ma = (opportunity as any).mandateAssessment;
    const isCommercialDomain = !jobExecutiveIdentityValue || jobExecutiveIdentityValue.includes("Commercial") || jobExecutiveIdentityValue.includes("Marketing") || jobExecutiveIdentityValue.includes("Growth");
    const isExecutiveAltitude = (opportunity as any).operatingLevelAssessment === "MATCH" || (opportunity as any).operatingLevelAssessment === "PROMOTION" || titleLower.includes("head") || titleLower.includes("director") || titleLower.includes("chief") || titleLower.includes("cmo") || titleLower.includes("vp");
    const isBusinessGrowth = ma?.type === "BUSINESS_GROWTH";
    const isEnterpriseScope = ma?.scope === "ENTERPRISE";

    const hasStructuralConviction = isCommercialDomain && isExecutiveAltitude && isBusinessGrowth && isEnterpriseScope;
    let calibratedPriorityScore = priorityScore;

    if (hasStructuralConviction) {
      calibratedPriorityScore = Math.min(100, priorityScore + 3);
      triggeredRuleIds.push("R-STRUCTURAL-CONVICTION-CALIBRATION");
    }

    if (calibratedPriorityScore >= 75 && identityScore >= 60) {
      return {
        verdict: "PURSUE",
        evaluationStatus: "EVALUATED",
        recommendation: "PURSUE",
        priorityScore: calibratedPriorityScore,
        structuralConviction: hasStructuralConviction,
        uiLabel: "Pursue",
        confidences,
        tailoringEffort,
        trajectoryUpside,
        relativeDifferentiator,
        triggeredRuleIds: ["R-PURSUE-INTERACTIVE-SCORE", ...(hasStructuralConviction ? ["R-STRUCTURAL-CONVICTION-CALIBRATION"] : [])],
        pipeline,
        decisionDrivers,
        decisionRisks
      };
    }

    if (calibratedPriorityScore >= 60) {
      return {
        verdict: "CONSIDER",
        evaluationStatus: "EVALUATED",
        recommendation: "CONSIDER",
        priorityScore: calibratedPriorityScore,
        structuralConviction: hasStructuralConviction,
        uiLabel: "Consider",
        confidences,
        tailoringEffort,
        trajectoryUpside,
        relativeDifferentiator,
        triggeredRuleIds: ["R-CONSIDER-INTERACTIVE-SCORE"],
        pipeline,
        decisionDrivers,
        decisionRisks
      };
    }

    return {
      verdict: "PASS",
      evaluationStatus: "EVALUATED",
      recommendation: "PASS",
      priorityScore: calibratedPriorityScore,
      structuralConviction: false,
      uiLabel: "Pass",
      confidences,
      tailoringEffort,
      trajectoryUpside,
      relativeDifferentiator,
      triggeredRuleIds: ["R-PASS-LOW-PRIORITY"],
      pipeline,
      decisionDrivers,
      decisionRisks
    };
  }
}
