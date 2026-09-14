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
  architecture: "ARCH_A" | "ARCH_B" | "ARCH_C" | "ARCH_D";
  sourceEvidence: string[];
  canonicalTypes: string[];
  appliesTo: "ROLE" | "CANDIDATE_REQUIREMENT" | "CANDIDATE_PREFERENCE" | "COMPANY" | "RECRUITING_PROCESS" | "REPRESENTATION_UNAVAILABLE";
  polarity: "AFFIRMED" | "NEGATED" | "CONDITIONAL" | "REPRESENTATION_UNAVAILABLE";
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

export interface HighRiskScoringBreakdown {
  observedFalseAffirmatives: number; // Emitted affirmative assertion directly contradicting negative reference or highRiskNegative
  emittedOnNegatedReferenceWithoutPolarity: number; // Fact emitted on negated span when polarity is UNREPRESENTABLE
  subjectApplicabilityErrors: number; // Candidate requirement or company context asserted as role authority
  unconditionalFromConditional: number; // Conditional fact emitted unconditionally
  recoveredHighRiskFacts: number;
  missedHighRiskFacts: number;
  couldNotRepresentPolarityHighRiskFacts: number;
}

export interface DocumentR2EvaluationResult {
  documentId: string;
  partition: string;
  architecture: string;
  totalReferenceFacts: number;
  selectionMatches: number;
  typedMatches: number;
  selectionRecall: number;
  typedRecall: number;
  factBreakdowns: FactFailureClassification[];
  highRiskBreakdown: HighRiskScoringBreakdown;
  totalAssertionsEmitted: number;
  retainedAtomsCount?: number;
  rejectedAtomsCount?: number;
  unmappedConcepts: string[];
}

// -------------------------------------------------------------
// Reference Truth Normalizer
// -------------------------------------------------------------

export function normalizeReferenceTruthR2(rawFixture: any): NormalizedReferenceFact[] {
  const norm: NormalizedReferenceFact[] = [];
  const docId = rawFixture.documentId ?? rawFixture.id;

  if (Array.isArray(rawFixture.materialFacts)) {
    for (const f of rawFixture.materialFacts) {
      let spans: string[] = [];
      if (Array.isArray(f.keySpanIds)) spans = [...f.keySpanIds];
      else if (f.spanId) spans = [f.spanId];

      let types: string[] = [];
      if (Array.isArray(f.canonicalTypes)) types = [...f.canonicalTypes];
      else if (f.semanticType) types = [f.semanticType];

      let appliesTo: NormalizedReferenceFact["appliesTo"] = "ROLE";
      if (f.appliesTo) appliesTo = f.appliesTo;
      else if (f.subject === "COMPANY") appliesTo = "COMPANY";
      else if (f.subject === "CANDIDATE") appliesTo = "CANDIDATE_REQUIREMENT";
      else if (f.subject === "RECRUITING_PROCESS" || f.subject === "PROCESS") appliesTo = "RECRUITING_PROCESS";

      let hrFamily: string | null = null;
      if (f.highRiskFamily) hrFamily = f.highRiskFamily;
      else if (types.some(t => (HIGH_RISK_FAMILIES as readonly string[]).includes(t))) {
        hrFamily = types.find(t => (HIGH_RISK_FAMILIES as readonly string[]).includes(t))!;
      }

      norm.push({
        id: f.id,
        documentId: docId,
        sourceEvidence: spans,
        canonicalTypes: types,
        appliesTo,
        polarity: f.polarity ?? "AFFIRMED",
        highRiskFamily: hrFamily,
        propositionText: f.proposition ?? f.exactText ?? f.context ?? ""
      });
    }
  }

  return norm;
}

// -------------------------------------------------------------
// Adapters for All Architectures
// -------------------------------------------------------------

export function adaptArchitectureAR2(docId: string, v1OutputJson: any, segmentedUnits: any[]): CommonAssertion[] {
  const atoms = v1OutputJson.atoms ?? [];
  const assertions: CommonAssertion[] = [];

  for (const a of atoms) {
    const overlappingUnits = segmentedUnits.filter((u: any) => {
      return Math.max(a.startOffset, u.startOffset) < Math.min(a.endOffset, u.endOffset);
    });

    const sourceEvidence = overlappingUnits.map((u: any) => u.spanId);
    let appliesTo: CommonAssertion["appliesTo"] = "ROLE";
    if (a.subject === "COMPANY") appliesTo = "COMPANY";
    else if (a.subject === "RECRUITING_PROCESS") appliesTo = "RECRUITING_PROCESS";

    assertions.push({
      id: a.id,
      documentId: docId,
      architecture: "ARCH_A",
      sourceEvidence,
      canonicalTypes: a.semanticType ? [a.semanticType] : [],
      appliesTo,
      polarity: "REPRESENTATION_UNAVAILABLE", // V1 has no explicit polarity channel
      exactText: a.exactText,
      confidence: a.confidence ?? 1.0
    });
  }

  return assertions;
}

