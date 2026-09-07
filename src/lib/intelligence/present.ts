import type { Opportunity, OpportunitySource, RecommendationViewModel, CapabilityCardViewModel, DimensionResult, DimensionKey, EvidenceBucket } from "@/data/opportunity-fixtures";
import type { RecommendationRecord } from "./record";
import { format, type Narrative } from "./narrative";
import { CapabilityEngine, type JobSlice } from "../capability/CapabilityEngine";
import { CapabilityOntology } from "../ontology/CapabilityOntology";
import { SemanticNaturalLanguageResolver } from "./editorial/SemanticNaturalLanguageResolver";
import { isMeaningfulEvidenceQuote } from "@/domain/evidence";

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
  dynamicProfile?: unknown
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
  const finalRecommendation = narrative.recommendation;

  const cleanDimensions = Array.isArray(source.dimensions)
    ? source.dimensions.map((d: Record<string, unknown>): DimensionResult => {
        const jdEv = d.jdEvidence as Record<string, unknown> | undefined;
        const rawStatus = (jdEv?.status as import("@/data/opportunity-fixtures").Status | undefined) || "Missing";
        const rawEvidenceArr = Array.isArray(jdEv?.evidence) ? (jdEv.evidence as unknown[]) : [];
        const rawQuote = typeof (rawEvidenceArr[0] as Record<string, unknown> | undefined)?.quote === "string"
          ? String((rawEvidenceArr[0] as Record<string, unknown>).quote)
          : typeof jdEv?.quote === "string"
          ? String(jdEv.quote)
          : typeof d.quote === "string"
          ? String(d.quote)
          : "";
        const rawValue = typeof jdEv?.value === "string" ? String(jdEv.value) : typeof d.value === "string" ? String(d.value) : "";

        const hasValidQuote = isMeaningfulEvidenceQuote(rawQuote);
        const hasValue = typeof rawValue === "string" && rawValue.trim().length > 0;

        let finalStatus: import("@/data/opportunity-fixtures").Status = rawStatus;
        if (rawStatus === "Explicit") {
          if (!hasValidQuote) {
            finalStatus = "Missing";
          }
        }

        const isExplicit = finalStatus === "Explicit";
        let finalValue = "";
        if (isExplicit) {
          finalValue = hasValue ? rawValue.slice(0, 140) : rawQuote.slice(0, 140);
        } else if (finalStatus !== "Missing") {
          finalValue = typeof rawValue === "string" ? rawValue.slice(0, 140) : "";
        }
        const finalEvidence: { quote: string; source: import("@/data/opportunity-fixtures").EvidenceSource }[] = isExplicit && hasValidQuote
          ? [{ quote: rawQuote.slice(0, 140), source: "snippet" }]
          : [];

        return {
          key: ((d.key as string) || "mandate") as DimensionKey,
          label: (d.label as string) || (d.key as string) || "",
          importance: ((d.importance as string) || "Core") as "Core" | "Supporting" | "Context",
          bucket: finalStatus === "Missing" ? "Missing" : ((d.bucket as EvidenceBucket) || "Missing"),
          jdEvidence: {
            status: finalStatus,
            value: finalValue,
            evidence: finalEvidence,
          },
        };
      })
    : [];
  return {
    opportunity: {
      jobHash: source.jobHash,
      role: source.role,
      company: source.company,
      location: source.location,
      postedRelative: source.postedRelative || "recently",
      scrapedFrom: source.scrapedFrom || "LinkedIn",
      applyUrl: source.applyUrl,
      evaluationState: (source.evaluationState ?? "EVALUATED") as "EVALUATED" | "LEGACY",
      dimensions: cleanDimensions,
      decision: record.verb,
      recommendation: finalRecommendation,
      whyNow: narrative.whyNow,
      primaryConcern: source.primaryConcern || null,
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
        engineVerdict: record.verb as import("../../domain/decision_v4").EngineVerdict,
        vetoed: Boolean(record.vetoed),
        vetoReason: record.vetoReason || null,
        qualityScore: record.vetoed ? null : (record.qualityScore !== null && record.qualityScore !== undefined ? Math.round(record.qualityScore) : null),
        parsingConfidence: record.confidences?.parsing ?? (record.confidence ?? 0.8),
        evaluatedAt: new Date().toISOString(),
        triggeredRuleIds: record.triggeredRuleIds,
        decisionRisks: record.decisionRisks,
        decisionDrivers: record.decisionDrivers,
        relativeDifferentiator: record.relativeDifferentiator,
        opportunityScoreConfidence: record.opportunityScoreConfidence,
        opportunityScoreSource: record.opportunityScoreSource,
        trajectoryUpside: record.trajectoryUpside,
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
      recommendedAction: (narrative as any).recommendedAction || record.verb,
    },
    record,
    narrative,
  };
}
