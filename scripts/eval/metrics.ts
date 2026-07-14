// Per-case, per-dimension grading. Deterministic, no I/O.
import type { DimensionResult } from "../scraper/types";

export type Tier = "Core" | "Supporting" | "Context";

export interface DimensionGrade {
  key: string;
  importance: Tier;
  goldenStatus: string;
  candidateStatus: string;
  bucketMatch: boolean;
  statusMatch: boolean;
  valueMatch: boolean;
  anchorsValid: boolean;         // every candidate quote is a substring of rawText
  goldenPresent: boolean;        // golden status != Missing (used for recall)
  candidatePresent: boolean;     // candidate status != Missing (used for precision)
  correct: boolean;              // true positive
}

export interface CaseGrade {
  caseId: string;
  role: string;
  company: string;
  dimensions: DimensionGrade[];
}

export interface TierScore {
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
}

export interface Report {
  runAt: string;
  extractorVersion: string;
  mode: string;
  provider: string;
  cases: CaseGrade[];
  perTier: Record<Tier, TierScore>;
  overall: TierScore;
  anchorViolations: number;
  totalDimensions: number;
}

function norm(s: string | null | undefined): string {
  return (s || "").toLowerCase().replace(/[\s\p{P}]+/gu, " ").trim();
}

function gradeDimension(
  golden: DimensionResult,
  candidate: DimensionResult | undefined,
  rawText: string,
): DimensionGrade {
  const g = golden;
  const c = candidate;
  const goldenPresent = g.jdEvidence.status !== "Missing";
  const candidatePresent = !!c && c.jdEvidence.status !== "Missing";
  const bucketMatch = !!c && c.bucket === g.bucket;
  const statusMatch = !!c && c.jdEvidence.status === g.jdEvidence.status;
  const valueMatch = !!c && norm(c.jdEvidence.value) === norm(g.jdEvidence.value);
  const anchorsValid =
    !c || (c.jdEvidence.evidence || []).every((e) => rawText.includes(e.quote));

  // A true positive requires: candidate says something (not Missing),
  // value matches golden, and any anchors that are claimed are real.
  const correct = candidatePresent && goldenPresent && valueMatch && anchorsValid;
  return {
    key: g.key,
    importance: g.importance as Tier,
    goldenStatus: g.jdEvidence.status,
    candidateStatus: c?.jdEvidence.status ?? "Missing",
    bucketMatch,
    statusMatch,
    valueMatch,
    anchorsValid,
    goldenPresent,
    candidatePresent,
    correct,
  };
}

export function gradeCase(
  caseId: string,
  golden: { role: string; company: string; dimensions: DimensionResult[] },
  candidate: { dimensions: DimensionResult[] },
  rawText: string,
): CaseGrade {
  const byKey = new Map(candidate.dimensions.map((d) => [d.key, d] as const));
  return {
    caseId,
    role: golden.role,
    company: golden.company,
    dimensions: golden.dimensions.map((g) => gradeDimension(g, byKey.get(g.key), rawText)),
  };
}

function tierScore(all: DimensionGrade[]): TierScore {
  let tp = 0, fp = 0, fn = 0;
  for (const d of all) {
    if (d.correct) tp++;
    else if (d.candidatePresent && !d.correct) fp++;
    else if (d.goldenPresent && !d.candidatePresent) fn++;
  }
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, tp, fp, fn };
}

export function summarize(
  cases: CaseGrade[],
  meta: Omit<Report, "cases" | "perTier" | "overall" | "anchorViolations" | "totalDimensions">,
): Report {
  const flat = cases.flatMap((c) => c.dimensions);
  const anchorViolations = flat.filter((d) => !d.anchorsValid).length;
  const perTier: Record<Tier, TierScore> = {
    Core: tierScore(flat.filter((d) => d.importance === "Core")),
    Supporting: tierScore(flat.filter((d) => d.importance === "Supporting")),
    Context: tierScore(flat.filter((d) => d.importance === "Context")),
  };
  return {
    ...meta,
    cases,
    perTier,
    overall: tierScore(flat),
    anchorViolations,
    totalDimensions: flat.length,
  };
}
