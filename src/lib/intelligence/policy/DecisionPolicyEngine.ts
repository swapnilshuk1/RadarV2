// src/lib/intelligence/policy/DecisionPolicyEngine.ts

import { IdentityAssessment, CapabilityAssessment, OpportunityAssessment, CareerAssessment, LifestyleAssessment, DecisionVerdict } from "../../domain/semantic";
import decisionPolicy from '@/data/ontology/decision_policy.json';

export interface DecisionPolicyResult {
  verdict: DecisionVerdict;
  priorityScore: number;
  confidence: number;
  tailoringEffort: "LOW" | "MODERATE" | "HIGH";
  trajectoryUpside: string;
  relativeDifferentiator: string;
  triggeredRuleIds: string[];
  rationales: string[];
  confidenceAdjustment: number;
}

export class DecisionPolicyEngine {
  public static evaluate(
    identity: IdentityAssessment,
    capability: CapabilityAssessment,
    opportunity: OpportunityAssessment,
    career: CareerAssessment,
    lifestyle: LifestyleAssessment
  ): DecisionPolicyResult {
    const triggeredRuleIds: string[] = [];
    const rationales: string[] = [];

    // 0. Pre-Gate: Critical Evidence Integrity Check (Fatal)
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
        priorityScore: 0,
        confidence: 0.0,
        tailoringEffort: "HIGH",
        trajectoryUpside: "Uncertain / Insufficient Signals",
        relativeDifferentiator: "Insufficient scraped evidence to evaluate executive mandate.",
        triggeredRuleIds: ["G-EVIDENCE-INTEGRITY-FAILED"],
        rationales: [
          `Evaluation halted. Critical evidence is missing or unextractable: ${failedDetails.join(", ")}.`
        ],
        confidenceAdjustment: 0
      };
    }

    // Load Decision Policy Configuration
    const policyConfig: any = decisionPolicy;

    // Calculate Continuous Priority Score
    const identityScore = Math.round((identity.coverage || 0) * 100);
    const capabilityScore = Math.round((capability.overallFit || 0) * 100);
    const careerScore = (career as any).careerScore || Math.max(0, 80 - (career.regressionScore || 0));
    const opportunityScore = (opportunity as any).opportunityScore || 80;
    const locationFriction = (lifestyle as any).locationFrictionPenalty || 0;

    const w = policyConfig.weights;
    const t = policyConfig.thresholds;

    const rawWeightedScore = 
      w.identity * identityScore +
      w.career * careerScore +
      w.opportunity * opportunityScore +
      w.capability * capabilityScore -
      locationFriction;

    // Decompressive Score Stretching Curve (0.0 to 1.0 normalized)
    // Spreads out 80-92 clustering onto a wider 65-95 continuous priority scale for executive discrimination
    const normalizedRaw = Math.max(0, Math.min(100, rawWeightedScore)) / 100;
    // Power curve exponent (1.25) to stretch top scores meaningfully
    const stretchedScore = Math.round(Math.pow(normalizedRaw, 1.22) * 100);
    const priorityScore = Math.min(100, Math.max(0, stretchedScore));

    // Calculate Explicit Decision Confidence (0.00 - 1.00)
    // Factors in evidence count, missing capabilities, and clarity of JD signals
    const evidenceCount = (identity.evidenceCount || 0) + (capability.evidenceCount || 0);
    let confidence = 0.85; // Baseline high confidence for valid scraped roles
    if (evidenceCount < 3) confidence -= 0.15;
    if (capability.missingCapabilities.length > 2) confidence -= 0.10;
    if (locationFriction > 10) confidence -= 0.10;
    confidence = Number(Math.max(0.35, Math.min(0.98, confidence)).toFixed(2));

    // Derive Tailoring Effort & Trajectory Upside
    let tailoringEffort: "LOW" | "MODERATE" | "HIGH" = "LOW";
    if (capabilityScore < 80 || identityScore < 80) tailoringEffort = "MODERATE";
    if (capabilityScore < 60 || identityScore < 60) tailoringEffort = "HIGH";

    const trajectoryUpside = (career as any).trajectory === "FORWARD" 
      ? "High Advancement Leverage" 
      : (career as any).trajectory === "LATERAL" 
        ? "Strategic P&L Scale Consolidation" 
        : "Operational Repositioning";

    const relativeDifferentiator = `Score ${priorityScore}/100 with ${Math.round(identityScore)}% Identity overlap and ${capabilityScore}% Capability fit.`;

    // Hard Exclusion Gates
    if (identity.verdict === "MISMATCH" || identityScore < t.identityCutoff) {
      return {
        verdict: "PASS",
        priorityScore: Math.min(priorityScore, 50),
        confidence,
        tailoringEffort: "HIGH",
        trajectoryUpside,
        relativeDifferentiator: "Excluded due to identity alignment mismatch.",
        triggeredRuleIds: ["G-IDENTITY-VETO"],
        rationales: ["The job's executive focus and thematic identity have insufficient overlap with your core expertise."],
        confidenceAdjustment: 0
      };
    }

    if (capability.overallFit < t.capabilityCutoff) {
      return {
        verdict: "PASS",
        priorityScore: Math.min(priorityScore, 55),
        confidence,
        tailoringEffort: "HIGH",
        trajectoryUpside,
        relativeDifferentiator: "Excluded due to critical capability gaps.",
        triggeredRuleIds: ["G-EXECUTION-VETO"],
        rationales: ["The role requires critical, non-negotiable functional capabilities missing from your profile."],
        confidenceAdjustment: 0
      };
    }

    if (career.regressionScore >= t.regressionCutoff) {
      return {
        verdict: "PASS",
        priorityScore: Math.min(priorityScore, 50),
        confidence,
        tailoringEffort: "HIGH",
        trajectoryUpside,
        relativeDifferentiator: "Excluded due to major operating level regression.",
        triggeredRuleIds: ["G-COMPATIBILITY-REGRESSION-VETO"],
        rationales: ["This role represents an unaligned, major organizational operating level regression."],
        confidenceAdjustment: 0
      };
    }

    // Dynamic Decision Thresholds based on Decompressed Continuous Priority Score
    if (priorityScore >= 75 && identityScore >= 60) {
      return {
        verdict: "PURSUE",
        priorityScore,
        confidence,
        tailoringEffort,
        trajectoryUpside,
        relativeDifferentiator,
        triggeredRuleIds: ["R-PURSUE-CONTINUOUS-SCORE"],
        rationales: [`High-priority executive target (Priority: ${priorityScore}/100, Confidence: ${confidence}) with strong identity match and scale alignment.`],
        confidenceAdjustment: 0
      };
    }

    if (priorityScore >= 60) {
      return {
        verdict: "CONSIDER",
        priorityScore,
        confidence,
        tailoringEffort,
        trajectoryUpside,
        relativeDifferentiator,
        triggeredRuleIds: ["R-CONSIDER-CONTINUOUS-SCORE"],
        rationales: [`Moderate-priority opportunity (Priority: ${priorityScore}/100, Confidence: ${confidence}) requiring targeted positioning review.`],
        confidenceAdjustment: 0
      };
    }

    return {
      verdict: "PASS",
      priorityScore,
      confidence,
      tailoringEffort,
      trajectoryUpside,
      relativeDifferentiator,
      triggeredRuleIds: ["R-PASS-LOW-PRIORITY"],
      rationales: [`Low priority alignment (Priority: ${priorityScore}/100) below target investment threshold.`],
      confidenceAdjustment: 0
    };
  }
}
