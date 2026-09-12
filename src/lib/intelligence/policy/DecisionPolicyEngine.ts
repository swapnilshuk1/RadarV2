import { IdentityAssessment, CapabilityAssessment, OpportunityAssessment, CareerAssessment, LifestyleAssessment, DecisionVerdict, EvaluationStatus, Recommendation } from "../../domain/semantic";
import decisionPolicy from "@/data/ontology/decision_policy.json";
import { IdentityDistanceCalculator } from "../utils/IdentityDistanceCalculator";
import { EvidenceGate } from "../gates/EvidenceGate";
import { QualityScoreCalculator } from "./QualityScoreCalculator";
import { EvidenceRichnessCalculator } from "../utils/EvidenceRichnessCalculator";

export const POLICY_THRESHOLDS = {
  PURSUE: decisionPolicy.thresholds.pursueScore,
  CONSIDER: decisionPolicy.thresholds.considerScore,
  MIN_PURSUE_SP: decisionPolicy.thresholds.minPursueSp,
  MAX_PURSUE_FRICTION: decisionPolicy.thresholds.maxPursueFriction,
  MAX_CONSIDER_FRICTION: decisionPolicy.thresholds.maxConsiderFriction,
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
  evidence?: string;
}

export interface DecisionPolicyResult {
  verdict: DecisionVerdict;
  evaluationStatus: EvaluationStatus;
  recommendation: Recommendation;
  qualityScore: number | null; // Authoritative Model C intrinsic quality score
  rawScore: number | null;     // Legacy compatibility alias (equals qualityScore)
  priorityScore: number | null;// Legacy compatibility alias (equals qualityScore)
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
  opportunityScoreSource?: "EXPLICIT" | "FALLBACK";
  opportunityScoreConfidence?: "HIGH" | "LOW";
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
    
    const opp = (opportunity || {}) as unknown as Record<string, unknown>;
    const car = (career || {}) as unknown as Record<string, unknown>;
    const cap = (capability || {}) as unknown as Record<string, unknown>;
    const life = (lifestyle || {}) as unknown as Record<string, unknown>;

