import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

export const HIGH_RISK_FAMILIES = [
  "REPORTING_LINE",
  "FOUNDER_CEO_PROXIMITY",
  "BOARD_EXPOSURE",
  "PNL_OWNERSHIP",
  "REVENUE_ACCOUNTABILITY",
  "PROFITABILITY_ACCOUNTABILITY",
  "DECISION_AUTHORITY",
  "PEOPLE_LEADERSHIP",
  "PEOPLE_SCALE"
] as const;

export type HighRiskFamily = typeof HIGH_RISK_FAMILIES[number];

export interface NormalizedReferenceFact {
  id: string;
  documentId: string;
  sourceEvidence: string[];
  canonicalTypes: string[];
  appliesTo: "ROLE" | "CANDIDATE_REQUIREMENT" | "CANDIDATE_PREFERENCE" | "COMPANY" | "RECRUITING_PROCESS";
  polarity: "AFFIRMED" | "NEGATED" | "CONDITIONAL";
  highRiskFamily: string | null;
  propositionText: string;
}

export interface CommonAssertion {
  id?: string;
  documentId: string;
  architecture: "ARCH_A" | "ARCH_B" | "ARCH_C";
  sourceEvidence: string[];
  canonicalTypes: string[];
  appliesTo: "ROLE" | "CANDIDATE_REQUIREMENT" | "CANDIDATE_PREFERENCE" | "COMPANY" | "RECRUITING_PROCESS" | "REPRESENTATION_UNAVAILABLE";
  polarity: "AFFIRMED" | "NEGATED" | "CONDITIONAL" | "REPRESENTATION_UNAVAILABLE";
  condition?: string;
  interpretation?: string;
  exactText?: string;
  confidence?: number;
}

export interface HighRiskViolation {
  violationType: 
    | "NEGATED_TO_AFFIRMED"
    | "CONDITIONAL_TO_AFFIRMED"
    | "REQUIREMENT_TO_ROLE"
    | "PREFERENCE_TO_ROLE"
    | "COMPANY_TO_ROLE"
    | "PROCESS_TO_ROLE"
    | "FORBIDDEN_HIGH_RISK_NEGATIVE"
    | "DISCLAIMER_SPAN_AFFIRMED";
  assertionText: string;
  sourceSpans: string[];
  canonicalTypes: string[];
  reason: string;
}

export interface DocumentEvaluationResult {
  documentId: string;
  partition: string;
  architecture: string;
  referenceFactCount: number;
  selectionMatches: number;
  typedMatches: number;
  selectionRecall: number;
  typedRecall: number;
  applicabilityMatches: number;
  applicabilityEvaluated: number;
  applicabilityAccuracy: number | null;
  polarityMatches: number;
  polarityEvaluated: number;
  polarityAccuracy: number | null;
  highRiskViolations: HighRiskViolation[];
  highRiskViolationCount: number;
  totalAssertionsEmitted: number;
  unmappedConceptsCount: number;
  unmappedConcepts: string[];
}

export interface CandidateEvaluationResult {
  documentId: string;
  architecture: "DETERMINISTIC_V1" | "GEMINI_SOURCE_ID_04B";
  referenceFactCount: number;
  referenceRecallCount: number;
  referenceRecall: number;
  typedRecallCount: number;
  typedRecall: number;
  evidenceClassMatches: number;
  evidenceClassAccuracy: number;
  metricRetentionCount: number;
  totalMetricsInReference: number;
  metricRetentionRate: number;
  employerBindingMatches: number;
  totalEmployersInReference: number;
  employerBindingAccuracy: number;
  crossPositionContaminationCount: number;
  selfSummaryPromotionCount: number;
  crossDocumentContaminationCount: number;
  totalClaimsEmitted: number;
  proofPrecision: number;
}

// -------------------------------------------------------------
// Reference Truth Audit & Normalization
// -------------------------------------------------------------

