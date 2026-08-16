import type { Opportunity, OpportunitySource, RecommendationViewModel, CapabilityCardViewModel } from "@/data/opportunity-fixtures";
import type { RecommendationRecord } from "./record";
import { format, type Narrative } from "./narrative";
import { CapabilityEngine, type JobSlice } from "../capability/CapabilityEngine";
import { CapabilityRecommendationScorer } from "../recommendation/CapabilityRecommendationScorer";
import { CapabilityOntology } from "../ontology/CapabilityOntology";
import { SemanticNaturalLanguageResolver } from "./editorial/SemanticNaturalLanguageResolver";

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

import type { DecisionConfidence } from "../../domain/entities";

export function present(
  source: OpportunitySource,
  record: RecommendationRecord,
  dynamicProfile: any
): Presented {
  const narrative = format(record, source);

  // Pure Presenter (Boundary 4): Map capability cards directly from RecommendationRecord
  const mappedCapabilities: CapabilityCardViewModel[] = (record.trace?.evidenceMapping || []).map((ev, idx) => {
    return {
      id: `cap_${idx}`,
      name: ev.jobCapability || "Executive Capability",
      description: ev.reason || "Evaluated by RADAR V4 evidence graph.",
      strength: ev.confidence >= 0.8 ? "Strong" : ev.confidence >= 0.5 ? "Moderate" : "Weak",
      score: ev.confidence,
      scorePercentage: Math.round(ev.confidence * 100),
      evidenceQuote: ev.candidateCapability || "",
      dimensionLabel: "Executive Mandate",
      weight: 1.0,
      weightedContribution: ev.confidence,
    };
  });

  const isPass = record.verb === "PASS";

    // Pure projection: use confidence from RecommendationRecord directly
  const overall = record.confidence ?? null;
  const stability = record.stability === "High" ? 0.92 : record.stability === "Medium" ? 0.75 : 0.50;
  
  let explanation = "Moderate structural alignment; potential promotion scope or scale variance detected.";
  const effectiveQualityScore = record.vetoed ? null : (record.qualityScore ?? record.priority);
  if (effectiveQualityScore !== null && effectiveQualityScore >= 75) {
    explanation = "Strong structural alignment across operating level and strategic commercial growth mandates.";
  } else if (effectiveQualityScore !== null && effectiveQualityScore < 50) {
    explanation = "Low alignment; structural level or functional domain mismatch limits suitability.";
  }

  const decisionConfidence: DecisionConfidence = {
    overall,
    stability,
    limitingDimensions: [],
    explanation
  };
  
  const scoreVal = effectiveQualityScore !== null ? Math.round(effectiveQualityScore) : null;
  const scoreStr = effectiveQualityScore !== null ? `${Math.round(effectiveQualityScore)}/100` : "N/A";

  const recommendationResultViewModel: RecommendationViewModel = {
    score: scoreVal,
    decision: record.verb,
    policyId: "policy-v4.3",
    policyVersion: record.recommendationVersion,
    explanation: isPass 
      ? `Evaluated by RADAR V4.3 strategic framework: ${record.verb.toLowerCase()} (Score: ${scoreStr}).`
      : `Dynamically evaluated using RADAR V4.3 strategic framework to ${record.verb.toLowerCase()} (Score: ${scoreStr}).`,
    capabilities: mappedCapabilities,
    decisionConfidence,
    vetoed: Boolean(record.vetoed),
    vetoReason: record.vetoReason || null,
  };

  // Close the loop with explainability: feed the dynamic human-focused narrative 
  // as the primary advisory recommendation, while keeping the structural explanation in the result view model
  const finalRecommendation = record.headspace.downgraded && narrative.headspaceLine
    ? `${narrative.headspaceLine} ${narrative.recommendation}`
    : narrative.recommendation;

  const {
    normalizedText,
    html,
    rawText,
    payload,
    rawDescription,
    normalizedDescription,
    evidenceGrounding,
    dimensions,
    ...cleanSource
  } = source as any;

  const cleanDimensions = Array.isArray(source.dimensions)
    ? source.dimensions.map((d: any) => ({
        key: d.key,
        bucket: d.bucket,
        jdEvidence: {
          status: d.jdEvidence?.status || "Explicit",
          value: typeof d.jdEvidence?.value === "string" ? d.jdEvidence.value.slice(0, 140) : "",
          evidence: Array.isArray(d.jdEvidence?.evidence) && d.jdEvidence.evidence.length > 0
            ? [{ quote: d.jdEvidence.evidence[0]?.quote?.slice(0, 140) || "", provenance: d.jdEvidence.evidence[0]?.provenance, confidence: d.jdEvidence.evidence[0]?.confidence }]
            : []
        }
      }))
    : [];

  return {
    opportunity: {
      ...cleanSource,
      dimensions: cleanDimensions,
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
      // RADAR V4 Canonical Multi-State Multi-Truth Model
      engineRecommendation: {
        jobHash: record.jobHash,
        evaluationFingerprint: record.recommendationVersion,
        engineVerdict: record.verb as any,
        vetoed: Boolean(record.vetoed),
        vetoReason: record.vetoReason || null,
        qualityScore: record.vetoed ? null : (record.qualityScore !== null && record.qualityScore !== undefined ? Math.round(record.qualityScore) : null),
        parsingConfidence: record.confidences?.parsing ?? (record.confidence ?? 0.8),
        evaluatedAt: new Date().toISOString(),
      },
      userDecision: null,
      effectiveDecision: record.verb === "PURSUE" 
        ? "ENGINE_PURSUIT" 
        : record.verb === "CONSIDER" 
          ? "ENGINE_CONSIDER" 
          : record.verb === "SPARSE_SPEC" 
            ? "NOT_EVALUABLE" 
            : "ENGINE_PASS",
      reviewWorkflowState: "UNREVIEWED",
      displayScore: effectiveQualityScore !== null ? `${Math.round(effectiveQualityScore)}%` : "—",
      uiBadge: record.vetoed
        ? { label: "Vetoed", variant: "pass" as const }
        : record.verb === "PURSUE"
          ? { label: "Recommended", variant: "signal" as const }
          : record.verb === "CONSIDER"
            ? { label: "Consider", variant: "caution" as const }
            : { label: "Pass", variant: "muted" as const },
      // P1-F: Generate executive-facing recommended action based on decision + tailoring effort
      recommendedAction: SemanticNaturalLanguageResolver.resolveActionRecommendation(
        record.verb as "PURSUE" | "CONSIDER" | "PASS",
        source.role,
        source.company,
        narrative.tailoringEffort
      ),
    },
    record,
    narrative,
  };
}