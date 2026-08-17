/**
 * scripts/eval/v4-simulation/verbatim-auditor.ts
 *
 * Verbatim Quality & Evidence Lineage Auditor for RADAR V4 Phase 8.
 * Breaks down all customer-facing editorial statements into atomic sentences,
 * classifies them into 7 standard categories, traces evidence provenance to the raw JD,
 * and computes objective quality metrics.
 */

import type { BriefModel } from "@/lib/intelligence/editorial/BriefCompositionEngine";
import type { SimulationRecord, VerbatimTrace, ObjectiveQualityScores, VerbatimClassification } from "./types";

const GENERIC_CLICHES = [
  "driving business growth",
  "culture of excellence",
  "strategic initiatives",
  "cross-functional teams",
  "best and the brightest",
  "seamlessly",
  "exceptional ideas",
  "standard executive application",
  "accelerate growth",
  "drive organizational success",
];

function splitSentences(text: string): string[] {
  if (!text) return [];
  return text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);
}

function findJDEvidenceMatch(sentence: string, fullJDText: string, dimensions: any[]): { grounded: boolean; quote?: string; matchedKey?: string } {
  const sLower = sentence.toLowerCase();
  const jdLower = (fullJDText || "").toLowerCase();

  // 1. Direct substring match or keyword density match in JD text
  const words = sLower.replace(/[^\w\s]/g, "").split(/\s+/).filter((w) => w.length > 4);
  let matchedWordCount = 0;
  for (const w of words) {
    if (jdLower.includes(w)) {
      matchedWordCount++;
    }
  }

  const keywordCoverage = words.length > 0 ? matchedWordCount / words.length : 0;

  // 2. Check extracted dimensions evidence quotes
  for (const dim of dimensions) {
    const quotes = dim.jdEvidence?.evidence || [];
    for (const q of quotes) {
      if (q.quote && sLower.includes(q.quote.toLowerCase())) {
        return { grounded: true, quote: q.quote, matchedKey: dim.key };
      }
    }
    if (dim.jdEvidence?.value && sLower.includes(String(dim.jdEvidence.value).toLowerCase())) {
      return { grounded: true, quote: String(dim.jdEvidence.value), matchedKey: dim.key };
    }
  }

  if (keywordCoverage >= 0.6) {
    // Find approximate snippet in JD
    const firstMatch = words.find((w) => jdLower.includes(w));
    let quote = "";
    if (firstMatch) {
      const idx = jdLower.indexOf(firstMatch);
      quote = fullJDText.slice(Math.max(0, idx - 20), Math.min(fullJDText.length, idx + 80)).trim();
    }
    return { grounded: true, quote: quote || undefined };
  }

  return { grounded: false };
}

function classifySentence(
  sentence: string,
  section: string,
  record: SimulationRecord,
  grounding: { grounded: boolean; quote?: string; matchedKey?: string }
): VerbatimClassification {
  const sLower = sentence.toLowerCase();
  const policyVerdict = record.policyResult.verdict;

  // 1. Generic Cliché Check
  const isGeneric = GENERIC_CLICHES.some((c) => sLower.includes(c));
  if (isGeneric && !grounding.grounded) {
    return "GENERIC / LOW-VALUE";
  }

  // 2. Contradiction Check
  if (policyVerdict === "PASS" && (sLower.includes("high-priority pursue") || sLower.includes("compelling strategic match") || sLower.includes("proceed immediately"))) {
    return "CONTRADICTORY";
  }
  if (policyVerdict === "PURSUE" && sLower.includes("strategic pass recommended")) {
    return "CONTRADICTORY";
  }

  // 3. Factual Check (Titles, Company name, Location, explicit numbers)
  if (
    sLower.includes(record.role.toLowerCase()) ||
    sLower.includes(record.company.toLowerCase()) ||
    (record.location && sLower.includes(record.location.toLowerCase()))
  ) {
    if (grounding.grounded) return "FACTUAL";
  }

  // 4. Grounded Inference Check
  if (grounding.grounded) {
    if (section === "qualitativeReasoning" || section === "strategicUpside" || section === "tradeoff") {
      return "EVIDENCE-GROUNDED INFERENCE";
    }
    return "FACTUAL";
  }

  // 5. Reasonable Interpretation vs Speculative vs Unsupported
  if (section === "whyNow" || section === "first90Days" || section === "actionGuidance") {
    return "REASONABLE INTERPRETATION";
  }

  // Check if it claims unverified numbers/budgets
  if (/\b(\d+\s*cr|\$\d+|p&l of \d+)\b/i.test(sentence)) {
    return "UNSUPPORTED";
  }

  return "SPECULATIVE";
}

