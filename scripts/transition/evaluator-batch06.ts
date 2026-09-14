/**
 * scripts/transition/evaluator-batch06.ts
 *
 * Authoritative Batch 06 Multi-Architecture Extraction Evaluator.
 * Derived directly from the frozen shared error taxonomy and validation contracts.
 *
 * Invariants Enforced:
 * 1. Historical Evaluator Immutability: evaluator-v2.ts and evaluator-r2.ts remain sealed.
 * 2. Pre-registered error classification:
 *    - FATAL_SAFETY_FAILURE (High-risk false affirmatives, polarity inversions, applicability boundary leaks, candidate span hallucination)
 *    - FATAL_DEFICIT_FAILURE (Recall catastrophe <40%, long-doc truncation <25%, candidate collapse <80%)
 *    - IMPLEMENTATION_TUNABLE (Marginal recall 40-50%, insufficient-evidence slump 80-90%, marginal candidate 80-90%, operational budget)
 * 3. Separate scoring of applicability vs polarity vs representation absence.
 * 4. Separate scoring of candidate metric fidelity, employer chronology binding, and mechanical offset provenance.
 * 5. General & Agnostic: ZERO fixture IDs, company names, benchmark phrases, or case-specific branching.
 */

import * as crypto from "node:crypto";
import type { StructuredMetric } from "../../src/lib/intelligence/extraction/CandidateProofExtractorV1";

// ============================================================================
// 1. Domain Constants & Taxonomy
// ============================================================================

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

export type ApplicabilityDomain =
  | "ROLE"
  | "CANDIDATE_REQUIREMENT"
  | "CANDIDATE_PREFERENCE"
  | "COMPANY"
  | "RECRUITING_PROCESS"
  | "REPRESENTATION_UNAVAILABLE";

export type PolarityType =
  | "AFFIRMED"
  | "NEGATED"
  | "CONDITIONAL"
  | "REPRESENTATION_UNAVAILABLE";

export type FailureClassification =
  | "FATAL_SAFETY_FAILURE"
  | "FATAL_DEFICIT_FAILURE"
  | "IMPLEMENTATION_TUNABLE"
  | "NONE";

// ============================================================================
// 2. Data Contracts
// ============================================================================

export type ReferenceFactMateriality = "MATERIAL_SELECTED" | "SUPPORTING_NON_MATERIAL";

export const CANDIDATE_EVIDENCE_CLASSES = [
  "WORK_HISTORY",
  "SELF_SUMMARY",
  "CAPABILITY_LABEL"
] as const;

export type CandidateEvidenceClass = typeof CANDIDATE_EVIDENCE_CLASSES[number];

export const CANDIDATE_PROOF_TYPES = [
  "OUTCOME",
  "OWNERSHIP",
  "FINANCIAL_SCOPE",
  "PEOPLE_SCOPE",
  "GEOGRAPHIC_SCOPE",
  "ORGANIZATION_BUILD",
  "TRANSFORMATION",
  "MANDATE",
  "PRODUCT_LAUNCH",
  "CUSTOMER_GROWTH",
  "REVENUE_GROWTH",
  "COST_EFFICIENCY",
  "PIPELINE_GENERATION",
  "TECHNOLOGY_IMPLEMENTATION",
  "PARTNERSHIP",
  "STAKEHOLDER_LEADERSHIP",
  "DOMAIN_PRECEDENT",
  "CAPABILITY_LABEL"
] as const;

export type CandidateProofType = typeof CANDIDATE_PROOF_TYPES[number];

export interface NormalizedReferenceFact {
  id: string;
  documentId: string;
  sourceEvidence: string[];
  canonicalTypes: string[];
  appliesTo: Exclude<ApplicabilityDomain, "REPRESENTATION_UNAVAILABLE">;
  polarity: Exclude<PolarityType, "REPRESENTATION_UNAVAILABLE">;
  highRiskFamily: string | null;
  propositionText: string;
  materiality?: ReferenceFactMateriality;
}

export interface CommonAssertion {
  id?: string;
  documentId: string;
  architecture: string;
  sourceEvidence: string[];
  canonicalTypes: string[];
  appliesTo: ApplicabilityDomain;
  polarity: PolarityType;
  condition?: string;
  interpretation?: string;
  exactText?: string;
  confidence?: number;
}

export interface FactFailureClassification {
  factId: string;
  status:
    | "RECOVERED_TYPED"
    | "RECOVERED_SELECTION_ONLY"
    | "MISSED_ASSERTION"
    | "WRONG_TYPE";
  applicabilityStatus:
    | "APPLICABILITY_MATCH"
    | "WRONG_APPLICABILITY"
    | "APPLICABILITY_UNREPRESENTABLE"
    | "NOT_RECOVERED";
  polarityStatus:
    | "POLARITY_MATCH"
    | "WRONG_POLARITY"
    | "POLARITY_UNREPRESENTABLE"
    | "NOT_RECOVERED";
  isHighRisk: boolean;
}

export interface HighRiskSafetyBreakdown {
  observedFalseAffirmatives: number; // Emitted affirmative assertion directly contradicting negative reference or highRiskNegative
  emittedOnNegatedReferenceWithoutPolarity: number; // Emitted on negated span when polarity is UNREPRESENTABLE
  subjectApplicabilityErrors: number; // Candidate requirement or company context asserted as role authority
  unconditionalFromConditional: number; // Conditional fact emitted unconditionally
  recoveredHighRiskFacts: number;
  missedHighRiskFacts: number;
  couldNotRepresentPolarityHighRiskFacts: number;
}

export interface RoleDocumentEvaluationResult {
  documentId: string;
  partition: string;
  architecture: string;
  rawDocLength: number;
  totalReferenceFacts: number;
  selectionMatches: number;
  typedMatches: number;
  selectionRecall: number;
  typedRecall: number;
  materialSelectedCount?: number;
  materialSelectedTypedMatches?: number;
  materialSelectedTypedRecall?: number;
  exhaustiveFactCount?: number;
  exhaustiveTypedRecall?: number;
  factBreakdowns: FactFailureClassification[];
  highRiskBreakdown: HighRiskSafetyBreakdown;
  silentDimensionsCount?: number;
  silentDimensionsCapturedCount?: number;
  totalAssertionsEmitted: number;
  retainedAtomsCount?: number;
  rejectedAtomsCount?: number;
  unmappedConcepts: string[];
  latencyMs?: number;
  costUsd?: number;
}

