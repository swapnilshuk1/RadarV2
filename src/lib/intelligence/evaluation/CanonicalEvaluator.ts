/**
 * CanonicalEvaluator.ts
 *
 * PURE ORCHESTRATOR & EVIDENCE COLLECTOR.
 * Orchestrates existing canonical domain engines (CandidateProjection, JobProjection,
 * CapabilityAssessmentEngine, CareerAssessmentEngine, DecisionPolicyEngine,
 * BriefCompositionEngine).
 */

import { CandidateProjectionBuilderImpl } from "../builders/CandidateProjectionBuilder";
import { JobProjectionBuilder } from "../builders/JobProjectionBuilder";
import { IdentityAssessmentEngine } from "../engines/IdentityAssessmentEngine";
import { CapabilityAssessmentEngine } from "../engines/CapabilityAssessmentEngine";
import { OpportunityAssessmentEngine } from "../engines/OpportunityAssessmentEngine";
import { CareerAssessmentEngine } from "../engines/CareerAssessmentEngine";
import { LifestyleAssessmentEngine } from "../engines/LifestyleAssessmentEngine";
import { DecisionPolicyEngine } from "../policy/DecisionPolicyEngine";
import { CandidateProjection } from "../../domain/candidate_projection";
import { JobProjection } from "../../domain/job_projection";
import { RecommendationRecord } from "../record";
import type { OpportunitySource as RawScrapedOpportunity } from "@/data/opportunity-fixtures";

export interface CanonicalEvaluationOutput {
  jobProjection: JobProjection;
  candidateProjection: CandidateProjection;
  record: RecommendationRecord;
}

export class CanonicalEvaluator {
  public static evaluateOpportunity(
    raw: RawScrapedOpportunity,
    candidate: CandidateProjection,
    activePursuits: number = 0,
    headspaceCapacity?: number
  ): CanonicalEvaluationOutput {
    const jobProjection = JobProjectionBuilder.build(raw);

    const identityResult = IdentityAssessmentEngine.evaluate(candidate, jobProjection);
    const capabilityResult = CapabilityAssessmentEngine.evaluate(candidate, jobProjection);
    const opportunityResult = OpportunityAssessmentEngine.evaluate(candidate, jobProjection);
    const careerResult = CareerAssessmentEngine.evaluate(candidate, jobProjection);
    const lifestyleResult = LifestyleAssessmentEngine.evaluate(candidate, jobProjection);

    const jdText = raw.normalizedText || raw.rawText || raw.description || "";
    const hasStructured = Array.isArray(raw.dimensions) && raw.dimensions.length > 0;

    const decisionResult = DecisionPolicyEngine.evaluate(
      identityResult,
      capabilityResult,
      opportunityResult,
      careerResult,
      lifestyleResult,
      jobProjection.role,
      "Commercial & Marketing Leadership",
      jdText,
      hasStructured
    );

    const record = {
      jobHash: raw.jobHash,
      engineVersion: "1.0.0",
      recommendationVersion: `1.0.0:${raw.jobHash}:canonical`,
      verb: decisionResult.verdict,
      qualityScore: decisionResult.qualityScore,
      rawScore: decisionResult.rawScore,
      priority: decisionResult.verdict === "PURSUE" ? 1 : decisionResult.verdict === "CONSIDER" ? 2 : null,
      decisionSummary: (decisionResult as any).decisionSummary || [],
      decisionDrivers: (decisionResult as any).decisionDrivers || [],
      decisionRisks: (decisionResult as any).decisionRisks || [],
      confidences: (decisionResult as any).confidences || {},
      trace: {
        priority: decisionResult.verdict === "PURSUE" ? 1 : decisionResult.verdict === "CONSIDER" ? 2 : 0,
        factors: { careerValue: 0, shortlistingPotential: 0, pursuitFriction: 0 },
        verb0: decisionResult.verdict,
        finalVerb: decisionResult.verdict,
        confidence: capabilityResult.matchingConfidence || 0.8,
        stability: "High",
        candidateProjectionHash: "v4",
        opportunityContentHash: raw.jobHash,
        pipeline: [],
        evidenceMapping: [],
        headspace: { finalVerb: decisionResult.verdict, downgraded: false },
        missing: [],
        timestamp: new Date().toISOString()
      },
      diligenceStatus: "READY"
    } as unknown as RecommendationRecord;

    return {
      jobProjection,
      candidateProjection: candidate,
      record
    };
  }

  public static evaluateBatch(
    opportunities: RawScrapedOpportunity[],
    candidate: CandidateProjection,
    activePursuits: number = 0,
    headspaceCapacity?: number
  ): CanonicalEvaluationOutput[] {
    return opportunities.map(opp =>
      this.evaluateOpportunity(opp, candidate, activePursuits, headspaceCapacity)
    );
  }
}
