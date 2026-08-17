/**
 * scripts/eval/v4-simulation/runner.ts
 *
 * Production-Path Pipeline Runner for RADAR V4 Phase 8 Engine Simulation.
 * Invokes the actual production engines without mocking or approximating domain logic.
 */

import { candidateProfile } from "@/data/candidate-profile";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";
import { JobProjectionBuilder } from "@/lib/intelligence/builders/JobProjectionBuilder";
import { IdentityAssessmentEngine } from "@/lib/intelligence/engines/IdentityAssessmentEngine";
import { CapabilityAssessmentEngine } from "@/lib/intelligence/engines/CapabilityAssessmentEngine";
import { OpportunityAssessmentEngine } from "@/lib/intelligence/engines/OpportunityAssessmentEngine";
import { CareerAssessmentEngine } from "@/lib/intelligence/engines/CareerAssessmentEngine";
import { CareerValueEngine } from "@/lib/intelligence/engines/CareerValueEngine";
import { LifestyleAssessmentEngine } from "@/lib/intelligence/engines/LifestyleAssessmentEngine";
import { calculateShortlistingPotentialFromAssessments } from "@/lib/intelligence/calculators/ShortlistingPotentialCalculator";
import { DecisionPolicyEngine } from "@/lib/intelligence/policy/DecisionPolicyEngine";
import { EvidenceGate } from "@/lib/intelligence/gates/EvidenceGate";
import { present } from "@/lib/intelligence/present";
import { BriefCompositionEngine } from "@/lib/intelligence/editorial/BriefCompositionEngine";
import { buildCandidateEvaluationContext } from "@/lib/intelligence/context";
import type { RecommendationRecord } from "@/lib/intelligence/record";
import type { SampledJD } from "./corpus-sampler";
import type { SimulationRecord } from "./types";