export interface CandidateReferenceFact {
  id: string;
  documentId: string;
  exactText: string;
  spanId?: string;
  proofType?: CandidateProofType | string;
  proofTypes: (CandidateProofType | string)[];
  evidenceClass: CandidateEvidenceClass | string;
  metric?: string;
  metrics?: StructuredMetric[];
  employer?: string;
  title?: string;
  dates?: string;
  startDate?: string;
  endDate?: string | null;
  isCurrent?: boolean;
  startOffset?: number;
  endOffset?: number;
  dualReviewStatus?: "CONFIRMED" | "ADJUDICATED";
  secondReviewerConfirmed?: boolean;
}

export interface CandidateExtractedClaim {
  id?: string;
  sourceDocumentId?: string;
  exactText?: string;
  parentBulletExactText?: string;
  spanId?: string;
  proofType?: string;
  proofTypes?: (CandidateProofType | string)[];
  evidenceClass?: string;
  metric?: string;
  metrics?: (StructuredMetric | string)[];
  employer?: string;
  title?: string;
  dates?: string;
  startDate?: string;
  endDate?: string | null;
  isCurrent?: boolean;
  startOffset?: number;
  endOffset?: number;
}

export interface CandidateEvaluationResult {
  documentId: string;
  architecture: string;
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
  chronologyBindingMatches: number;
  totalWorkHistoryInReference: number;
  chronologyBindingAccuracy: number;
  offsetVerificationCount: number;
  offsetVerificationFailures: number;
  offsetAccuracyRate: number;
  selfSummaryPromotionCount: number;
  crossPositionContaminationCount: number;
  crossDocumentContaminationCount: number;
  totalClaimsEmitted: number;
  proofPrecision: number;
}

export interface PreRegisteredGates {
  highRiskFalseAffirmativesMax: number; // 0
  polarityInversionsMax: number; // 0
  applicabilityBoundaryLeaksMax: number; // 0
  candidateSpanProvenanceMin: number; // 1.0 (100%)
  typedRecallMin: number; // 0.50 (50%)
  longDocTypedRecallMin: number; // 0.35 (35%)
  insufficientEvidenceCaptureMin: number; // 0.90 (90%)
  candidateMetricFidelityMin: number; // 0.90 (90%)
  candidateChronologyBindingMin: number; // 0.90 (90%)
  candidateEmployerBindingMin: number; // 0.90 (90%)
  p95LatencyMsMax: number; // 15000 (15.0s)
  costPerDocUsdMax: number; // 0.04 ($0.04)
}

export const DEFAULT_BATCH06_GATES: PreRegisteredGates = {
  highRiskFalseAffirmativesMax: 0,
  polarityInversionsMax: 0,
  applicabilityBoundaryLeaksMax: 0,
  candidateSpanProvenanceMin: 1.0,
  typedRecallMin: 0.50,
  longDocTypedRecallMin: 0.35,
  insufficientEvidenceCaptureMin: 0.90,
  candidateMetricFidelityMin: 0.90,
  candidateChronologyBindingMin: 0.90,
  candidateEmployerBindingMin: 0.90,
  p95LatencyMsMax: 15000,
  costPerDocUsdMax: 0.04
};

export interface GateEvaluationDetail {
  metricName: string;
  targetValue: string;
  observedValue: string;
  passed: boolean;
  classification: FailureClassification;
  failureReason?: string;
}

export interface Batch06CertificationSummary {
  verdict: "PASS" | "FATAL_FAILURE" | "REMEDIATION_REQUIRED";
  summary: string;
  fatalFailuresCount: number;
  deficitFailuresCount: number;
  tunableFailuresCount: number;
  gateDetails: GateEvaluationDetail[];
  aggregateMetrics: {
    totalRoleDocs: number;
    totalCandidateDocs: number;
    overallTypedRecall: number;
    materialSelectedRecall?: number;
    exhaustiveTypedRecall?: number;
    longDocTypedRecall: number;
    insufficientEvidenceCaptureRate: number;
    totalHighRiskFalseAffirmatives: number;
    totalPolarityInversions: number;
    totalApplicabilityLeaks: number;
    candidateSpanProvenanceAccuracy: number;
    candidateMetricFidelity: number;
    candidateEmployerBinding: number;
    candidateChronologyBinding: number;
    p95LatencyMs: number;
    averageCostPerDocUsd: number;
  };
}

// ============================================================================
// 3. Normalization & Utility Functions
// ============================================================================

export function tokenizeWords(str: string): Set<string> {
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "in", "on", "at", "to", "for", "of", "with",
    "is", "are", "be", "this", "that", "by", "as", "from", "it", "will", "our"
  ]);
  const tokens = str
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
  return new Set(tokens);
}

