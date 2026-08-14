import { IdentityAssessment, CapabilityAssessment, OpportunityAssessment, CareerAssessment, LifestyleAssessment, DecisionVerdict, EvaluationStatus, Recommendation } from "../../domain/semantic";
import decisionPolicy from "@/data/ontology/decision_policy.json";
import { IdentityDistanceCalculator } from "../utils/IdentityDistanceCalculator";
import { EvidenceGate } from "../gates/EvidenceGate";

export const POLICY_THRESHOLDS = {
  PURSUE: decisionPolicy.thresholds.pursueScore,
  CONSIDER: decisionPolicy.thresholds.considerScore,
};

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
  rawScore: number;
  priorityScore: number | null;
  vetoed: boolean;
  vetoReason: string | null;
  claimPermissions: {
    allowedClaims: ("PL_SCALE" | "FOUNDER_PROXIMITY" | "TRANSFORMATION" | "GO_TO_MARKET" | "GLOBAL_SCOPE")[];
    explicitUnknowns: string[];
    explicitRisks: string[];
  };
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
    jobDescriptionText?: string,
    hasStructuredEvidence: boolean = false,
    evidenceGrounding?: Record<string, string>,
    dimensions?: Array<{ key: string; jdEvidence?: { value?: string } }>,
    shortlistingPotentialScore?: number // P3-A: Pre-calculated authoritative SP
  ): DecisionPolicyResult {
    const triggeredRuleIds: string[] = [];
    
    // Construct Grounded Claim Permissions based on explicit evidence
    const descText = (jobDescriptionText || (opportunity as any).originalOpportunity?.normalizedText || "").toLowerCase();
    const allowedClaims: ("PL_SCALE" | "FOUNDER_PROXIMITY" | "TRANSFORMATION" | "GO_TO_MARKET" | "GLOBAL_SCOPE")[] = [];
    
    // P0-A: Check evidence grounding for structured claims
    const hasGroundedEvidence = (key: string): boolean => {
      if (!evidenceGrounding) return false;
      const grounding = evidenceGrounding[key];
      return grounding === "SOURCE_GROUNDED" || grounding === "STRUCTURED_TRUSTED";
    };
    
    const getDimensionValue = (key: string): string => {
      if (!dimensions) return "";
      const dim = dimensions.find(d => d.key === key);
      return dim?.jdEvidence?.value?.toLowerCase() || "";
    };
    
    // P&L Scale: check source text or grounded evidence
    if (descText.includes("p&l") || descText.includes("profit and loss") || (opportunity as any).operatingContext?.pnlResponsibility) {
      allowedClaims.push("PL_SCALE");
    }
    // Also check grounded commercialAccountability evidence
    if (hasGroundedEvidence("commercialAccountability")) {
      const val = getDimensionValue("commercialAccountability");
      if (val.includes("p&l") || val.includes("profit")) {
        allowedClaims.push("PL_SCALE");
      }
    }
    
    if (descText.includes("founder") || descText.includes("board of directors")) {
      allowedClaims.push("FOUNDER_PROXIMITY");
    }
    
    // Transformation: check source text, career trajectory, or grounded mandate evidence
    if (descText.includes("transform") || (career as any).trajectory === "FORWARD") {
      allowedClaims.push("TRANSFORMATION");
    }
    // P0-A: STRUCTURED_TRUSTED mandate evidence confers TRANSFORMATION claim
    if (hasGroundedEvidence("mandate")) {
      const mandateVal = getDimensionValue("mandate");
      if (mandateVal.includes("transformation") || mandateVal.includes("transform")) {
        allowedClaims.push("TRANSFORMATION");
      }
    }
    
    if (descText.includes("go-to-market") || descText.includes("gtm") || descText.includes("commercial")) {
      allowedClaims.push("GO_TO_MARKET");
    }
    if (descText.includes("global") || descText.includes("international") || descText.includes("enterprise")) {
      allowedClaims.push("GLOBAL_SCOPE");
    }

    const claimPermissions = {
      allowedClaims,
      explicitUnknowns: capability.missingCapabilities || [],
      explicitRisks: [] as string[]
    };

    // Step 0: Evidence Gate Precedence Check
    const roleTitle = (opportunity as any).role || (opportunity as any).originalOpportunity?.role || "";
    const companyName = (opportunity as any).company || "";

    const gateResult = EvidenceGate.evaluate(
      jobDescriptionText || "",
      roleTitle,
      companyName,
      hasStructuredEvidence
    );

    if (gateResult.evaluationStatus === "SPARSE_SPEC") {
      return {
        verdict: "SPARSE_SPEC",
        evaluationStatus: "SPARSE_SPEC",
        recommendation: null,
        rawScore: 0,
        priorityScore: null,
        vetoed: true,
        vetoReason: "G-EVIDENCE-GATE-SPARSE-SPEC",
        claimPermissions,
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

    const isStructuredSparse = gateResult.evaluationStatus === "EVALUATED_WITH_STRUCTURED_EVIDENCE";
    const evaluationStatus: EvaluationStatus = isStructuredSparse ? "EVALUATED_WITH_STRUCTURED_EVIDENCE" : "EVALUATED";

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
        rawScore: 0,
        priorityScore: 0,
        vetoed: true,
        vetoReason: "G-EXECUTIVE-IDENTITY-MISMATCH",
        claimPermissions,
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
        rawScore: 0,
        priorityScore: null,
        vetoed: true,
        vetoReason: "G-EVIDENCE-INTEGRITY-FAILED",
        claimPermissions,
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

    // Clean Continuous Score Calculation (Free of Artificial Noise or Arbitrary Boosts)
    const rawInteractiveScore = 
      baseWeights.identity * identityScore +
      effectiveCareerWeight * careerScore +
      baseWeights.opportunity * opportunityScore +
      effectiveCapWeight * capabilityScore -
      locationFriction;

    // Pure continuous score bounded between 0 and 100
    const rawScore = Math.min(100, Math.max(0, Math.round(rawInteractiveScore)));

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

    // P1-C: Tailoring effort derived from capability gaps, not match scores
    // Concept: effort is determined by the gaps requiring bridging, not by overall match percentage
    let tailoringEffort: "LOW" | "MODERATE" | "HIGH" = "LOW";
    
    // Analyze missing capabilities by tier
    const missingCoreMandate = capability.missingCapabilities.filter(c => c.includes("[CORE_MANDATE]")).length;
    const missingExecution = capability.missingCapabilities.filter(c => c.includes("[EXECUTION_CAPABILITY]")).length;
    const missingTechStack = capability.missingCapabilities.filter(c => c.includes("[TECHNOLOGY_STACK]")).length;
    const missingDomain = capability.missingCapabilities.filter(c => c.includes("[DOMAIN_FAMILIARITY]")).length;
    
    // MODERATE: Execution or technology gaps exist (can be bridged with effort)
    if (missingExecution > 0 || missingTechStack > 0 || missingDomain > 0) {
      tailoringEffort = "MODERATE";
    }
    
    // HIGH: Core mandate gaps exist (fundamental to role, harder to bridge)
    if (missingCoreMandate > 0) {
      tailoringEffort = "HIGH";
    }

    const trajectoryUpside = (career as any).trajectory === "FORWARD" 
      ? "High Advancement Leverage" 
      : (career as any).trajectory === "LATERAL" 
        ? "Strategic P&L Scale Consolidation" 
        : "Operational Repositioning";

    const relativeDifferentiator = `Score ${rawScore}/100 with ${Math.round(identityScore)}% Identity similarity and ${capabilityScore}% Capability fit.`;

    pipeline.push({ stage: "Ranking", status: "COMPLETE", score: rawScore });

    // Exclusion Gates (Hard Vetoes) — Assign priorityScore = 0 / null, vetoed = true, vetoReason
    if (
      opportunity.mandateSeniority === "SUB_TIER" || 
      (opportunity as any).seniorityAssessment?.mandateSeniority === "SUB_TIER"
    ) {
      return {
        verdict: "PASS",
        evaluationStatus: evaluationStatus,
        recommendation: "PASS",
        rawScore,
        priorityScore: 0,
        vetoed: true,
        vetoReason: "G-SUB-TIER-MANDATE-VETO",
        claimPermissions,
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
        evaluationStatus: evaluationStatus,
        recommendation: "PASS",
        rawScore,
        priorityScore: 0,
        vetoed: true,
        vetoReason: "G-IDENTITY-VETO",
        claimPermissions,
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

    if ((capability.overallFit ?? 0) < t.capabilityCutoff) {
      return {
        verdict: "PASS",
        evaluationStatus: evaluationStatus,
        recommendation: "PASS",
        rawScore,
        priorityScore: 0,
        vetoed: true,
        vetoReason: "G-EXECUTION-VETO",
        claimPermissions,
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
        evaluationStatus: evaluationStatus,
        recommendation: "PASS",
        rawScore,
        priorityScore: 0,
        vetoed: true,
        vetoReason: "G-COMPATIBILITY-REGRESSION-VETO",
        claimPermissions,
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

    // Structural Conviction Flag (Calculated purely for analytical tagging, NOT mutating score)
    const ma = (opportunity as any).mandateAssessment;
    const isCommercialDomain = !jobExecutiveIdentityValue || jobExecutiveIdentityValue.includes("Commercial") || jobExecutiveIdentityValue.includes("Marketing") || jobExecutiveIdentityValue.includes("Growth");
    const isExecutiveAltitude = (opportunity as any).operatingLevelAssessment === "MATCH" || (opportunity as any).operatingLevelAssessment === "PROMOTION" || roleTitle.toLowerCase().includes("head") || roleTitle.toLowerCase().includes("director") || roleTitle.toLowerCase().includes("chief") || roleTitle.toLowerCase().includes("cmo") || roleTitle.toLowerCase().includes("vp");
    const isBusinessGrowth = ma?.type === "BUSINESS_GROWTH";
    const isEnterpriseScope = ma?.scope === "ENTERPRISE";

    const hasStructuralConviction = isCommercialDomain && isExecutiveAltitude && isBusinessGrowth && isEnterpriseScope;

    // P3-A: Career-Value Protection Rule (Rule 1 - Approved)
    // Detect "easy trap": CV < 50 AND SP >= 80 AND Friction < 10 AND initial PURSUE
    // Use pre-calculated authoritative SP passed from engine.ts
    const spHigh = shortlistingPotentialScore !== undefined && shortlistingPotentialScore >= 80; // SP >= 80
    const frictionLow = locationFriction < 10; // Friction < 10 (strictly less than)
    const careerValueLow = careerScore < 50; // CV < 50 (strictly less than)

    const wouldBeEasyTrap = spHigh && frictionLow && careerValueLow;

    // P3-A: If this would be an easy trap PURSUE, downgrade to CONSIDER
    if (rawScore >= POLICY_THRESHOLDS.PURSUE && identityScore >= t.identityPursueCutoff) {
      // P3-A: Career-Value Protection - downgrade easy trap from PURSUE to CONSIDER
      if (wouldBeEasyTrap) {
        return {
          verdict: "CONSIDER",
          evaluationStatus: evaluationStatus,
          recommendation: "CONSIDER",
          rawScore,
          priorityScore: rawScore,
          vetoed: false,
          vetoReason: null,
          claimPermissions,
          structuralConviction: false,
          uiLabel: "Consider",
          confidences,
          tailoringEffort,
          trajectoryUpside: "Limited Career Upside",
          relativeDifferentiator: "High accessibility but material career regression detected.",
          triggeredRuleIds: ["R-CONSIDER-CAREER-VALUE-PROTECTION", "R-PURSUE-INTERACTIVE-SCORE"],
          pipeline: [...pipeline, { stage: "CareerValueProtection", status: "DOWNSCALED", score: rawScore, reason: "Easy trap: CV < 50 + SP >= 80 + Friction < 10" }],
          decisionDrivers: [...decisionDrivers, { factor: "High Shortlisting Potential", impact: "positive", strength: "high", evidence: `${shortlistingPotentialScore}% SP` }],
          decisionRisks: [...decisionRisks, { factor: "Low Career Value", impact: "negative", strength: "high", evidence: `CV: ${careerScore}` }]
        };
      }

      return {
        verdict: "PURSUE",
        evaluationStatus: evaluationStatus,
        recommendation: "PURSUE",
        rawScore,
        priorityScore: rawScore,
        vetoed: false,
        vetoReason: null,
        claimPermissions,
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

    if (rawScore >= POLICY_THRESHOLDS.CONSIDER) {
      return {
        verdict: "CONSIDER",
        evaluationStatus: evaluationStatus,
        recommendation: "CONSIDER",
        rawScore,
        priorityScore: rawScore,
        vetoed: false,
        vetoReason: null,
        claimPermissions,
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
      evaluationStatus: evaluationStatus,
      recommendation: "PASS",
      rawScore,
      priorityScore: 0,
      vetoed: false,
      vetoReason: null,
      claimPermissions,
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