    // Construct Grounded Claim Permissions based on explicit evidence
    const descText = (jobDescriptionText || (opp.originalOpportunity as Record<string, unknown> | undefined)?.normalizedText as string || "").toLowerCase();
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
    if (descText.includes("p&l") || descText.includes("profit and loss") || (opp.operatingContext as Record<string, unknown> | undefined)?.pnlResponsibility) {
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
    if (descText.includes("transform") || car.trajectory === "FORWARD") {
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
      explicitUnknowns: capability?.missingCapabilities || [],
      explicitRisks: [] as string[]
    };

    // Step 0: Evidence Gate Precedence Check
    const roleTitle = (opp.role as string) || (opp.originalOpportunity as Record<string, unknown> | undefined)?.canonicalTitle as string || "";
    const companyName = (opp.company as string) || "";

    const gateResult = EvidenceGate.evaluate(
      jobDescriptionText || "",
      roleTitle,
      companyName,
      hasStructuredEvidence
    );

    const isSparseSpec = gateResult.evaluationStatus === "SPARSE_SPEC";

    if (isSparseSpec) {
      return {
        verdict: "SPARSE_SPEC",
        evaluationStatus: "SPARSE_SPEC",
        recommendation: null,
        qualityScore: null,
        rawScore: null,
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
        qualityScore: null,
        rawScore: null,
        priorityScore: null,
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

    // Pre-Gate: Critical Evidence Integrity Check & Structural Decisionability Gate
    const oppOriginal = (opp?.originalOpportunity as Record<string, unknown> | undefined) || opp;
    const oppForRichness = (dimensions && dimensions.length > 0) ? { dimensions } : oppOriginal;
    const richness = EvidenceRichnessCalculator.calculate(oppForRichness);

    const isStructuralEvidenceInsufficient = !hasStructuredEvidence && richness.sufficiency === "INSUFFICIENT";

    const criticalFailed = 
      identity.status === "FAILED" || 
      capability.status === "FAILED" || 
      career.status === "FAILED" ||
      isStructuralEvidenceInsufficient;

    if (criticalFailed) {
      const failedDetails: string[] = [];
      if (identity.status === "FAILED") failedDetails.push(`Identity [${identity.failureCode}]`);
      if (capability.status === "FAILED") failedDetails.push(`Capability [${capability.failureCode}]`);
      if (career.status === "FAILED") failedDetails.push(`Career [${career.failureCode}]`);
      if (isStructuralEvidenceInsufficient) failedDetails.push("Structural Evidence Missing [NO_GROUNDED_DIMENSIONS]");

      return {
        verdict: "NOT_EVALUABLE",
        evaluationStatus: "NOT_EVALUABLE",
        recommendation: null,
        qualityScore: null,
        rawScore: null,
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

    const policyConfig = decisionPolicy as { thresholds: Record<string, number> };
    const t = policyConfig.thresholds;

    // Calculate Model C Authoritative Intrinsic Quality Score
    const qualityResult = QualityScoreCalculator.calculate({
      identityDistance,
      identity,
      capability,
      career,
      opportunity,
      isSparseSpec: false,
      criticalFailed: false
    });

    const qualityScore = qualityResult.qualityScore; // Authoritative [0-100]
    const rawScore = qualityScore;                   // Legacy alias
    const priorityScore = qualityScore;              // Legacy alias
    const opportunityScoreSource = qualityResult.opportunityScoreSource;
    const opportunityScoreConfidence = qualityResult.opportunityScoreConfidence;

    const identityScore = Math.round((identity.coverage || (1.0 - identityDistance)) * 100);
    const isCapUnavailable = cap.evidenceState === "UNAVAILABLE" || capability.sufficiency === "INSUFFICIENT" || capability.overallFit === null;
    const capabilityScore = isCapUnavailable ? 50 : Math.round((capability.overallFit || 0) * 100);
    const careerScore = (car.careerScore as number | undefined) || Math.max(0, 80 - (career.regressionScore || 0));
    const locationFriction = (life.locationFrictionPenalty as number | undefined) || 0;

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
          missing: capability.missingCapabilities
        }
      },
      { stage: "Career", status: career.regressionScore < (t.regressionCutoff || 50) ? "PASS" : "FAIL", score: careerScore, reason: `Trajectory: ${car.trajectory}` },
      { stage: "Lifestyle", status: locationFriction <= 10 ? "PASS" : "FAIL", score: 100 - locationFriction, reason: `Location Friction: ${locationFriction}` }
    ];

    const decisionDrivers: DecisionDriver[] = [];
    const decisionRisks: DecisionDriver[] = [];

    if (identityScore >= 70) decisionDrivers.push({ factor: "Identity Alignment", impact: "positive", strength: "high", evidence: `${identityScore}% vector similarity` });
    else if (identityScore < 50) decisionRisks.push({ factor: "Identity Distance", impact: "negative", strength: "high", evidence: `Distance ${identityDistance.toFixed(2)} reduces capability weight` });

    if (capabilityScore >= 80) decisionDrivers.push({ factor: "Execution Readiness", impact: "positive", strength: "high", evidence: "Purpose-aligned capability match" });
    else if (capability.missingCapabilities.length > 0) decisionRisks.push({ factor: "Capability Gaps", impact: "negative", strength: "medium", evidence: `Missing ${capability.missingCapabilities.length} core capabilities` });

    if (car.trajectory === "FORWARD") decisionDrivers.push({ factor: "Career Growth", impact: "positive", strength: "high", evidence: "Forward trajectory" });
    if (career.regressionScore > 20) decisionRisks.push({ factor: "Career Regression", impact: "negative", strength: "high", evidence: `Regression score: ${career.regressionScore}` });

    let tailoringEffort: "LOW" | "MODERATE" | "HIGH" = "LOW";
    
    const missingCoreMandate = capability.missingCapabilities.filter(c => c.includes("[CORE_MANDATE]")).length;
    const missingExecution = capability.missingCapabilities.filter(c => c.includes("[EXECUTION_CAPABILITY]")).length;
    const missingTechStack = capability.missingCapabilities.filter(c => c.includes("[TECHNOLOGY_STACK]")).length;
    const missingDomain = capability.missingCapabilities.filter(c => c.includes("[DOMAIN_FAMILIARITY]")).length;
    
    if (missingExecution > 0 || missingTechStack > 0 || missingDomain > 0) {
      tailoringEffort = "MODERATE";
    }
    
    if (missingCoreMandate > 0) {
      tailoringEffort = "HIGH";
    }

    const trajectoryUpside = car.trajectory === "FORWARD" 
      ? "High Advancement Leverage" 
      : car.trajectory === "LATERAL" 
        ? "Strategic P&L Scale Consolidation" 
        : "Operational Repositioning";

    const relativeDifferentiator = `Quality Score ${qualityScore}/100 with ${Math.round(identityScore)}% Identity similarity and ${capabilityScore}% Capability fit.`;

    pipeline.push({ stage: "Ranking", status: "COMPLETE", score: qualityScore });

    // Exclusion Gates (Hard Vetoes) — Assign qualityScore (numeric), vetoed = true, vetoReason
    if (
      opportunity.mandateSeniority === "SUB_TIER" || 
      (opp.seniorityAssessment as Record<string, unknown> | undefined)?.mandateSeniority === "SUB_TIER"
    ) {
      return {
        verdict: "PASS",
        evaluationStatus: evaluationStatus,
        recommendation: "PASS",
        qualityScore,
        rawScore,
        priorityScore,
        opportunityScoreSource,
        opportunityScoreConfidence,
        vetoed: true,
        vetoReason: "G-SUB-TIER-MANDATE-VETO",
        claimPermissions,
        structuralConviction: false,
        uiLabel: "Pass",
        confidences,
        tailoringEffort: "HIGH",
        trajectoryUpside: "Sub-tier Mandate",
        relativeDifferentiator: (opp.seniorityAssessment as Record<string, unknown> | undefined)?.signalType === "CRITICAL_SENIORITY_CONTRADICTION"
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
        qualityScore,
        rawScore,
        priorityScore,
        opportunityScoreSource,
        opportunityScoreConfidence,
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
        qualityScore,
        rawScore,
        priorityScore,
        opportunityScoreSource,
        opportunityScoreConfidence,
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
        qualityScore,
        rawScore,
        priorityScore,
        opportunityScoreSource,
        opportunityScoreConfidence,
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

    // Structural Conviction Flag
    const ma = opp.mandateAssessment as Record<string, unknown> | undefined;
    const isCommercialDomain = !jobExecutiveIdentityValue || jobExecutiveIdentityValue.includes("Commercial") || jobExecutiveIdentityValue.includes("Marketing") || jobExecutiveIdentityValue.includes("Growth");
    const isExecutiveAltitude = opp.operatingLevelAssessment === "MATCH" || opp.operatingLevelAssessment === "PROMOTION" || roleTitle.toLowerCase().includes("head") || roleTitle.toLowerCase().includes("director") || roleTitle.toLowerCase().includes("chief") || roleTitle.toLowerCase().includes("cmo") || roleTitle.toLowerCase().includes("vp");
    const isBusinessGrowth = ma?.type === "BUSINESS_GROWTH";
    const isEnterpriseScope = ma?.scope === "ENTERPRISE";

    const hasStructuralConviction = isCommercialDomain && isExecutiveAltitude && isBusinessGrowth && isEnterpriseScope;

    const sp = shortlistingPotentialScore ?? 0;
    const friction = locationFriction;
    const careerValueLow = careerScore < 50;
    const spHigh = sp >= 80;
    const frictionLow = friction < 10;

    const isEasyTrap = spHigh && frictionLow && careerValueLow;
    const effectiveScore = qualityScore ?? 0;

    if (effectiveScore >= POLICY_THRESHOLDS.PURSUE && identityScore >= t.identityPursueCutoff) {
      if (isEasyTrap) {
        return {
          verdict: "CONSIDER",
          evaluationStatus: evaluationStatus,
          recommendation: "CONSIDER",
          qualityScore,
          rawScore,
          priorityScore,
          opportunityScoreSource,
          opportunityScoreConfidence,
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
          pipeline: [...pipeline, { stage: "CareerValueProtection", status: "DOWNSCALED", score: qualityScore, reason: "Easy trap: CV < 50 + SP >= 80 + Friction < 10" }],
          decisionDrivers: [...decisionDrivers, { factor: "High Shortlisting Potential", impact: "positive", strength: "high", evidence: `${shortlistingPotentialScore}% SP` }],
          decisionRisks: [...decisionRisks, { factor: "Low Career Value", impact: "negative", strength: "high", evidence: `CV: ${careerScore}` }]
        };
      }

      if (sp < POLICY_THRESHOLDS.MIN_PURSUE_SP) {
        return {
          verdict: "CONSIDER",
          evaluationStatus: evaluationStatus,
          recommendation: "CONSIDER",
          qualityScore,
          rawScore,
          priorityScore,
          opportunityScoreSource,
          opportunityScoreConfidence,
          vetoed: false,
          vetoReason: null,
          claimPermissions,
          structuralConviction: false,
          uiLabel: "Consider",
          confidences,
          tailoringEffort,
          trajectoryUpside,
          relativeDifferentiator: "High quality role but shortlisting potential is below pursuit threshold.",
          triggeredRuleIds: ["POL-D-CONSIDER-REACH-ROLE"],
          pipeline: [...pipeline, { stage: "ShortlistingPotentialGate", status: "DOWNSCALED", score: qualityScore, reason: `SP ${sp} < ${POLICY_THRESHOLDS.MIN_PURSUE_SP}` }],
          decisionDrivers,
          decisionRisks: [...decisionRisks, { factor: "Lower Shortlisting Potential", impact: "negative", strength: "medium", evidence: `SP: ${sp}%` }]
        };
      }

      if (friction > POLICY_THRESHOLDS.MAX_PURSUE_FRICTION) {
        if (friction <= POLICY_THRESHOLDS.MAX_CONSIDER_FRICTION) {
          return {
            verdict: "CONSIDER",
            evaluationStatus: evaluationStatus,
            recommendation: "CONSIDER",
            qualityScore,
            rawScore,
            priorityScore,
            opportunityScoreSource,
            opportunityScoreConfidence,
            vetoed: false,
            vetoReason: null,
            claimPermissions,
            structuralConviction: false,
            uiLabel: "Consider",
            confidences,
            tailoringEffort,
            trajectoryUpside,
            relativeDifferentiator: "High quality role but pursuit friction requires exploratory verification.",
            triggeredRuleIds: ["POL-D-CONSIDER-HIGH-FRICTION"],
            pipeline: [...pipeline, { stage: "PursuitFrictionGate", status: "DOWNSCALED", score: qualityScore, reason: `Friction ${friction} > ${POLICY_THRESHOLDS.MAX_PURSUE_FRICTION}` }],
            decisionDrivers,
            decisionRisks: [...decisionRisks, { factor: "High Pursuit Friction", impact: "negative", strength: "medium", evidence: `Friction: ${friction}` }]
          };
        } else {
          return {
            verdict: "PASS",
            evaluationStatus: evaluationStatus,
            recommendation: "PASS",
            qualityScore,
            rawScore,
            priorityScore,
            opportunityScoreSource,
            opportunityScoreConfidence,
            vetoed: false,
            vetoReason: null,
            claimPermissions,
            structuralConviction: false,
            uiLabel: "Pass",
            confidences,
            tailoringEffort,
            trajectoryUpside,
            relativeDifferentiator: "Prohibitive lifestyle/relocation friction exceeds consider threshold.",
            triggeredRuleIds: ["POL-D-PASS-PROHIBITIVE-FRICTION"],
            pipeline: [...pipeline, { stage: "PursuitFrictionGate", status: "EXCLUDED", score: qualityScore, reason: `Friction ${friction} > ${POLICY_THRESHOLDS.MAX_CONSIDER_FRICTION}` }],
            decisionDrivers,
            decisionRisks: [...decisionRisks, { factor: "Prohibitive Friction", impact: "negative", strength: "high", evidence: `Friction: ${friction}` }]
          };
        }
      }

      return {
        verdict: "PURSUE",
        evaluationStatus: evaluationStatus,
        recommendation: "PURSUE",
        qualityScore,
        rawScore,
        priorityScore,
        opportunityScoreSource,
        opportunityScoreConfidence,
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

    if (effectiveScore >= POLICY_THRESHOLDS.CONSIDER) {
      if (friction > POLICY_THRESHOLDS.MAX_CONSIDER_FRICTION) {
        return {
          verdict: "PASS",
          evaluationStatus: evaluationStatus,
          recommendation: "PASS",
          qualityScore,
          rawScore,
          priorityScore,
          opportunityScoreSource,
          opportunityScoreConfidence,
          vetoed: false,
          vetoReason: null,
          claimPermissions,
          structuralConviction: false,
          uiLabel: "Pass",
          confidences,
          tailoringEffort,
          trajectoryUpside,
          relativeDifferentiator: "Prohibitive lifestyle/relocation friction exceeds consider threshold.",
          triggeredRuleIds: ["POL-D-PASS-PROHIBITIVE-FRICTION"],
          pipeline: [...pipeline, { stage: "PursuitFrictionGate", status: "EXCLUDED", score: qualityScore, reason: `Friction ${friction} > ${POLICY_THRESHOLDS.MAX_CONSIDER_FRICTION}` }],
          decisionDrivers,
          decisionRisks: [...decisionRisks, { factor: "Prohibitive Friction", impact: "negative", strength: "high", evidence: `Friction: ${friction}` }]
        };
      }

      return {
        verdict: "CONSIDER",
        evaluationStatus: evaluationStatus,
        recommendation: "CONSIDER",
        qualityScore,
        rawScore,
        priorityScore,
        opportunityScoreSource,
        opportunityScoreConfidence,
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
      qualityScore,
      rawScore,
      priorityScore,
      opportunityScoreSource,
      opportunityScoreConfidence,
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