export function normalizeReferenceTruth(rawDoc: any): {
  normalizedFacts: NormalizedReferenceFact[];
  highRiskNegatives: string[];
  disclaimerSpans: string[];
  negativeBoundariesText: string[];
} {
  const documentId = rawDoc.documentId;
  const facts: NormalizedReferenceFact[] = [];
  const highRiskNegatives: string[] = Array.isArray(rawDoc.highRiskNegatives) ? [...rawDoc.highRiskNegatives] : [];
  const disclaimerSpans: string[] = [];
  const negativeBoundariesText: string[] = Array.isArray(rawDoc.negativeBoundaries) ? [...rawDoc.negativeBoundaries] : [];

  // Extract spans from negativeDisclaimers if available
  if (Array.isArray(rawDoc.negativeDisclaimers)) {
    for (const d of rawDoc.negativeDisclaimers) {
      const match = d.match(/\(S\d+\)/g);
      if (match) {
        for (const m of match) {
          disclaimerSpans.push(m.replace(/[()]/g, ""));
        }
      }
    }
  }

  // Parse negative boundaries to extract high-risk families if mentioned
  for (const b of negativeBoundariesText) {
    const textUpper = b.toUpperCase();
    if (textUpper.includes("P&L") || textUpper.includes("PROFIT") || textUpper.includes("BUDGET")) {
      if (!highRiskNegatives.includes("PNL_OWNERSHIP")) highRiskNegatives.push("PNL_OWNERSHIP");
    }
    if (textUpper.includes("REPORTING") || textUpper.includes("REPORTS TO") || textUpper.includes("CEO") || textUpper.includes("BOARD")) {
      if (!highRiskNegatives.includes("REPORTING_LINE")) highRiskNegatives.push("REPORTING_LINE");
    }
  }

  const rawFacts = Array.isArray(rawDoc.materialFacts) ? rawDoc.materialFacts : [];
  for (const rf of rawFacts) {
    let sourceEvidence: string[] = [];
    if (Array.isArray(rf.keySpanIds) && rf.keySpanIds.length > 0) {
      sourceEvidence = [...rf.keySpanIds];
    } else if (rf.spanId) {
      sourceEvidence = [rf.spanId];
    }

    let canonicalTypes: string[] = [];
    if (Array.isArray(rf.canonicalTypes) && rf.canonicalTypes.length > 0) {
      canonicalTypes = [...rf.canonicalTypes];
    } else if (rf.semanticType) {
      canonicalTypes = [rf.semanticType];
    }

    let appliesTo: NormalizedReferenceFact["appliesTo"] = "ROLE";
    if (rf.appliesTo) {
      appliesTo = rf.appliesTo;
    } else if (rf.subject === "COMPANY") {
      appliesTo = "COMPANY";
    } else if (rf.subject === "CANDIDATE") {
      appliesTo = "CANDIDATE_REQUIREMENT";
    } else if (rf.subject === "PROCESS") {
      appliesTo = "RECRUITING_PROCESS";
    }

    let polarity: NormalizedReferenceFact["polarity"] = "AFFIRMED";
    if (rf.polarity) {
      polarity = rf.polarity;
    }

    // Determine high risk family generically
    let highRiskFamily: string | null = rf.highRiskFamily ?? null;
    if (!highRiskFamily) {
      const matchFamily = canonicalTypes.find(t => (HIGH_RISK_FAMILIES as readonly string[]).includes(t));
      if (matchFamily) highRiskFamily = matchFamily;
    }

    const propositionText = rf.proposition ?? rf.exactText ?? rf.context ?? "";

    facts.push({
      id: rf.id,
      documentId,
      sourceEvidence,
      canonicalTypes,
      appliesTo,
      polarity,
      highRiskFamily,
      propositionText
    });
  }

  return {
    normalizedFacts: facts,
    highRiskNegatives,
    disclaimerSpans,
    negativeBoundariesText
  };
}

// -------------------------------------------------------------
// Common Assertion Adapters
// -------------------------------------------------------------