export function wordOverlapSimilarity(a: string, b: string): number {
  const setA = tokenizeWords(a);
  const setB = tokenizeWords(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  return intersection / Math.max(setA.size, setB.size);
}

export function normalizeReferenceTruth(rawFixture: any): NormalizedReferenceFact[] {
  const norm: NormalizedReferenceFact[] = [];
  const docId = rawFixture.documentId ?? rawFixture.opaqueId ?? rawFixture.id ?? "UNKNOWN_DOC";

  const rawFacts = Array.isArray(rawFixture.materialFacts)
    ? rawFixture.materialFacts
    : Array.isArray(rawFixture.facts)
      ? rawFixture.facts
      : [];

  for (const f of rawFacts) {
    let spans: string[] = [];
    if (Array.isArray(f.keySpanIds)) spans = [...f.keySpanIds];
    else if (Array.isArray(f.sourceEvidence)) spans = [...f.sourceEvidence];
    else if (f.spanId) spans = [f.spanId];

    let types: string[] = [];
    if (Array.isArray(f.canonicalTypes)) types = [...f.canonicalTypes];
    else if (f.semanticType) types = [f.semanticType];

    let appliesTo: NormalizedReferenceFact["appliesTo"] = "ROLE";
    if (f.appliesTo) {
      appliesTo = f.appliesTo;
    } else if (f.subject === "COMPANY") {
      appliesTo = "COMPANY";
    } else if (f.subject === "CANDIDATE" || f.subject === "CANDIDATE_REQUIREMENT") {
      appliesTo = "CANDIDATE_REQUIREMENT";
    } else if (f.subject === "CANDIDATE_PREFERENCE") {
      appliesTo = "CANDIDATE_PREFERENCE";
    } else if (f.subject === "RECRUITING_PROCESS" || f.subject === "PROCESS") {
      appliesTo = "RECRUITING_PROCESS";
    }

    let hrFamily: string | null = null;
    if (f.highRiskFamily) {
      hrFamily = f.highRiskFamily;
    } else {
      const found = types.find(t => (HIGH_RISK_FAMILIES as readonly string[]).includes(t));
      if (found) hrFamily = found;
    }

    let materiality: ReferenceFactMateriality = "MATERIAL_SELECTED";
    if (f.materiality === "SUPPORTING_NON_MATERIAL") {
      materiality = "SUPPORTING_NON_MATERIAL";
    } else if (f.materiality === "MATERIAL_SELECTED") {
      materiality = "MATERIAL_SELECTED";
    }

    norm.push({
      id: f.id ?? crypto.randomUUID(),
      documentId: docId,
      sourceEvidence: spans,
      canonicalTypes: types,
      appliesTo,
      polarity: f.polarity ?? "AFFIRMED",
      highRiskFamily: hrFamily,
      propositionText: f.proposition ?? f.exactText ?? f.context ?? f.propositionText ?? "",
      materiality
    });
  }

  return norm;
}

// ============================================================================
// 4. Role Evaluation Engine
// ============================================================================

export function evaluateRoleDocument(
  docId: string,
  partition: string,
  architecture: string,
  rawDocLength: number,
  refFacts: NormalizedReferenceFact[],
  highRiskNegatives: string[],
  disclaimerSpans: string[],
  assertions: CommonAssertion[],
  options?: {
    retainedCount?: number;
    rejectedCount?: number;
    latencyMs?: number;
    costUsd?: number;
    highRiskSilentDimensions?: string[];
    unknownHighRiskDimensions?: string[];
  }
): RoleDocumentEvaluationResult {
  let selectionMatches = 0;
  let typedMatches = 0;
  const factBreakdowns: FactFailureClassification[] = [];
  const unmappedConcepts: string[] = [];

  // Evaluate High-Risk Silent Dimensions
  let silentDimensionsCount = 0;
  let silentDimensionsCapturedCount = 0;
  if (Array.isArray(options?.highRiskSilentDimensions)) {
    const unknownEmitted = new Set(options?.unknownHighRiskDimensions ?? []);
    for (const silentFamily of options.highRiskSilentDimensions) {
      silentDimensionsCount++;
      const affirmedHr = assertions.some(a =>
        a.polarity === "AFFIRMED" &&
        a.canonicalTypes.includes(silentFamily)
      );
      if (!affirmedHr && unknownEmitted.has(silentFamily)) {
        silentDimensionsCapturedCount++;
      }
    }
  }

  // Evaluate each reference fact
  for (const rf of refFacts) {
    const isHr =
      rf.highRiskFamily !== null ||
      rf.canonicalTypes.some(t => (HIGH_RISK_FAMILIES as readonly string[]).includes(t));

    // Match criteria: span overlap AND (canonical type match OR high word overlap)
    const matchingAssertions = assertions.filter(a => {
      const spanOverlap = a.sourceEvidence.some(s => rf.sourceEvidence.includes(s));
      if (!spanOverlap) return false;
      const typeOverlap = a.canonicalTypes.some(t => rf.canonicalTypes.includes(t));
      if (typeOverlap) return true;
      const sim = wordOverlapSimilarity(a.interpretation ?? a.exactText ?? "", rf.propositionText);
      return sim >= 0.35;
    });

    if (matchingAssertions.length === 0) {
      factBreakdowns.push({
        factId: rf.id,
        status: "MISSED_ASSERTION",
        applicabilityStatus: "NOT_RECOVERED",
        polarityStatus: "NOT_RECOVERED",
        isHighRisk: isHr
      });
      continue;
    }

    selectionMatches++;

    // Check typed match
    const typedAssertion = matchingAssertions.find(a =>
      a.canonicalTypes.some(t => rf.canonicalTypes.includes(t))
    );

    if (!typedAssertion) {
      factBreakdowns.push({
        factId: rf.id,
        status: "WRONG_TYPE",
        applicabilityStatus: "NOT_RECOVERED",
        polarityStatus: "NOT_RECOVERED",
        isHighRisk: isHr
      });
      continue;
    }

    typedMatches++;

    // Evaluate applicability separately
    let appStatus: FactFailureClassification["applicabilityStatus"] = "APPLICABILITY_MATCH";
    if (typedAssertion.appliesTo === "REPRESENTATION_UNAVAILABLE") {
      appStatus = "APPLICABILITY_UNREPRESENTABLE";
    } else if (typedAssertion.appliesTo !== rf.appliesTo) {
      appStatus = "WRONG_APPLICABILITY";
    }

    // Evaluate polarity separately
    let polStatus: FactFailureClassification["polarityStatus"] = "POLARITY_MATCH";
    if (typedAssertion.polarity === "REPRESENTATION_UNAVAILABLE") {
      polStatus = "POLARITY_UNREPRESENTABLE";
    } else if (typedAssertion.polarity !== rf.polarity) {
      polStatus = "WRONG_POLARITY";
    }

    factBreakdowns.push({
      factId: rf.id,
      status: "RECOVERED_TYPED",
      applicabilityStatus: appStatus,
      polarityStatus: polStatus,
      isHighRisk: isHr
    });
  }

  // Evaluate High-Risk Safety Breakdown across emitted assertions
  let observedFalseAffirmatives = 0;
  let emittedOnNegatedReferenceWithoutPolarity = 0;
  let subjectApplicabilityErrors = 0;
  let unconditionalFromConditional = 0;

  for (const a of assertions) {
    const isHrAssertion = a.canonicalTypes.some(t =>
      (HIGH_RISK_FAMILIES as readonly string[]).includes(t)
    );

    // A. Check against reference facts covering the same span
    const refOnSameSpan = refFacts.filter(rf =>
      rf.sourceEvidence.some(s => a.sourceEvidence.includes(s))
    );

    for (const rf of refOnSameSpan) {
      if (rf.polarity === "NEGATED" && isHrAssertion) {
        if (a.polarity === "AFFIRMED") {
          observedFalseAffirmatives++;
        } else if (a.polarity === "REPRESENTATION_UNAVAILABLE") {
          emittedOnNegatedReferenceWithoutPolarity++;
        }
      }

      if (rf.polarity === "CONDITIONAL" && isHrAssertion) {
        if (a.polarity === "AFFIRMED" && (!a.condition || a.condition.trim() === "")) {
          unconditionalFromConditional++;
        }
      }

      if (rf.appliesTo !== "ROLE" && a.appliesTo === "ROLE" && isHrAssertion) {
        subjectApplicabilityErrors++;
      }
    }

    // B. Check against document-level declared highRiskNegatives
    for (const forbiddenType of highRiskNegatives) {
      if (a.canonicalTypes.includes(forbiddenType)) {
        if (a.polarity === "AFFIRMED") {
          observedFalseAffirmatives++;
        } else if (a.polarity === "REPRESENTATION_UNAVAILABLE") {
          emittedOnNegatedReferenceWithoutPolarity++;
        }
      }
    }

    // C. Check against disclaimer spans
    const hasDisclaimerSpan = a.sourceEvidence.some(s => disclaimerSpans.includes(s));
    if (hasDisclaimerSpan && isHrAssertion) {
      if (a.polarity === "AFFIRMED") {
        observedFalseAffirmatives++;
      } else if (a.polarity === "REPRESENTATION_UNAVAILABLE") {
        emittedOnNegatedReferenceWithoutPolarity++;
      }
    }

    if (a.canonicalTypes.length === 0 && a.interpretation) {
      unmappedConcepts.push(a.interpretation);
    }
  }

  // Count high-risk recovery breakdown
  const hrFacts = factBreakdowns.filter(f => f.isHighRisk);
  const recoveredHighRiskFacts = hrFacts.filter(f => f.status === "RECOVERED_TYPED").length;
  const missedHighRiskFacts = hrFacts.filter(
    f => f.status === "MISSED_ASSERTION" || f.status === "WRONG_TYPE"
  ).length;
  const couldNotRepresentPolarityHighRiskFacts = hrFacts.filter(
    f => f.polarityStatus === "POLARITY_UNREPRESENTABLE"
  ).length;

  // Material vs Exhaustive Fact Partitioning
  const materialFacts = refFacts.filter(f => f.materiality !== "SUPPORTING_NON_MATERIAL");
  const materialFactIds = new Set(materialFacts.map(f => f.id));
  const materialSelectionMatches = factBreakdowns.filter(
    f => materialFactIds.has(f.factId) && (f.status === "RECOVERED_TYPED" || f.status === "RECOVERED_SELECTION_ONLY")
  ).length;
  const materialTypedMatches = factBreakdowns.filter(
    f => materialFactIds.has(f.factId) && f.status === "RECOVERED_TYPED"
  ).length;

  const materialCount = materialFacts.length > 0 ? materialFacts.length : refFacts.length;
  const certSelectionMatches = materialFacts.length > 0 ? materialSelectionMatches : selectionMatches;
  const certTypedMatches = materialFacts.length > 0 ? materialTypedMatches : typedMatches;

  return {
    documentId: docId,
    partition,
    architecture,
    rawDocLength,
    totalReferenceFacts: refFacts.length,
    selectionMatches,
    typedMatches,
    selectionRecall: materialCount > 0 ? certSelectionMatches / materialCount : 0,
    typedRecall: materialCount > 0 ? certTypedMatches / materialCount : 0,
    materialSelectedCount: materialFacts.length,
    materialSelectedTypedMatches: materialTypedMatches,
    materialSelectedTypedRecall: materialFacts.length > 0 ? materialTypedMatches / materialFacts.length : 0,
    exhaustiveFactCount: refFacts.length,
    exhaustiveTypedRecall: refFacts.length > 0 ? typedMatches / refFacts.length : 0,
    factBreakdowns,
    highRiskBreakdown: {
      observedFalseAffirmatives,
      emittedOnNegatedReferenceWithoutPolarity,
      subjectApplicabilityErrors,
      unconditionalFromConditional,
      recoveredHighRiskFacts,
      missedHighRiskFacts,
      couldNotRepresentPolarityHighRiskFacts
    },
    totalAssertionsEmitted: assertions.length,
    silentDimensionsCount,
    silentDimensionsCapturedCount,
    retainedAtomsCount: options?.retainedCount,
    rejectedAtomsCount: options?.rejectedCount,
    unmappedConcepts,
    latencyMs: options?.latencyMs,
    costUsd: options?.costUsd
  };
}

// ============================================================================
// 5. Candidate Evaluation Engine
// ============================================================================

function normalizeString(val: string | null | undefined): string {
  if (!val) return "";
  return val.trim().toLowerCase().replace(/\s+/g, " ");
}

export function evaluateCandidateDocument(
  docId: string,
  architecture: string,
  rawSourceText: string,
  refFacts: CandidateReferenceFact[],
  claims: CandidateExtractedClaim[]
): CandidateEvaluationResult {
  let refRecallCount = 0;
  let typedRecallCount = 0;
  let evidenceClassMatches = 0;
  let metricRetentionCount = 0;
  let employerBindingMatches = 0;
  let chronologyBindingMatches = 0;
  let totalMetricsInReference = 0;
  let totalEmployersInReference = 0;
  let totalWorkHistoryInReference = 0;
  let selfSummaryPromotionCount = 0;
  let crossPositionContaminationCount = 0;
  let crossDocumentContaminationCount = 0;

  // 1. Reference Matching & Fidelity
  for (const rf of refFacts) {
    if (rf.metrics && rf.metrics.length > 0) totalMetricsInReference += rf.metrics.length;
    else if (rf.metric) totalMetricsInReference++;
    if (rf.employer) totalEmployersInReference++;
    if (rf.evidenceClass === "WORK_HISTORY" && (rf.employer || rf.title)) totalWorkHistoryInReference++;

    // Find claim covering this reference fact via source range / span containment
    const matchingClaim = claims.find(c => {
      // 1. Grounded source ranges / span containment (preferred)
      if (
        typeof c.startOffset === "number" &&
        typeof c.endOffset === "number" &&
        typeof rf.startOffset === "number" &&
        typeof rf.endOffset === "number"
      ) {
        const cInsideRf = c.startOffset >= rf.startOffset && c.endOffset <= rf.endOffset;
        const rfInsideC = rf.startOffset >= c.startOffset && rf.endOffset <= c.endOffset;
        if (cInsideRf || rfInsideC) {
          return true;
        }
        const overlap = Math.max(0, Math.min(c.endOffset, rf.endOffset) - Math.max(c.startOffset, rf.startOffset));
        const minLen = Math.min(c.endOffset - c.startOffset, rf.endOffset - rf.startOffset);
        if (minLen > 0 && overlap / minLen >= 0.8) {
          return true;
        }
        return false;
      }
      // 2. Exact span ID match
      if (rf.spanId && c.spanId && c.spanId === rf.spanId) {
        return true;
      }
      // 3. Exact normalized string equality (only if offsets unavailable)
      if (rf.exactText && c.exactText && normalizeString(rf.exactText) === normalizeString(c.exactText)) {
        return true;
      }
      return false;
    });

    if (matchingClaim) {
      refRecallCount++;

      // Typed recall (canonical proofTypes array match - exact equality)
      const cTypes: string[] = Array.isArray(matchingClaim.proofTypes)
        ? matchingClaim.proofTypes.map(t => String(t).toUpperCase())
        : matchingClaim.proofType
          ? [String(matchingClaim.proofType).toUpperCase()]
          : [];
      const rfTypes: string[] = Array.isArray(rf.proofTypes) && rf.proofTypes.length > 0
        ? rf.proofTypes.map(t => String(t).toUpperCase())
        : rf.proofType
          ? [String(rf.proofType).toUpperCase()]
          : [];
      if (rfTypes.some(rt => cTypes.some(ct => ct === rt))) {
        typedRecallCount++;
      }

      // Evidence class accuracy
      if (matchingClaim.evidenceClass === rf.evidenceClass) {
        evidenceClassMatches++;
      } else if (rf.evidenceClass === "SELF_SUMMARY" && matchingClaim.evidenceClass === "WORK_HISTORY") {
        selfSummaryPromotionCount++;
      }

      // Metric retention: Require canonical StructuredMetric schema matching
      if (rf.metrics && rf.metrics.length > 0) {
        for (const rm of rf.metrics) {
          const claimMetrics = Array.isArray(matchingClaim.metrics) ? matchingClaim.metrics : [];
          let metricMatched = false;
          for (const cm of claimMetrics) {
            if (typeof cm === "object" && cm !== null) {
              const typeMatch = cm.metricType === rm.metricType;
              const valMatch = typeof cm.normalizedValue === "number" &&
                Math.abs(cm.normalizedValue - rm.normalizedValue) < 1e-6;
              const unitMatch = (!rm.unit && !cm.unit) || (Boolean(rm.unit) && Boolean(cm.unit) && cm.unit!.trim().toLowerCase() === rm.unit!.trim().toLowerCase());
              const currMatch = (!rm.currency && !cm.currency) || (Boolean(rm.currency) && Boolean(cm.currency) && cm.currency === rm.currency);
              const compMatch = (!rm.comparator && !cm.comparator) || (Boolean(rm.comparator) && Boolean(cm.comparator) && cm.comparator === rm.comparator);
              if (typeMatch && valMatch && unitMatch && currMatch && compMatch) {
                metricMatched = true;
                break;
              }
            }
          }
          if (metricMatched) {
            metricRetentionCount++;
          }
        }
      } else if (rf.metric) {
        const claimMetrics = Array.isArray(matchingClaim.metrics) ? matchingClaim.metrics : [];
        const hasMetric = claimMetrics.some(cm => {
          if (typeof cm === "string") return cm.trim() === rf.metric!.trim();
          if (typeof cm === "object" && cm !== null) return cm.exactText === rf.metric || cm.rawValue === rf.metric;
          return false;
        });
        if (hasMetric) {
          metricRetentionCount++;
        }
      }

      // Chronology & Position Binding for WORK_HISTORY (Gate 9)
      // Comparison requires normalized exact equality: trim, lowercase, collapse whitespace. NO substring includes!
      if (rf.evidenceClass === "WORK_HISTORY" && (rf.employer || rf.title)) {
        let employerMatch = false;
        if (rf.employer && matchingClaim.employer) {
          employerMatch = normalizeString(matchingClaim.employer) === normalizeString(rf.employer);
        } else if (!rf.employer) {
          employerMatch = true;
        }

        let titleMatch = false;
        if (rf.title && matchingClaim.title) {
          titleMatch = normalizeString(matchingClaim.title) === normalizeString(rf.title);
        } else if (!rf.title) {
          titleMatch = true;
        }

        let isCurrentMatch = true;
        if (typeof rf.isCurrent === "boolean") {
          isCurrentMatch = matchingClaim.isCurrent === rf.isCurrent;
        }

        let startDateMatch = true;
        if (rf.startDate) {
          startDateMatch = normalizeString(matchingClaim.startDate) === normalizeString(rf.startDate);
        } else if (rf.dates) {
          startDateMatch = normalizeString(matchingClaim.dates || matchingClaim.startDate) === normalizeString(rf.dates);
        }

        let endDateMatch = true;
        if (rf.endDate !== undefined) {
          endDateMatch = normalizeString(matchingClaim.endDate) === normalizeString(rf.endDate);
        }

        if (employerMatch && titleMatch && isCurrentMatch && startDateMatch && endDateMatch) {
          chronologyBindingMatches++;
        }
      }

      // Employer binding (secondary diagnostic)
      if (rf.employer) {
        if (matchingClaim.employer && normalizeString(matchingClaim.employer) === normalizeString(rf.employer)) {
          employerBindingMatches++;
        } else if (matchingClaim.employer && normalizeString(matchingClaim.employer) !== normalizeString(rf.employer)) {
          crossPositionContaminationCount++;
        }
      }
    }
  }

  // 2. Mechanical Verification of Candidate Source Offsets (Literal 100% Provenance)
  let offsetVerificationCount = 0;
  let offsetVerificationFailures = 0;

  for (const c of claims) {
    if (c.sourceDocumentId && c.sourceDocumentId !== docId) {
      crossDocumentContaminationCount++;
    }

    offsetVerificationCount++;
    if (typeof c.startOffset !== "number" || typeof c.endOffset !== "number") {
      offsetVerificationFailures++;
    } else if (
      c.startOffset < 0 ||
      c.endOffset > rawSourceText.length ||
      c.startOffset >= c.endOffset
    ) {
      offsetVerificationFailures++;
    } else {
      const slice = rawSourceText.slice(c.startOffset, c.endOffset);
      if (slice !== (c.exactText ?? "")) {
        offsetVerificationFailures++;
      }
    }
  }

  const totalEmitted = claims.length;
  const proofPrecision = totalEmitted > 0 ? Math.min(1.0, refRecallCount / totalEmitted) : 0;
  const offsetAccuracyRate =
    offsetVerificationCount > 0
      ? (offsetVerificationCount - offsetVerificationFailures) / offsetVerificationCount
      : 1.0;
  const chronologyBindingAccuracy =
    totalWorkHistoryInReference > 0 ? chronologyBindingMatches / totalWorkHistoryInReference : 1.0;

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
    chronologyBindingMatches,
    totalWorkHistoryInReference,
    chronologyBindingAccuracy,
    offsetVerificationCount,
    offsetVerificationFailures,
    offsetAccuracyRate,
    selfSummaryPromotionCount,
    crossPositionContaminationCount,
    crossDocumentContaminationCount,
    totalClaimsEmitted: totalEmitted,
    proofPrecision
  };
}

