// Layer 3 — Priority Engine. Pure math from an EvaluationContext.
// No verb, no language, no confidence input.
//
// === TWO-ENGINE DECOUPLED DECISION SCORING ===
// RADAR uses two independent scoring algorithms to evaluate career matches:
// 
// 1. Priority Pipeline Engine (This file): Measures STRUCTURAL alignment.
//    Priority = (CareerValue × ShortlistingPotential) / PursuitFriction
//    - CareerValue: Alignment of Level, Mandate, and Commercial Accountability.
//    - ShortlistingPotential: Alignment across all canonical JD dimensions.
//    - PursuitFriction: Multiplicative friction from location, work-model, and reporting lines.
//    All factors are normalized to [0, 1] and clamped.
//    - Outputs the Structural Decision Verb: Priority >= 0.55 = PURSUE, >= 0.30 = CONSIDER, < 0.30 = PASS.
//
// 2. Capability Scorer Engine (CapabilityRecommendationScorer.ts): Measures SKILL alignment.
//    - Computes the displayed "Pursuit Potential" percentage based on professional expertise.
//
// Connections:
// - evaluation-context.ts -> buildEvaluationContext()
// - pipeline.ts -> runPipeline() -> computePriority()
// ==========================================================

import type { EvaluationContext } from "./evaluation-context";
import { CANONICAL_DIMENSIONS, dim, type DimensionResult } from "./schema";

export type PriorityFactors = Readonly<{
  careerValue: number;
  shortlistingPotential: number;
  pursuitFriction: number; // ∈ [0.3, 3]; higher = harder to pursue
}>;

export type PriorityResult = Readonly<{
  priority: number;
  factors: PriorityFactors;
  dominantFactor: "careerValue" | "shortlistingPotential" | "pursuitFriction";
}>;

const WEIGHT: Record<string, number> = { Core: 1, Supporting: 0.5, Context: 0.2 };
const BUCKET: Record<string, number> = {
  Matched: 1,
  Adjacent: 0.5,
  Missing: 0,
  Contradicted: -0.8,
};

function weightedFit(dims: DimensionResult[]): number {
  let num = 0;
  let den = 0;
  for (const d of dims) {
    const w = WEIGHT[d.importance] ?? 0;
    num += w * (BUCKET[d.bucket] ?? 0);
    den += w;
  }
  if (den === 0) return 0;
  return Math.max(0, Math.min(1, (num / den + 0.2) / 1.2)); // shift + squash
}

export function computePriority(ctx: EvaluationContext): PriorityResult {
  const oi = ctx.opportunity;

  // Career value — level + mandate + commercial signals aligned with ambition.
  const careerDims = ["requiredLevel", "mandate", "commercialAccountability"]
    .map((k) => dim(oi, k as (typeof CANONICAL_DIMENSIONS)[number]))
    .filter((x): x is DimensionResult => !!x);
  const careerValue = weightedFit(careerDims);

  // Shortlisting potential — Matched Core > Adjacent > Contradicted non-gates.
  const shortlist = weightedFit(oi.dimensions);

  // Pursuit friction — geography contradiction, work-model conflict, and
  // market reporting complexity all raise friction. Base 1.0.
  let friction = 1;
  const geo = dim(oi, "geography");
  if (geo?.bucket === "Contradicted") friction *= 1.5;
  else if (geo?.bucket === "Adjacent") friction *= 1.15;
  const work = dim(oi, "workModel");
  if (work?.bucket === "Contradicted") friction *= 1.5;
  else if (work?.bucket === "Adjacent") friction *= 1.15;
  if (ctx.market.reportingComplexity === "deep") friction *= 1.15;
  friction = Math.max(0.3, Math.min(3, friction));

  const priority = Math.max(
    0,
    Math.min(1, (careerValue * shortlist) / friction),
  );

  // Dominant factor = the biggest lever the priority hinges on.
  const levers = {
    careerValue,
    shortlistingPotential: shortlist,
    pursuitFriction: 1 - Math.min(1, friction / 3),
  };
  const dominantFactor = (Object.entries(levers).sort(
    (a, b) => b[1] - a[1],
  )[0][0]) as PriorityResult["dominantFactor"];

  return {
    priority,
    factors: {
      careerValue,
      shortlistingPotential: shortlist,
      pursuitFriction: friction,
    },
    dominantFactor,
  };
}