export function adaptArchitectureA(docId: string, rawJson: any, segmentedUnits: any[]): CommonAssertion[] {
  const atoms = rawJson.atoms ?? rawJson.assembly?.output?.atoms ?? [];
  const assertions: CommonAssertion[] = [];

  for (const a of atoms) {
    const start = a.startOffset ?? 0;
    const end = a.endOffset ?? 0;
    const exactText = a.exactText ?? "";

    // Map to span IDs via segmented units
    const matchingSpans: string[] = [];
    for (const u of segmentedUnits) {
      const uStart = u.startOffset ?? 0;
      const uEnd = u.endOffset ?? 0;
      if (start > 0 && end > 0 && uStart >= 0 && uEnd >= 0) {
        if (!(end <= uStart || start >= uEnd)) {
          matchingSpans.push(u.spanId);
        }
      } else if (exactText && u.exactText && (u.exactText.includes(exactText) || exactText.includes(u.exactText))) {
        matchingSpans.push(u.spanId);
      }
    }

    let appliesTo: CommonAssertion["appliesTo"] = "REPRESENTATION_UNAVAILABLE";
    if (a.subject === "ROLE") appliesTo = "ROLE";
    else if (a.subject === "COMPANY") appliesTo = "COMPANY";
    else if (a.subject === "CANDIDATE") appliesTo = "CANDIDATE_REQUIREMENT";
    else if (a.subject === "PROCESS") appliesTo = "RECRUITING_PROCESS";

    assertions.push({
      id: a.id,
      documentId: docId,
      architecture: "ARCH_A",
      sourceEvidence: matchingSpans.length > 0 ? matchingSpans : (a.spanId ? [a.spanId] : []),
      canonicalTypes: a.semanticType ? [a.semanticType] : [],
      appliesTo,
      polarity: "REPRESENTATION_UNAVAILABLE", // Arch A has no polarity channel
      exactText: a.exactText,
      confidence: a.confidence ?? 1.0
    });
  }

  return assertions;
}

export function adaptArchitectureB(docId: string, resolvedJson: any): CommonAssertion[] {
  const atoms = resolvedJson.assembly?.output?.atoms ?? [];
  const grounding = resolvedJson.grounding ?? [];
  const assertions: CommonAssertion[] = [];

  for (const a of atoms) {
    let sourceEvidence: string[] = Array.isArray(a.sourceUnits) ? [...a.sourceUnits] : [];
    if (sourceEvidence.length === 0) {
      const gMatch = grounding.find((g: any) => g.exactQuote === a.exactText || g.semanticType === a.semanticType);
      if (gMatch && gMatch.spanId) {
        sourceEvidence = [gMatch.spanId];
      }
    }

    let appliesTo: CommonAssertion["appliesTo"] = "ROLE";
    if (a.subject === "COMPANY") appliesTo = "COMPANY";
    else if (a.subject === "CANDIDATE") appliesTo = "CANDIDATE_REQUIREMENT";
    else if (a.subject === "PROCESS") appliesTo = "RECRUITING_PROCESS";

    // Arch B has no polarity channel in its schema; any emitted canonical fact is effectively affirmative
    assertions.push({
      documentId: docId,
      architecture: "ARCH_B",
      sourceEvidence,
      canonicalTypes: a.semanticType ? [a.semanticType] : [],
      appliesTo,
      polarity: "AFFIRMED",
      exactText: a.exactText,
      confidence: a.confidence ?? 1.0
    });
  }

  return assertions;
}

export function adaptArchitectureC(docId: string, resolvedJson: any): CommonAssertion[] {
  const props = resolvedJson.propositions ?? [];
  const assertions: CommonAssertion[] = [];

  for (const p of props) {
    assertions.push({
      id: p.id,
      documentId: docId,
      architecture: "ARCH_C",
      sourceEvidence: Array.isArray(p.sourceEvidence) ? [...p.sourceEvidence] : [],
      canonicalTypes: Array.isArray(p.canonicalTypes) ? [...p.canonicalTypes] : [],
      appliesTo: p.appliesTo ?? "ROLE",
      polarity: p.polarity ?? "AFFIRMED",
      condition: p.conditionDescription,
      interpretation: p.proposition,
      exactText: p.proposition,
      confidence: p.confidence ?? 1.0
    });
  }

  return assertions;
}

// -------------------------------------------------------------
// Generic Semantic Matcher
// -------------------------------------------------------------

function tokenizeWords(str: string): Set<string> {
  const stopWords = new Set(["the", "a", "an", "and", "or", "in", "on", "at", "to", "for", "of", "with", "is", "are", "be", "this", "that"]);
  const tokens = str.toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
  return new Set(tokens);
}