// ============================================================================
// 6. Aggregate Batch 06 Certification Scoring
// ============================================================================

export function scoreBatch06CertificationRun(
  roleResults: RoleDocumentEvaluationResult[],
  candidateResults: CandidateEvaluationResult[],
  options?: {
    customGates?: Partial<PreRegisteredGates>;
  }
): Batch06CertificationSummary {
  const gates: PreRegisteredGates = {
    ...DEFAULT_BATCH06_GATES,
    ...(options?.customGates ?? {})
  };

  // 1. Compute Aggregate Role Metrics
  const totalRoleDocs = roleResults.length;
  let totalRoleRefFacts = 0;
  let totalRoleTypedMatches = 0;
  let totalExhaustiveRoleRefFacts = 0;
  let totalExhaustiveRoleTypedMatches = 0;
  let totalHighRiskFalseAffirmatives = 0;
  let totalPolarityInversions = 0;
  let totalApplicabilityLeaks = 0;

  let longDocRefFacts = 0;
  let longDocTypedMatches = 0;

  let docSilentTotal = 0;
  let docSilentCaptured = 0;
  const latencies: number[] = [];
  let totalCost = 0;
  let costCount = 0;

  for (const r of roleResults) {
    const roleMatCount = r.materialSelectedCount !== undefined && r.materialSelectedCount > 0 ? r.materialSelectedCount : r.totalReferenceFacts;
    const roleMatTypedMatches = r.materialSelectedTypedMatches !== undefined && r.materialSelectedCount && r.materialSelectedCount > 0 ? r.materialSelectedTypedMatches : r.typedMatches;
    totalRoleRefFacts += roleMatCount;
    totalRoleTypedMatches += roleMatTypedMatches;
    totalExhaustiveRoleRefFacts += r.totalReferenceFacts;
    totalExhaustiveRoleTypedMatches += r.typedMatches;
    totalHighRiskFalseAffirmatives += r.highRiskBreakdown.observedFalseAffirmatives;
    totalPolarityInversions += r.factBreakdowns.filter(f => f.polarityStatus === "WRONG_POLARITY").length;
    totalApplicabilityLeaks += r.highRiskBreakdown.subjectApplicabilityErrors;
    if (typeof r.silentDimensionsCount === "number") docSilentTotal += r.silentDimensionsCount;
    if (typeof r.silentDimensionsCapturedCount === "number") docSilentCaptured += r.silentDimensionsCapturedCount;

    if (r.rawDocLength > 20000) {
      longDocRefFacts += roleMatCount;
      longDocTypedMatches += roleMatTypedMatches;
    }

    if (typeof r.latencyMs === "number") latencies.push(r.latencyMs);
    if (typeof r.costUsd === "number") {
      totalCost += r.costUsd;
      costCount++;
    }
  }

  const overallTypedRecall = totalRoleRefFacts > 0 ? totalRoleTypedMatches / totalRoleRefFacts : 0;
  const longDocTypedRecall = longDocRefFacts > 0 ? longDocTypedMatches / longDocRefFacts : 0;
  const exhaustiveTypedRecall = totalExhaustiveRoleRefFacts > 0 ? totalExhaustiveRoleTypedMatches / totalExhaustiveRoleRefFacts : 0;

  // P95 Latency
  latencies.sort((a, b) => a - b);
  const p95Index = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95));
  const p95LatencyMs = latencies.length > 0 ? latencies[p95Index] : 0;
  const averageCostPerDocUsd = costCount > 0 ? totalCost / costCount : 0;

  // Insufficient-Evidence Capture Rate (Gate 7 strictly derived from document-level aggregations)
  const silentTotal = docSilentTotal;
  const silentCaptured = docSilentCaptured;
  const insufficientEvidenceCaptureRate = silentTotal > 0 ? silentCaptured / silentTotal : 1.0;

  // 2. Compute Aggregate Candidate Metrics
  const totalCandidateDocs = candidateResults.length;
  let totalCandidateMetricsInRef = 0;
  let totalCandidateMetricsRetained = 0;
  let totalCandidateEmployersInRef = 0;
  let totalCandidateEmployersBound = 0;
  let totalWorkHistoryInRef = 0;
  let totalChronologyBound = 0;
  let totalOffsetChecks = 0;
  let totalOffsetFailures = 0;

  for (const c of candidateResults) {
    totalCandidateMetricsInRef += c.totalMetricsInReference;
    totalCandidateMetricsRetained += c.metricRetentionCount;
    totalCandidateEmployersInRef += c.totalEmployersInReference;
    totalCandidateEmployersBound += c.employerBindingMatches;
    totalWorkHistoryInRef += c.totalWorkHistoryInReference ?? c.totalEmployersInReference;
    totalChronologyBound += c.chronologyBindingMatches ?? c.employerBindingMatches;
    totalOffsetChecks += c.offsetVerificationCount;
    totalOffsetFailures += c.offsetVerificationFailures;
  }

  const candidateMetricFidelity =
    totalCandidateMetricsInRef > 0 ? totalCandidateMetricsRetained / totalCandidateMetricsInRef : 1.0;
  const candidateEmployerBinding =
    totalCandidateEmployersInRef > 0 ? totalCandidateEmployersBound / totalCandidateEmployersInRef : 1.0;
  const candidateChronologyBinding =
    totalWorkHistoryInRef > 0 ? totalChronologyBound / totalWorkHistoryInRef : 1.0;
  const candidateSpanProvenanceAccuracy =
    totalOffsetChecks > 0 ? (totalOffsetChecks - totalOffsetFailures) / totalOffsetChecks : 1.0;

  // 3. Evaluate Gates
  const gateDetails: GateEvaluationDetail[] = [];
  let fatalFailuresCount = 0;
  let deficitFailuresCount = 0;
  let tunableFailuresCount = 0;

  function evaluateGate(
    metricName: string,
    targetValue: string,
    observedValue: string,
    passed: boolean,
    failureClassIfFailed: FailureClassification,
    failureReason?: string
  ) {
    let classification: FailureClassification = "NONE";
    if (!passed) {
      classification = failureClassIfFailed;
      if (failureClassIfFailed === "FATAL_SAFETY_FAILURE") fatalFailuresCount++;
      else if (failureClassIfFailed === "FATAL_DEFICIT_FAILURE") deficitFailuresCount++;
      else if (failureClassIfFailed === "IMPLEMENTATION_TUNABLE") tunableFailuresCount++;
    }
    gateDetails.push({
      metricName,
      targetValue,
      observedValue,
      passed,
      classification,
      failureReason: passed ? undefined : failureReason
    });
  }

  // Gate 1: High-Risk False Affirmatives
  evaluateGate(
    "High-Risk False Affirmatives",
    `<= ${gates.highRiskFalseAffirmativesMax}`,
    `${totalHighRiskFalseAffirmatives}`,
    totalHighRiskFalseAffirmatives <= gates.highRiskFalseAffirmativesMax,
    "FATAL_SAFETY_FAILURE",
    "High-risk false affirmative asserted over negated, disclaimed, or forbidden boundary"
  );

  // Gate 2: Polarity Inversions
  evaluateGate(
    "Polarity Inversions (Negated -> Affirmed)",
    `<= ${gates.polarityInversionsMax}`,
    `${totalPolarityInversions}`,
    totalPolarityInversions <= gates.polarityInversionsMax,
    "FATAL_SAFETY_FAILURE",
    "Negated proposition materialized as affirmed authority"
  );

  // Gate 3: Applicability Boundary Leaks
  evaluateGate(
    "Applicability Leaks (Requirement/Company -> Role)",
    `<= ${gates.applicabilityBoundaryLeaksMax}`,
    `${totalApplicabilityLeaks}`,
    totalApplicabilityLeaks <= gates.applicabilityBoundaryLeaksMax,
    "FATAL_SAFETY_FAILURE",
    "Candidate requirement or company context asserted as role authority"
  );

  // Gate 4: Candidate Span Mechanical Provenance
  const candidateSpanPassed =
    totalOffsetChecks === 0 || candidateSpanProvenanceAccuracy >= gates.candidateSpanProvenanceMin;
  evaluateGate(
    "Candidate Span Provenance Accuracy",
    `= ${(gates.candidateSpanProvenanceMin * 100).toFixed(1)}%`,
    totalOffsetChecks === 0
      ? "N/A (No candidate offsets checked)"
      : `${(candidateSpanProvenanceAccuracy * 100).toFixed(1)}%`,
    candidateSpanPassed,
    "FATAL_SAFETY_FAILURE",
    "Candidate offset span did not match source text slice exactly (hallucinated span)"
  );

  // Gate 5: Overall Typed Recall
  evaluateGate(
    "Overall Typed Recall",
    `>= ${(gates.typedRecallMin * 100).toFixed(1)}%`,
    `${(overallTypedRecall * 100).toFixed(1)}%`,
    totalRoleRefFacts === 0 || overallTypedRecall >= gates.typedRecallMin,
    overallTypedRecall < 0.40 ? "FATAL_DEFICIT_FAILURE" : "IMPLEMENTATION_TUNABLE",
    overallTypedRecall < 0.40
      ? "Recall Catastrophe: Typed recall collapsed below 40.0%"
      : "Marginal recall deficit: between 40.0% and 50.0%"
  );

  // Gate 6: Long-Document Typed Recall (>20k chars)
  const longDocPassed = longDocRefFacts === 0 || longDocTypedRecall >= gates.longDocTypedRecallMin;
  evaluateGate(
    "Long-Document Typed Recall (>20k chars)",
    `>= ${(gates.longDocTypedRecallMin * 100).toFixed(1)}%`,
    longDocRefFacts === 0 ? "N/A (No docs >20k chars)" : `${(longDocTypedRecall * 100).toFixed(1)}%`,
    longDocPassed,
    "FATAL_DEFICIT_FAILURE",
    "Long-document truncation: Recall collapsed below 25.0% on documents >20k chars"
  );

  // Gate 7: Insufficient-Evidence Capture Rate
  const silentPassed = silentTotal === 0 || insufficientEvidenceCaptureRate >= gates.insufficientEvidenceCaptureMin;
  evaluateGate(
    "Insufficient-Evidence Capture Rate",
    `>= ${(gates.insufficientEvidenceCaptureMin * 100).toFixed(1)}%`,
    silentTotal === 0 ? "N/A (No silent dimensions)" : `${(insufficientEvidenceCaptureRate * 100).toFixed(1)}%`,
    silentPassed,
    "IMPLEMENTATION_TUNABLE",
    "Insufficient-evidence slump: below 90.0% capture of silent dimensions"
  );

  // Gate 8: Candidate Metric Token Fidelity
  const candidateMetricPassed =
    totalCandidateMetricsInRef === 0 || candidateMetricFidelity >= gates.candidateMetricFidelityMin;
  evaluateGate(
    "Candidate Metric Fidelity",
    `>= ${(gates.candidateMetricFidelityMin * 100).toFixed(1)}%`,
    totalCandidateMetricsInRef === 0 ? "N/A (No ref metrics)" : `${(candidateMetricFidelity * 100).toFixed(1)}%`,
    candidateMetricPassed,
    candidateMetricFidelity < 0.80 ? "FATAL_DEFICIT_FAILURE" : "IMPLEMENTATION_TUNABLE",
    candidateMetricFidelity < 0.80
      ? "Candidate integrity collapse: Metric fidelity fell below 80.0%"
      : "Marginal candidate metric variance: between 80.0% and 90.0%"
  );

  // Gate 9: Candidate Chronology Binding (Employer + Title + Tenure)
  const candidateChronologyPassed =
    totalWorkHistoryInRef === 0 || candidateChronologyBinding >= gates.candidateChronologyBindingMin;
  evaluateGate(
    "Candidate Chronology Binding (Employer + Title + Tenure)",
    `>= ${(gates.candidateChronologyBindingMin * 100).toFixed(1)}%`,
    totalWorkHistoryInRef === 0
      ? "N/A (No ref work history)"
      : `${(candidateChronologyBinding * 100).toFixed(1)}%`,
    candidateChronologyPassed,
    candidateChronologyBinding < 0.80 ? "FATAL_DEFICIT_FAILURE" : "IMPLEMENTATION_TUNABLE",
    candidateChronologyBinding < 0.80
      ? "Candidate integrity collapse: Chronology binding fell below 80.0%"
      : "Marginal candidate chronology binding variance: between 80.0% and 90.0%"
  );

  // Gate 10: Ingestion Latency (P95)
  evaluateGate(
    "Ingestion P95 Latency",
    `<= ${(gates.p95LatencyMsMax / 1000).toFixed(1)}s`,
    `${(p95LatencyMs / 1000).toFixed(1)}s`,
    latencies.length === 0 || p95LatencyMs <= gates.p95LatencyMsMax,
    "IMPLEMENTATION_TUNABLE",
    "Operational budget exceeded: P95 latency exceeded 15.0s"
  );

  // Gate 11: Ingestion Cost per Document
  evaluateGate(
    "Cost per Document",
    `<= $${gates.costPerDocUsdMax.toFixed(2)}`,
    `$${averageCostPerDocUsd.toFixed(4)}`,
    costCount === 0 || averageCostPerDocUsd <= gates.costPerDocUsdMax,
    "IMPLEMENTATION_TUNABLE",
    "Operational budget exceeded: Cost per document exceeded $0.04"
  );

  // Determine Overall Verdict
  let verdict: Batch06CertificationSummary["verdict"] = "PASS";
  let summary = "All pre-registered certification gates satisfied.";

  if (fatalFailuresCount > 0 || deficitFailuresCount > 0) {
    verdict = "FATAL_FAILURE";
    summary = `Certification failed: ${fatalFailuresCount} fatal safety failure(s) and ${deficitFailuresCount} fatal deficit failure(s). Shadow mode blocked. Architecture review mandatory.`;
  } else if (tunableFailuresCount > 0) {
    verdict = "REMEDIATION_REQUIRED";
    summary = `Remediation required: ${tunableFailuresCount} tunable failure(s) detected. Single remediation cycle permitted on pre-frozen secondary holdout set.`;
  }

  return {
    verdict,
    summary,
    fatalFailuresCount,
    deficitFailuresCount,
    tunableFailuresCount,
    gateDetails,
    aggregateMetrics: {
      totalRoleDocs,
      totalCandidateDocs,
      overallTypedRecall,
      materialSelectedRecall: overallTypedRecall,
      exhaustiveTypedRecall,
      longDocTypedRecall,
      insufficientEvidenceCaptureRate,
      totalHighRiskFalseAffirmatives,
      totalPolarityInversions,
      totalApplicabilityLeaks,
      candidateSpanProvenanceAccuracy,
      candidateMetricFidelity,
      candidateEmployerBinding,
      candidateChronologyBinding,
      p95LatencyMs,
      averageCostPerDocUsd
    }
  };
}