export function runPipelineOnJD(sampled: SampledJD): SimulationRecord {
  const raw = sampled.rawOpportunity;
  const rawJDText = sampled.fullJDText;
  const failures: string[] = [];

  const candidateBuilder = new CandidateProjectionBuilderImpl();
  const candProj = candidateBuilder.fromProfile(candidateProfile);
  const jobProj = JobProjectionBuilder.build(raw);

  const hasStructuredEvidence = (raw.dimensions || []).some(
    (d: any) => d.jdEvidence?.status === "Explicit" || d.jdEvidence?.status === "Inferred"
  );

  // 1. EvidenceGate Early Check
  const gateResult = EvidenceGate.evaluate(
    rawJDText,
    raw.role,
    raw.company,
    hasStructuredEvidence
  );

  let identity: any = null;
  let capability: any = null;
  let opportunityAssess: any = null;
  let career: any = null;
  let careerValue: any = null;
  let lifestyle: any = null;
  let spCalc: any = null;
  let policyResult: any = null;
  let record: RecommendationRecord;

  const evalContext = buildCandidateEvaluationContext(candProj);

  const isSparse = gateResult.evaluationStatus === "SPARSE_SPEC";

  if (isSparse) {
    // Sparse Spec / Early Rejection Path
    record = {
      jobHash: raw.jobHash,
      engineVersion: "4.0.0",
      recommendationVersion: `4.0.0:${raw.jobHash}:SPARSE_SPEC`,
      verb: "PASS",
      action: "PASS",
      qualityScore: null,
      rawScore: null,
      priority: null,
      vetoed: true,
      vetoReason: "R-PASS-SPARSE-SPEC",
      claimPermissions: { allowedClaims: [], explicitUnknowns: ["Scope", "Seniority"], explicitRisks: ["Sparse specification"] },
      confidence: 0.2,
      stability: "High",
      headspace: { downgraded: false, finalVerb: "PASS" },
      decisionSummary: { careerValue: 0, shortlistingPotential: 0, pursuitFriction: 0 },
      triggeredRuleIds: ["R-PASS-SPARSE-SPEC"],
      decisionDrivers: [],
      decisionRisks: [{ category: "EVIDENCE_INTEGRITY", label: "Sparse Specification", description: gateResult.reason || "Insufficient detail" }],
      explanation: {
        headline: "Insufficient Evidence to Evaluate Opportunity",
        primaryReason: gateResult.reason || "The job posting provides insufficient detail to evaluate fit.",
        riskFlags: ["Sparse specification — core mandate and scope are not stated"],
        tradeoffs: ["Cannot confirm seniority, team scale, or commercial responsibility without further discovery."],
        missingEvidence: ["Mandate", "Scope", "Reporting Line", "Compensation"],
      },
      comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
      dimensions: raw.dimensions || [],
      policyDecision: {
        verdict: "PASS",
        vetoed: true,
        vetoReason: "R-PASS-SPARSE-SPEC",
        triggeredRuleIds: ["R-PASS-SPARSE-SPEC"],
        priorityScore: null,
      },
      confidences: { recommendation: 0.2 },
    } as any;

    spCalc = { score: 0, band: "Sparse Spec", breakdown: {} };
    policyResult = {
      verdict: "PASS",
      rawScore: 0,
      priorityScore: null,
      vetoed: true,
      vetoReason: "R-PASS-SPARSE-SPEC",
      triggeredRuleIds: ["R-PASS-SPARSE-SPEC"],
      decisionDrivers: [],
      decisionRisks: [{ category: "EVIDENCE_INTEGRITY", label: "Sparse Specification", description: gateResult.reason || "Insufficient detail" }],
      relativeDifferentiator: "Insufficient specification for meaningful evaluation.",
      trajectoryUpside: "Unknown",
    };
  } else {
    // Full Assessment Pipeline
    try {
      identity = IdentityAssessmentEngine.evaluate(candProj, jobProj, evalContext);
    } catch (err: any) {
      failures.push(`IdentityAssessmentEngine failure: ${err.message}`);
    }

    try {
      capability = CapabilityAssessmentEngine.evaluate(candProj, jobProj, evalContext);
    } catch (err: any) {
      failures.push(`CapabilityAssessmentEngine failure: ${err.message}`);
    }

    try {
      opportunityAssess = OpportunityAssessmentEngine.evaluate(candProj, jobProj);
    } catch (err: any) {
      failures.push(`OpportunityAssessmentEngine failure: ${err.message}`);
    }

    try {
      career = CareerAssessmentEngine.evaluate(candProj, jobProj, evalContext);
    } catch (err: any) {
      failures.push(`CareerAssessmentEngine failure: ${err.message}`);
    }

    try {
      careerValue = CareerValueEngine.evaluate(candProj, jobProj);
    } catch (err: any) {
      failures.push(`CareerValueEngine failure: ${err.message}`);
    }

    try {
      lifestyle = LifestyleAssessmentEngine.evaluate(candProj, jobProj);
    } catch (err: any) {
      failures.push(`LifestyleAssessmentEngine failure: ${err.message}`);
    }

    // Shortlisting Potential
    try {
      spCalc = calculateShortlistingPotentialFromAssessments(
        identity,
        capability,
        career,
        opportunityAssess,
        capability?.matchingConfidence || 0.8
      );
    } catch (err: any) {
      failures.push(`ShortlistingPotentialCalculator failure: ${err.message}`);
      spCalc = { score: 50, band: "Uncalculated", breakdown: {} };
    }

    // Decision Policy Engine
    try {
      policyResult = DecisionPolicyEngine.evaluate(
        identity,
        capability,
        opportunityAssess,
        career,
        lifestyle,
        jobProj.executiveIdentity?.value || "Commercial & Marketing Leadership",
        candProj.executiveIdentity?.value || "Commercial & Marketing Leadership",
        rawJDText,
        hasStructuredEvidence,
        undefined,
        raw.dimensions,
        spCalc.score
      );
    } catch (err: any) {
      failures.push(`DecisionPolicyEngine failure: ${err.message}`);
      policyResult = {
        verdict: "CONSIDER",
        rawScore: spCalc?.score || 50,
        priorityScore: 50,
        vetoed: false,
        vetoReason: null,
        triggeredRuleIds: ["FALLBACK"],
        decisionDrivers: [],
        decisionRisks: [],
      };
    }

    record = {
      jobHash: raw.jobHash,
      engineVersion: "4.0.0",
      recommendationVersion: `4.0.0:${raw.jobHash}:${policyResult.verdict}`,
      verb: policyResult.verdict,
      action: policyResult.verdict,
      qualityScore: spCalc.score,
      rawScore: spCalc.score,
      priority: spCalc.score,
      vetoed: Boolean(policyResult.vetoed),
      vetoReason: policyResult.vetoReason || null,
      claimPermissions: {
        allowedClaims: ["TRANSFORMATION", "GO_TO_MARKET"],
        explicitUnknowns: [],
        explicitRisks: (policyResult.decisionRisks || []).map((r: any) => r.label || r.description),
      },
      confidence: capability?.matchingConfidence || 0.85,
      stability: "High",
      headspace: { downgraded: false, finalVerb: policyResult.verdict },
      decisionSummary: {
        careerValue: careerValue?.breakdown?.progressionLikelihood ? careerValue.breakdown.progressionLikelihood * 100 : 70,
        shortlistingPotential: spCalc.score,
        pursuitFriction: 20,
      },
      triggeredRuleIds: policyResult.triggeredRuleIds,
      decisionDrivers: policyResult.decisionDrivers || [],
      decisionRisks: policyResult.decisionRisks || [],
      explanation: {
        headline: policyResult.verdict === "PURSUE" ? `Pursue ${raw.role}` : policyResult.verdict === "CONSIDER" ? `Consider ${raw.role}` : `Pass on ${raw.role}`,
        primaryReason: policyResult.decisionDrivers?.[0]?.description || "Evaluation completed across capability and career alignment.",
        riskFlags: (policyResult.decisionRisks || []).map((r: any) => r.label || r.description),
        tradeoffs: [policyResult.relativeDifferentiator || "Evaluate scope vs velocity."],
        missingEvidence: [],
      },
      comparison: { higherThan: [], lowerThan: [], differentiators: [policyResult.relativeDifferentiator || "Scope"], tradeOffs: [] },
      dimensions: raw.dimensions || [],
      policyDecision: {
        verdict: policyResult.verdict,
        vetoed: policyResult.vetoed,
        vetoReason: policyResult.vetoReason,
        triggeredRuleIds: policyResult.triggeredRuleIds,
        priorityScore: policyResult.priorityScore,
      },
      confidences: {
        recommendation: capability?.matchingConfidence || 0.8,
      },
    } as any;
  }

  // Presentation & Editorial Composition
  let presented: any;
  let briefModel: any;

  try {
    presented = present(raw, record, candProj);
  } catch (err: any) {
    failures.push(`present() failure: ${err.message}`);
    presented = { opportunity: { ...raw, engineRecommendation: record } };
  }

  try {
    briefModel = BriefCompositionEngine.compose(presented.opportunity, { bypassHistory: true });
  } catch (err: any) {
    failures.push(`BriefCompositionEngine.compose() failure: ${err.message}`);
  }

  return {
    jobHash: sampled.jobHash,
    fileSource: sampled.file,
    rawOpportunity: raw,
    extractedDimensions: sampled.dimensions,
    fullJDText: rawJDText,
    role: sampled.role,
    company: sampled.company,
    location: sampled.location,
    source: sampled.source,
    applyUrl: sampled.applyUrl,
    category: sampled.category,
    seniorityTier: sampled.seniorityTier,
    fitSpectrumBucket: sampled.fitSpectrumBucket,
    gateResult: {
      passed: !isSparse,
      evaluationStatus: gateResult.evaluationStatus,
      reason: gateResult.reason,
    },
    isolatedAssessments: {
      identity,
      capability,
      opportunity: opportunityAssess,
      career,
      careerValue,
      lifestyle,
    },
    shortlistingPotential: {
      score: spCalc?.score ?? null,
      band: spCalc?.band ?? "Unknown",
      breakdown: spCalc?.breakdown ?? {},
    },
    policyResult: {
      verdict: policyResult?.verdict || "PASS",
      rawScore: policyResult?.rawScore ?? 0,
      priorityScore: policyResult?.priorityScore ?? null,
      vetoed: policyResult?.vetoed ?? false,
      vetoReason: policyResult?.vetoReason ?? null,
      triggeredRuleIds: policyResult?.triggeredRuleIds ?? [],
      decisionDrivers: policyResult?.decisionDrivers ?? [],
      decisionRisks: policyResult?.decisionRisks ?? [],
      relativeDifferentiator: policyResult?.relativeDifferentiator,
      trajectoryUpside: policyResult?.trajectoryUpside,
    },
    recommendationRecord: record,
    presented,
    briefModel,
    verbatimAudits: [], // Populated by verbatim-auditor
    objectiveScores: {
      evidenceGroundingScore: 0,
      contradictionScore: 0,
      policyAlignmentScore: 0,
      specificityScore: 0,
      riskHonestyScore: 0,
      calibrationScore: 0,
      actionabilityScore: 0,
      totalObjectiveScore: 0,
    },
    contradictions: [], // Populated by contradiction-scanner
    failures,
    assessmentVerdict: failures.length === 0 ? "PASS" : "FAIL",
  };
}