function wordOverlapSimilarity(a: string, b: string): number {
  const setA = tokenizeWords(a);
  const setB = tokenizeWords(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  Array.from(setA).forEach(w => {
    if (setB.has(w)) intersection++;
  });
  return intersection / Math.max(setA.size, setB.size);
}

// -------------------------------------------------------------
// Generic Document Evaluator (Zero Hardcoded Document IDs)
// -------------------------------------------------------------

export function evaluateDocumentAssertions(
  docId: string,
  partition: string,
  architecture: string,
  refFacts: NormalizedReferenceFact[],
  highRiskNegatives: string[],
  disclaimerSpans: string[],
  assertions: CommonAssertion[]
): DocumentEvaluationResult {
  let selectionMatches = 0;
  let typedMatches = 0;
  let applicabilityMatches = 0;
  let applicabilityEvaluated = 0;
  let polarityMatches = 0;
  let polarityEvaluated = 0;

  const unmappedConceptsSet = new Set<string>();

  // 1. Evaluate Predeclared Reference Recall
  for (const rf of refFacts) {
    // An assertion matches refFact if:
    // 1) Spans overlap
    // 2) Semantic correspondence: shares at least one canonical type OR high text similarity
    const matchingAssertions = assertions.filter(a => {
      const spanOverlap = a.sourceEvidence.some(s => rf.sourceEvidence.includes(s));
      if (!spanOverlap) return false;
      const typeOverlap = a.canonicalTypes.some(t => rf.canonicalTypes.includes(t));
      if (typeOverlap) return true;
      const sim = wordOverlapSimilarity(a.interpretation ?? a.exactText ?? "", rf.propositionText);
      return sim >= 0.35;
    });

    if (matchingAssertions.length > 0) {
      selectionMatches++;

      // Typed Match: must share at least one canonical type
      const typed = matchingAssertions.find(a => a.canonicalTypes.some(t => rf.canonicalTypes.includes(t)));
      if (typed) {
        typedMatches++;

        // Applicability evaluation
        if (typed.appliesTo !== "REPRESENTATION_UNAVAILABLE") {
          applicabilityEvaluated++;
          if (typed.appliesTo === rf.appliesTo) applicabilityMatches++;
        }

        // Polarity evaluation
        if (typed.polarity !== "REPRESENTATION_UNAVAILABLE") {
          polarityEvaluated++;
          if (typed.polarity === rf.polarity) polarityMatches++;
        }
      }
    }
  }

  // 2. Evaluate High-Risk Violations Generically
  const violations: HighRiskViolation[] = [];

  for (const a of assertions) {
    const isHighRiskType = a.canonicalTypes.some(t => (HIGH_RISK_FAMILIES as readonly string[]).includes(t));

    // A. Check against reference facts covering the same span
    const refOnSameSpan = refFacts.filter(rf => rf.sourceEvidence.some(s => a.sourceEvidence.includes(s)));

    for (const rf of refOnSameSpan) {
      // 1) NEGATED -> AFFIRMED
      if (rf.polarity === "NEGATED" && a.polarity === "AFFIRMED" && isHighRiskType) {
        violations.push({
          violationType: "NEGATED_TO_AFFIRMED",
          assertionText: a.interpretation ?? a.exactText ?? "",
          sourceSpans: a.sourceEvidence,
          canonicalTypes: a.canonicalTypes,
          reason: `Reference fact ${rf.id} declares NEGATED on ${rf.sourceEvidence.join(",")}, but extractor asserted affirmative authority for ${a.canonicalTypes.join(",")}.`
        });
      }

      // 2) CONDITIONAL -> AFFIRMED
      if (rf.polarity === "CONDITIONAL" && a.polarity === "AFFIRMED" && (!a.condition || a.condition.trim() === "") && isHighRiskType) {
        violations.push({
          violationType: "CONDITIONAL_TO_AFFIRMED",
          assertionText: a.interpretation ?? a.exactText ?? "",
          sourceSpans: a.sourceEvidence,
          canonicalTypes: a.canonicalTypes,
          reason: `Reference fact ${rf.id} requires CONDITIONAL authorization, but extractor asserted unconditioned affirmative authority.`
        });
      }

      // 3) CANDIDATE_REQUIREMENT -> ROLE
      if (rf.appliesTo === "CANDIDATE_REQUIREMENT" && a.appliesTo === "ROLE" && isHighRiskType) {
        violations.push({
          violationType: "REQUIREMENT_TO_ROLE",
          assertionText: a.interpretation ?? a.exactText ?? "",
          sourceSpans: a.sourceEvidence,
          canonicalTypes: a.canonicalTypes,
          reason: `Candidate prerequisite on ${rf.sourceEvidence.join(",")} inverted into active role authority for ${a.canonicalTypes.join(",")}.`
        });
      }

      // 4) COMPANY -> ROLE
      if (rf.appliesTo === "COMPANY" && a.appliesTo === "ROLE" && isHighRiskType) {
        violations.push({
          violationType: "COMPANY_TO_ROLE",
          assertionText: a.interpretation ?? a.exactText ?? "",
          sourceSpans: a.sourceEvidence,
          canonicalTypes: a.canonicalTypes,
          reason: `Company background scale on ${rf.sourceEvidence.join(",")} asserted as role authority.`
        });
      }

      // 5) RECRUITING_PROCESS -> ROLE
      if (rf.appliesTo === "RECRUITING_PROCESS" && a.appliesTo === "ROLE") {
        violations.push({
          violationType: "PROCESS_TO_ROLE",
          assertionText: a.interpretation ?? a.exactText ?? "",
          sourceSpans: a.sourceEvidence,
          canonicalTypes: a.canonicalTypes,
          reason: `Recruiting process step inverted into role authority.`
        });
      }
    }

    // B. Check against document-level declared highRiskNegatives
    for (const forbiddenType of highRiskNegatives) {
      if (a.canonicalTypes.includes(forbiddenType) && a.polarity === "AFFIRMED") {
        violations.push({
          violationType: "FORBIDDEN_HIGH_RISK_NEGATIVE",
          assertionText: a.interpretation ?? a.exactText ?? "",
          sourceSpans: a.sourceEvidence,
          canonicalTypes: a.canonicalTypes,
          reason: `Document explicitly excludes ${forbiddenType}, but extractor asserted affirmative fact.`
        });
      }
    }

    // C. Check against disclaimer spans
    const hasDisclaimerSpan = a.sourceEvidence.some(s => disclaimerSpans.includes(s));
    if (hasDisclaimerSpan && a.polarity === "AFFIRMED" && isHighRiskType) {
      violations.push({
        violationType: "DISCLAIMER_SPAN_AFFIRMED",
        assertionText: a.interpretation ?? a.exactText ?? "",
        sourceSpans: a.sourceEvidence,
        canonicalTypes: a.canonicalTypes,
        reason: `Extractor asserted affirmative high-risk authority on negative disclaimer span.`
      });
    }

    // Collect unmapped concepts
    if (a.canonicalTypes.length === 0 && a.interpretation) {
      unmappedConceptsSet.add(a.interpretation);
    }
  }

  const selectionRecall = refFacts.length > 0 ? selectionMatches / refFacts.length : 0;
  const typedRecall = refFacts.length > 0 ? typedMatches / refFacts.length : 0;
  const applicabilityAccuracy = applicabilityEvaluated > 0 ? applicabilityMatches / applicabilityEvaluated : null;
  const polarityAccuracy = polarityEvaluated > 0 ? polarityMatches / polarityEvaluated : null;

  return {
    documentId: docId,
    partition,
    architecture,
    referenceFactCount: refFacts.length,
    selectionMatches,
    typedMatches,
    selectionRecall,
    typedRecall,
    applicabilityMatches,
    applicabilityEvaluated,
    applicabilityAccuracy,
    polarityMatches,
    polarityEvaluated,
    polarityAccuracy,
    highRiskViolations: violations,
    highRiskViolationCount: violations.length,
    totalAssertionsEmitted: assertions.length,
    unmappedConceptsCount: unmappedConceptsSet.size,
    unmappedConcepts: Array.from(unmappedConceptsSet)
  };
}

// -------------------------------------------------------------
// Candidate Proof Evaluator (Generic)
// -------------------------------------------------------------

export function evaluateCandidateProofExtractor(
  docId: string,
  architecture: "DETERMINISTIC_V1" | "GEMINI_SOURCE_ID_04B",
  refFacts: any[],
  claims: any[]
): CandidateEvaluationResult {
  let refRecallCount = 0;
  let typedRecallCount = 0;
  let evidenceClassMatches = 0;
  let metricRetentionCount = 0;
  let employerBindingMatches = 0;
  let totalMetricsInReference = 0;
  let totalEmployersInReference = 0;
  let selfSummaryPromotionCount = 0;
  let crossPositionContaminationCount = 0;
  let crossDocumentContaminationCount = 0;

  for (const rf of refFacts) {
    if (rf.metric) totalMetricsInReference++;
    if (rf.employer) totalEmployersInReference++;

    // Find claim covering this reference fact
    const matchingClaim = claims.find((c: any) => {
      // Check text or span match
      if (rf.exactText && c.exactText && (c.exactText.includes(rf.exactText) || rf.exactText.includes(c.exactText))) return true;
      if (rf.exactText && c.parentBulletExactText && c.parentBulletExactText.includes(rf.exactText)) return true;
      if (rf.spanId && c.spanId && c.spanId === rf.spanId) return true;
      return false;
    });

    if (matchingClaim) {
      refRecallCount++;

      // Typed recall: proofType match
      const cTypes: string[] = matchingClaim.proofTypes ?? (matchingClaim.proofType ? [matchingClaim.proofType] : []);
      if (rf.proofType && cTypes.some(t => t.toUpperCase() === rf.proofType.toUpperCase() || rf.proofType.toUpperCase().includes(t.toUpperCase()))) {
        typedRecallCount++;
      }

      // Evidence class accuracy
      if (matchingClaim.evidenceClass === rf.evidenceClass) {
        evidenceClassMatches++;
      } else if (rf.evidenceClass === "SELF_SUMMARY" && matchingClaim.evidenceClass === "WORK_HISTORY") {
        selfSummaryPromotionCount++;
      }

      // Metric retention
      if (rf.metric) {
        const hasMetric = Array.isArray(matchingClaim.metrics) && matchingClaim.metrics.length > 0;
        const textHasNumber = /\d+/.test(matchingClaim.exactText ?? "");
        if (hasMetric || textHasNumber) {
          metricRetentionCount++;
        }
      }

      // Employer binding
      if (rf.employer) {
        if (matchingClaim.employer && (matchingClaim.employer.includes(rf.employer) || rf.employer.includes(matchingClaim.employer))) {
          employerBindingMatches++;
        } else if (matchingClaim.employer && matchingClaim.employer !== rf.employer) {
          crossPositionContaminationCount++;
        }
      }
    }
  }

  // Cross document contamination
  for (const c of claims) {
    if (c.sourceDocumentId && c.sourceDocumentId !== docId) {
      crossDocumentContaminationCount++;
    }
  }

  const totalEmitted = claims.length;
  const proofPrecision = totalEmitted > 0 ? Math.min(1.0, refRecallCount / totalEmitted) : 0;

  return {
    documentId: docId,
    architecture,
    referenceFactCount: refFacts.length,
    referenceRecallCount: refRecallCount,
    referenceRecall: refFacts.length > 0 ? refRecallCount / refFacts.length : 0,
    typedRecallCount,
    typedRecall: refFacts.length > 0 ? typedRecallCount / refFacts.length : 0,
    evidenceClassMatches,
    evidenceClassAccuracy: refRecallCount > 0 ? evidenceClassMatches / refRecallCount : 0,
    metricRetentionCount,
    totalMetricsInReference,
    metricRetentionRate: totalMetricsInReference > 0 ? metricRetentionCount / totalMetricsInReference : 0,
    employerBindingMatches,
    totalEmployersInReference,
    employerBindingAccuracy: totalEmployersInReference > 0 ? employerBindingMatches / totalEmployersInReference : 0,
    crossPositionContaminationCount,
    selfSummaryPromotionCount,
    crossDocumentContaminationCount,
    totalClaimsEmitted: totalEmitted,
    proofPrecision
  };
}
