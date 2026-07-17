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

/** Merge computed engine output onto the OpportunitySource. Source fields
 *  (dimension evidence) pass through verbatim; the engine's verb + narrative-generated
 *  prose lines (recommendation, positioning, etc.) are overlaid on top. */
export function present(
  source: OpportunitySource,
  record: RecommendationRecord,
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

  const recommendationResultViewModel: RecommendationViewModel = {
    score: Math.round(recommendationResult.score),
    decision: recommendationResult.decision,
    policyId: recommendationResult.policyId,
    policyVersion: recommendationResult.policyVersion,
    explanation: recommendationResult.explanation,
    capabilities: mappedCapabilities,
  };

  // Close the loop with explainability: feed the engine's compiled explanation directly
  // as the primary advisory recommendation at the top of the viewport
  const finalRecommendation = recommendationResultViewModel.explanation || narrative.recommendation;

  return {
    opportunity: {
      ...source,
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
    },
    record,
    narrative,
  };
}