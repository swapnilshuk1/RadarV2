import type { Opportunity, OpportunitySource, RecommendationViewModel, CapabilityCardViewModel } from "@/data/opportunity-fixtures";
import type { RecommendationRecord } from "./record";
import { format, type Narrative } from "./narrative";
import { CapabilityEngine, type JobSlice } from "../capability/CapabilityEngine";
import { CapabilityRecommendationScorer } from "../recommendation/CapabilityRecommendationScorer";
import { CapabilityOntology } from "../ontology/CapabilityOntology";

export type Presented = {
  opportunity: Opportunity;
  record: RecommendationRecord;
  narrative: Narrative;
};

export function opportunityToJobSlice(source: OpportunitySource): JobSlice {
  const dimensionsRecord: Record<string, {
    value: string | number | boolean | null;
    confidence?: number;
    evidence?: string;
  }> = {};

  for (const dim of source.dimensions) {
    dimensionsRecord[dim.key] = {
      value: dim.jdEvidence.value,
      confidence: dim.jdEvidence.status === "Explicit" ? 1.0 : 0.7,
      evidence: dim.jdEvidence.evidence[0]?.quote ?? "",
    };
  }

  return {
    jobId: source.jobHash,
    jobHash: source.jobHash,
    graphVersion: "1.0.0",
    dimensions: dimensionsRecord,
  };
}

import { DeterministicScorer } from "../recommendation/DeterministicScorer";

export function present(
  source: OpportunitySource,
  record: RecommendationRecord,
  dynamicProfile: any
): Presented {
  const narrative = format(record, source);

  // Sprint 5 Integration: Run the Capability and Recommendation Engines
  const capabilityEngine = new CapabilityEngine();
  const scorer = new CapabilityRecommendationScorer();
  const ontology = CapabilityOntology.getInstance();

  const jobSlice = opportunityToJobSlice(source);
  const evaluatedCapabilities = capabilityEngine.evaluate(jobSlice);
  const recommendationResult = scorer.score(evaluatedCapabilities);

  // Map engine results onto clean presenter ViewModels (shielding React)
  const mappedCapabilities: CapabilityCardViewModel[] = recommendationResult.capabilityResults.map((cap) => {
    const ontologyCap = ontology.getCapabilities().find((c) => c.id === cap.capabilityId);
    const description = ontologyCap?.description ?? "";
    
    // Resolve clean evidence quotes (handling any raw JSON objects)
    const rawQuote = cap.supportingEvidence[0]?.quote ?? "";
    let cleanQuote = rawQuote;
    if (rawQuote.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(rawQuote);
        cleanQuote = parsed.rawValue || parsed.canonicalValue || parsed.value || rawQuote;
      } catch {
        cleanQuote = rawQuote;
      }
    }

    // Resolve human-readable dimension name
    const rawDimension = cap.supportingEvidence[0]?.dimension ?? "";
    const matchingDim = source.dimensions.find((d) => d.key === rawDimension);
    const dimensionLabel = matchingDim?.label ?? rawDimension;

    return {
      id: cap.capabilityId,
      name: cap.capabilityName,
      description,
      strength: cap.strength,
      score: cap.score,
      scorePercentage: Math.round(cap.score * 100),
      evidenceQuote: cleanQuote,
      dimensionLabel,
      weight: cap.weight,
      weightedContribution: cap.weightedContribution,
    };
  });

  const isPass = record.verb === "PASS";

  // Run DeterministicScorer to compute calibrated Decision Confidence (Sprint 12)
  let decisionConfidence;

  try {
    const deterministicScorer = new DeterministicScorer();
    const policy: any = {
      weights: {
        reportingLine: 25,
        budgetOwnership: 25,
        teamLeadership: 25,
        commercialAccountability: 25
      },
      thresholds: {
        confidenceCutoff: 30
      }
    };
    const assessment = deterministicScorer.score({
      profile: dynamicProfile as any,
      policy: policy,
      job: jobSlice,
      recommendationRunId: "run-present",
      calibrationConfig: {
        coefficients: {
          reportingLine: { inferredWeight: 0.90 },
          budgetOwnership: { inferredWeight: 0.55 },
          teamLeadership: { inferredWeight: 0.82 },
          commercialAccountability: { inferredWeight: 0.75 },
          technologyStack: { inferredWeight: 0.85 },
          mandate: { inferredWeight: 0.70 },
        },
        thresholds: {
          highImpactThreshold: 0.15,
          confidenceVisibleThreshold: 0.80,
          maxHighImpactQuestions: 2
        }
      }
    });
    decisionConfidence = assessment.decisionConfidence;
  } catch (err) {
    // Suppress error
  }
  
  const scoreVal = record.priority !== null ? Math.round(record.priority) : 0;
  const scoreStr = record.priority !== null ? `${Math.round(record.priority)}/100` : "N/A";

  const recommendationResultViewModel: RecommendationViewModel = {
    score: scoreVal,
    decision: record.verb,
    policyId: "policy-v4.3",
    policyVersion: "4.3.0",
    explanation: isPass 
      ? `Evaluated by RADAR V4.3 strategic framework: ${record.verb.toLowerCase()} (Score: ${scoreStr}).`
      : `Dynamically evaluated using RADAR V4.3 strategic framework to ${record.verb.toLowerCase()} (Score: ${scoreStr}).`,
    capabilities: mappedCapabilities,
    decisionConfidence,
  };

  // Close the loop with explainability: feed the dynamic human-focused narrative 
  // as the primary advisory recommendation, while keeping the structural explanation in the result view model
  const finalRecommendation = narrative.recommendation;

  const { normalizedText, html, rawText, payload, ...cleanSource } = source as any;

  return {
    opportunity: {
      ...cleanSource,
      decision: record.verb,
      recommendation: finalRecommendation,
      whyNow: narrative.whyNow,
      positioning: narrative.positioning,
      primaryProof: narrative.primaryProof,
      headspaceInvestment: narrative.headspaceInvestment,
      headspace: narrative.headspace,
      hiringRisk: narrative.hiringRisk,
      alternativePath: narrative.alternativePath,
      recommendationResult: recommendationResultViewModel,
      esi: record.esi,
      diligenceStatus: record.diligenceStatus,
      recommendationArchetype: narrative.recommendationArchetype,
      recommendationArchetypeTagline: narrative.recommendationArchetypeTagline,
      mandateArchetype: narrative.mandateArchetype,
      primaryDriver: narrative.primaryDriver,
      secondaryDriver: narrative.secondaryDriver,
      primaryRisk: narrative.primaryRisk,
      tailoringEffort: narrative.tailoringEffort,
      capabilityAlignmentText: narrative.capabilityAlignmentText,
    },
    record,
    narrative,
  };
}