export function adaptArchitectureBR2(docId: string, resolvedJson: any): CommonAssertion[] {
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

    // Preserve actual subject from Architecture B schema
    let appliesTo: CommonAssertion["appliesTo"] = "ROLE";
    if (a.subject === "COMPANY") appliesTo = "COMPANY";
    else if (a.subject === "RECRUITING_PROCESS") appliesTo = "RECRUITING_PROCESS";
    else appliesTo = "ROLE";

    // Architecture B has NO explicit polarity channel in its schema
    assertions.push({
      documentId: docId,
      architecture: "ARCH_B",
      sourceEvidence,
      canonicalTypes: a.semanticType ? [a.semanticType] : [],
      appliesTo,
      polarity: "REPRESENTATION_UNAVAILABLE", // Formally marked UNAVAILABLE per Section 2
      exactText: a.exactText,
      confidence: a.confidence ?? 1.0
    });
  }

  return assertions;
}

export function adaptArchitectureCR2(docId: string, resolvedJson: any): CommonAssertion[] {
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
// Architecture D (Hybrid Feasibility Engine)
// -------------------------------------------------------------

export interface HybridAdmissionResult {
  admittedAssertions: CommonAssertion[];
  retainedAtomsCount: number;
  rejectedPropositionsCount: number;
  rejectionReasons: { index: number; reason: string }[];
}

export function applyHybridStructuralAdmission(
  docId: string,
  rawPropositions: any[],
  validUnitIds: Set<string>
): HybridAdmissionResult {
  const admittedAssertions: CommonAssertion[] = [];
  const rejectionReasons: { index: number; reason: string }[] = [];

  for (let i = 0; i < rawPropositions.length; i++) {
    const p = rawPropositions[i];

    // Rule 1: Source IDs must resolve in unitMap
    if (!Array.isArray(p.sourceEvidence) || p.sourceEvidence.length === 0) {
      rejectionReasons.push({ index: i, reason: "NO_SOURCE_EVIDENCE" });
      continue;
    }
    const unresolvable = p.sourceEvidence.filter((id: string) => !validUnitIds.has(id));
    if (unresolvable.length > 0) {
      rejectionReasons.push({ index: i, reason: `UNRESOLVED_SPANS: ${unresolvable.join(",")}` });
      continue;
    }

    // Rule 2: NEGATED propositions cannot materialize as affirmative canonical facts
    if (p.polarity === "NEGATED") {
      rejectionReasons.push({ index: i, reason: "NEGATED_PROPOSITION_RETAINED_AS_BOUNDARY_ONLY" });
      continue;
    }

    // Rule 3: Subject / Applicability Boundary Discipline
    let effectiveAppliesTo: CommonAssertion["appliesTo"] = p.appliesTo ?? "ROLE";
    let effectiveTypes = Array.isArray(p.canonicalTypes) ? [...p.canonicalTypes] : [];

    if (effectiveAppliesTo === "CANDIDATE_REQUIREMENT") {
      // Cannot be admitted as ROLE authority. Must project solely as HARD_REQUIREMENT
      effectiveTypes = effectiveTypes.filter(t => !(HIGH_RISK_FAMILIES as readonly string[]).includes(t));
      if (!effectiveTypes.includes("HARD_REQUIREMENT")) effectiveTypes.push("HARD_REQUIREMENT");
    } else if (effectiveAppliesTo === "CANDIDATE_PREFERENCE") {
      effectiveTypes = effectiveTypes.filter(t => !(HIGH_RISK_FAMILIES as readonly string[]).includes(t));
      if (!effectiveTypes.includes("PREFERRED_REQUIREMENT")) effectiveTypes.push("PREFERRED_REQUIREMENT");
    } else if (effectiveAppliesTo === "COMPANY") {
      // Company context cannot project as ROLE authority
      effectiveTypes = effectiveTypes.filter(t => !(HIGH_RISK_FAMILIES as readonly string[]).includes(t));
      if (!effectiveTypes.includes("COMPANY_CONTEXT")) effectiveTypes.push("COMPANY_CONTEXT");
    } else if (effectiveAppliesTo === "RECRUITING_PROCESS") {
      // Recruiting process cannot project as ROLE authority
      effectiveTypes = effectiveTypes.filter(t => !(HIGH_RISK_FAMILIES as readonly string[]).includes(t));
    }

    if (effectiveTypes.length === 0) {
      rejectionReasons.push({ index: i, reason: "NO_VALID_CANONICAL_TYPES_AFTER_BOUNDARY_GUARD" });
      continue;
    }

    // Rule 4: CONDITIONAL propositions must retain condition and cannot project unconditional authority
    let effectivePolarity: CommonAssertion["polarity"] = p.polarity ?? "AFFIRMED";
    let effectiveCondition = p.conditionDescription;

    if (effectivePolarity === "CONDITIONAL" && (!effectiveCondition || effectiveCondition.trim() === "")) {
      // Without explicit condition description, cannot admit as unconditional authority
      rejectionReasons.push({ index: i, reason: "CONDITIONAL_WITHOUT_CONDITION_DESCRIPTION" });
      continue;
    }

    admittedAssertions.push({
      id: p.id,
      documentId: docId,
      architecture: "ARCH_D",
      sourceEvidence: p.sourceEvidence,
      canonicalTypes: effectiveTypes,
      appliesTo: effectiveAppliesTo,
      polarity: effectivePolarity,
      condition: effectiveCondition,
      interpretation: p.proposition,
      exactText: p.proposition,
      confidence: p.confidence ?? 1.0
    });
  }

  return {
    admittedAssertions,
    retainedAtomsCount: admittedAssertions.length,
    rejectedPropositionsCount: rejectionReasons.length,
    rejectionReasons
  };
}

// -------------------------------------------------------------
// Text Similarity Helper
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
// Core Document Evaluator for R2
// -------------------------------------------------------------

export function evaluateDocumentR2(
  docId: string,
  partition: string,
  architecture: string,
  refFacts: NormalizedReferenceFact[],
  highRiskNegatives: string[],
  disclaimerSpans: string[],
  assertions: CommonAssertion[],
  retainedCount?: number,
  rejectedCount?: number
): DocumentR2EvaluationResult {
  let selectionMatches = 0;
  let typedMatches = 0;
  const factBreakdowns: FactFailureClassification[] = [];
  const unmappedConcepts: string[] = [];

  // Evaluate Reference Facts
  for (const rf of refFacts) {
    const isHr = rf.highRiskFamily !== null || rf.canonicalTypes.some(t => (HIGH_RISK_FAMILIES as readonly string[]).includes(t));

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
    const typedAssertion = matchingAssertions.find(a => a.canonicalTypes.some(t => rf.canonicalTypes.includes(t)));
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

    // Evaluate applicability
    let appStatus: FactFailureClassification["applicabilityStatus"] = "APPLICABILITY_MATCH";
    if (typedAssertion.appliesTo === "REPRESENTATION_UNAVAILABLE") {
      appStatus = "APPLICABILITY_UNREPRESENTABLE";
    } else if (typedAssertion.appliesTo !== rf.appliesTo) {
      appStatus = "WRONG_APPLICABILITY";
    }

    // Evaluate polarity
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

  // Evaluate High-Risk Breakdown across emitted assertions
  let observedFalseAffirmatives = 0;
  let emittedOnNegatedReferenceWithoutPolarity = 0;
  let subjectApplicabilityErrors = 0;
  let unconditionalFromConditional = 0;

  for (const a of assertions) {
    const isHrAssertion = a.canonicalTypes.some(t => (HIGH_RISK_FAMILIES as readonly string[]).includes(t));

    // A. Check against reference facts covering the same span
    const refOnSameSpan = refFacts.filter(rf => rf.sourceEvidence.some(s => a.sourceEvidence.includes(s)));

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
  const missedHighRiskFacts = hrFacts.filter(f => f.status === "MISSED_ASSERTION" || f.status === "WRONG_TYPE").length;
  const couldNotRepresentPolarityHighRiskFacts = hrFacts.filter(f => f.polarityStatus === "POLARITY_UNREPRESENTABLE").length;

  return {
    documentId: docId,
    partition,
    architecture,
    totalReferenceFacts: refFacts.length,
    selectionMatches,
    typedMatches,
    selectionRecall: refFacts.length > 0 ? selectionMatches / refFacts.length : 0,
    typedRecall: refFacts.length > 0 ? typedMatches / refFacts.length : 0,
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
    retainedAtomsCount: retainedCount,
    rejectedAtomsCount: rejectedCount,
    unmappedConcepts
  };
}