export function auditVerbatims(record: SimulationRecord): {
  audits: VerbatimTrace[];
  objectiveScores: ObjectiveQualityScores;
} {
  const audits: VerbatimTrace[] = [];
  const brief = record.briefModel;
  const rawJD = record.fullJDText;
  const dimensions = record.extractedDimensions || [];

  let nextId = 1;

  function processText(text: string | undefined | null, section: string, field: string) {
    if (!text) return;
    const sentences = splitSentences(text);
    for (const s of sentences) {
      const match = findJDEvidenceMatch(s, rawJD, dimensions);
      const classification = classifySentence(s, section, record, match);

      audits.push({
        id: `vbt_${record.jobHash}_${nextId++}`,
        section,
        field,
        verbatim: s,
        classification,
        editorialPattern: (brief as any)?.narrative?.intent || "StandardExecutiveBrief",
        policySignal: record.policyResult.triggeredRuleIds?.join(", "),
        matchedOntologyKey: match.matchedKey,
        jdQuote: match.quote,
        groundedInJD: match.grounded,
      });
    }
  }

  if (brief) {
    // Memory
    processText(brief.memory.headline, "Memory", "headline");
    processText(brief.memory.retentionSentence, "Memory", "retentionSentence");
    processText(brief.memory.primaryOpportunity, "Memory", "primaryOpportunity");
    processText(brief.memory.primaryRisk, "Memory", "primaryRisk");
    processText(brief.memory.recommendedAction, "Memory", "recommendedAction");
    processText(brief.memory.tradeoff, "Memory", "tradeoff");
    processText(brief.memory.first90Days, "Memory", "first90Days");
    processText(brief.memory.whyNow, "Memory", "whyNow");

    // One Minute TLDR
    if (brief.oneMinuteTLDR) {
      (brief.oneMinuteTLDR.whyPursue || []).forEach((item, idx) =>
        processText(item, "OneMinuteTLDR", `whyPursue_${idx}`)
      );
      (brief.oneMinuteTLDR.watchFor || []).forEach((item, idx) =>
        processText(item, "OneMinuteTLDR", `watchFor_${idx}`)
      );
      processText(brief.oneMinuteTLDR.bottomLine, "OneMinuteTLDR", "bottomLine");
    }

    // Strategic Upside
    if (brief.strategicUpside) {
      processText(brief.strategicUpside.headline, "StrategicUpside", "headline");
      (brief.strategicUpside.points || []).forEach((p, idx) =>
        processText(p, "StrategicUpside", `point_${idx}`)
      );
    }

    // Qualitative Reasoning
    if (brief.qualitativeReasoningChain) {
      brief.qualitativeReasoningChain.forEach((row, idx) => {
        processText(row.ratingLabel, "QualitativeReasoning", `row_${idx}_label`);
        (row.becausePoints || []).forEach((bp, bIdx) =>
          processText(bp, "QualitativeReasoning", `row_${idx}_because_${bIdx}`)
        );
        processText(row.evidenceSnippet, "QualitativeReasoning", `row_${idx}_snippet`);
      });
    }

    // Structured Sections
    if (brief.structuredSections) {
      processText(brief.structuredSections.context?.thesis, "StructuredSections", "context_thesis");
      processText(brief.structuredSections.mandate?.thesis, "StructuredSections", "mandate_thesis");
      processText(brief.structuredSections.synthesis?.thesis, "StructuredSections", "synthesis_thesis");
      processText(brief.structuredSections.strategy?.thesis, "StructuredSections", "strategy_thesis");
    }

    // Deliverables
    if (brief.deliverables) {
      (brief.deliverables.workRequired || []).forEach((w, idx) =>
        processText(w, "Deliverables", `work_${idx}`)
      );
      (brief.deliverables.businessValue || []).forEach((v, idx) =>
        processText(v, "Deliverables", `value_${idx}`)
      );
    }
  }

  // Calculate Objective Quality Scores
  const total = audits.length || 1;
  const groundedCount = audits.filter(
    (a) => a.classification === "FACTUAL" || a.classification === "EVIDENCE-GROUNDED INFERENCE"
  ).length;
  const contradictoryCount = audits.filter((a) => a.classification === "CONTRADICTORY").length;
  const unsupportedCount = audits.filter((a) => a.classification === "UNSUPPORTED").length;
  const genericCount = audits.filter((a) => a.classification === "GENERIC / LOW-VALUE").length;

  const evidenceGroundingScore = Math.max(0, Math.min(5, Math.round((groundedCount / total) * 5 * 10) / 10));
  const contradictionScore = Math.max(0, Math.min(5, 5 - contradictoryCount * 2.5));
  
  // Policy Alignment
  const isPolicyAligned = brief?.memory?.decision === record.policyResult.verdict;
  const policyAlignmentScore = isPolicyAligned ? (contradictoryCount === 0 ? 5.0 : 3.5) : 1.0;

  // Specificity
  const specificityScore = Math.max(0, Math.min(5, Math.round((1 - genericCount / total) * 5 * 10) / 10));

  // Risk Honesty
  const hasRiskSection = Boolean(brief?.memory?.primaryRisk || (brief?.oneMinuteTLDR?.watchFor && brief.oneMinuteTLDR.watchFor.length > 0));
  const hasPolicyRisks = (record.policyResult.decisionRisks || []).length > 0;
  const riskHonestyScore = hasPolicyRisks ? (hasRiskSection ? 4.8 : 2.0) : 4.5;

  // Calibration
  const calibrationScore = record.gateResult.passed ? (unsupportedCount > 2 ? 3.0 : 4.8) : (record.policyResult.verdict === "PASS" ? 5.0 : 2.0);

  // Actionability
  const hasAction = Boolean(brief?.memory?.recommendedAction || (brief?.deliverables?.workRequired && brief.deliverables.workRequired.length > 0));
  const actionabilityScore = hasAction ? 4.7 : 2.5;

  const totalObjectiveScore = Math.round(
    (evidenceGroundingScore +
      contradictionScore +
      policyAlignmentScore +
      specificityScore +
      riskHonestyScore +
      calibrationScore +
      actionabilityScore) *
      10
  ) / 10;

  return {
    audits,
    objectiveScores: {
      evidenceGroundingScore,
      contradictionScore,
      policyAlignmentScore,
      specificityScore,
      riskHonestyScore,
      calibrationScore,
      actionabilityScore,
      totalObjectiveScore,
    },
  };
}
