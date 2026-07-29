// Layer 3 — declarative pipeline. Reads:
//
//   Extract → Enrich → Evaluate → Recommend → Compare → Explain → Record
//
// Each phase is a pure function; the pipeline is just their composition.
// UI never imports this file directly — it imports the Presenter.

import type { OpportunityIntelligence } from "./schema";
import type {
  CandidateIdentity,
  CareerPreferences,
  HeadspaceState,
  SearchStrategy,
} from "./candidate";
import type { MarketIntelligence } from "./market";
import { buildEvaluationContext } from "./evaluation-context";
import { checkEligibility, isFunctionalMismatch } from "./eligibility";
import { computePriority } from "./priority";
import { decide } from "./decision";
import { applyHeadspaceFilter } from "./headspace-filter";
import { computeStability } from "./stability";
import { analyseComparatively } from "./comparative";
import { explain } from "./explain";
import { buildTrace } from "./trace";
import { ENGINE_VERSION, fingerprint, type RecommendationRecord } from "./record";
import { functionalClassifier } from "./FunctionalClassifier";

export type PipelineInput = {
  opportunities: OpportunityIntelligence[];
  identity: CandidateIdentity;
  preferences: CareerPreferences;
  strategy: SearchStrategy;
  market: (jobHash: string) => MarketIntelligence;
  headspace: HeadspaceState;
};

export type PipelineOutput = {
  records: RecommendationRecord[];
  excluded: Array<{ jobHash: string; blockers: string[] }>;
};

/**
 * === EVALUATION PIPELINE STAGE ===
 * This declarative pipeline implements Layer 3 of the RADAR intelligence core.
 * It inputs parsed opportunities (OpportunityIntelligence) and runs them through:
 * 
 *   Eligibility Gate -> Consensus Mapping -> ESI Calculation -> Context Build -> 
 *   Priority Calculation -> Decision Verb Mapping -> Headspace Saturation Filter -> 
 *   Stability Perturbation -> Comparative Ranker -> Narrative Generator -> Final Record
 * 
 * Connections:
 * - engine.ts -> runEngine() -> runPipeline()
 * - eligibility.ts -> checkEligibility() (Structural hard constraints)
 * - priority.ts -> computePriority() (Strategic and value matching)
 * - headspace-filter.ts -> applyHeadspaceFilter() (Bandwidth limits)
 * - present.ts -> present() (Combines pipeline outputs with Skill Fit capabilities)
 * 
 * =================================
 *
 * Computes the Evidence Sufficiency Index (ESI) as a weighted percentage score.
 * Evaluates dimension coverage, evidence completeness, text richness, and classifier confidence.
 */
function computeESI(
  dimensions: any[],
  textLength: number,
  confidence: number
): { esi: number; diligenceStatus: "READY" | "INSUFFICIENT" } {
  // 1. Dimension Coverage: % of canonical dimensions that are NOT "Missing" (out of 6 core ones)
  const canonicals = ["requiredLevel", "reportingLine", "mandate", "commercialAccountability", "functionalScope", "technologyStack"];
  const nonMissing = dimensions.filter(d => canonicals.includes(d.key) && d.jdEvidence.status !== "Missing").length;
  const dimensionCoverage = nonMissing / canonicals.length;

  // 2. Evidence Completeness: % of non-missing dimensions that have valid verbatim quotes longer than 3 characters
  const nonMissingWithQuotes = dimensions.filter(d => 
    canonicals.includes(d.key) && 
    d.jdEvidence.status !== "Missing" && 
    d.jdEvidence.evidence && d.jdEvidence.evidence.length > 0 &&
    d.jdEvidence.evidence.some((e: any) => e.quote && e.quote.trim().length > 3)
  ).length;
  const evidenceCompleteness = nonMissing > 0 ? nonMissingWithQuotes / nonMissing : 0.0;

  // 3. Text Richness: Total quote lengths scaled up to 350 chars
  const totalQuoteLength = dimensions.reduce((acc, d) => 
    acc + (d.jdEvidence.evidence ? d.jdEvidence.evidence.reduce((sum: number, e: any) => sum + (e.quote ? e.quote.length : 0), 0) : 0), 0);
  const textRichness = Math.min(totalQuoteLength, 350) / 350;

  // 4. Extraction Confidence from consensus
  const extractionConfidence = confidence;

  // Weighted ESI calculation
  const score = (0.40 * dimensionCoverage) + (0.30 * evidenceCompleteness) + (0.20 * textRichness) + (0.10 * extractionConfidence);

  // Diligence status: READY if ESI is 40% or above, INSUFFICIENT if below (meaning sparse evidence)
  const diligenceStatus = score >= 0.40 ? ("READY" as const) : ("INSUFFICIENT" as const);

  return { esi: score, diligenceStatus };
}

export function runPipeline(input: PipelineInput): PipelineOutput {
  const excluded: PipelineOutput["excluded"] = [];

  // Phase 1: Evaluate + Recommend for each eligible opportunity.
  type Row = {
    oi: OpportunityIntelligence;
    priority: number;
    priorityResult: ReturnType<typeof computePriority>;
    verb0: ReturnType<typeof decide>;
    completeness: number;
    marketAvailable: boolean;
    esi: number;
    diligenceStatus: "READY" | "INSUFFICIENT";
  };
  const rows: Row[] = [];

  for (const oi of input.opportunities) {
    const gate = checkEligibility(oi, input.preferences, input.strategy);
    if (!gate.eligible) {
      excluded.push({ jobHash: oi.jobHash, blockers: gate.blockers });
      // We still emit a record downstream so the UI can show the PASS reason.
    }
    
    // Create candidate-specific evaluation of dimensions
    let finalDimensions = [...oi.dimensions];
    
    // Ensure functionalCategory is populated on-the-fly dynamically if missing
    let funcCat = finalDimensions.find(d => d.key === "functionalCategory");
    let consensusConfidence = 0.85; // reasonable default consensus confidence
    if (!funcCat) {
      const classification = functionalClassifier.classifySync({
        title: oi.role,
        company: oi.company,
        location: oi.location
      });
      consensusConfidence = classification.confidence;
      funcCat = {
        key: "functionalCategory",
        label: "Functional Category",
        importance: "Core",
        bucket: "Matched", // Will evaluate below
        jdEvidence: {
          value: classification.value,
          status: classification.value ? "Inferred" : "Missing",
          evidence: classification.evidence.map(e => ({ quote: e.quote, source: "title" }))
        }
      };
      finalDimensions.push(funcCat);
    } else if (funcCat.jdEvidence && funcCat.jdEvidence.evidence && funcCat.jdEvidence.evidence.length > 0) {
      consensusConfidence = 0.90;
    }

    // Map functionalCategory bucket based on Concentric Rings
    const primaryCategories = ["Marketing Leadership", "Marketing Operations", "Demand Generation"];
    const adjacentCategories = ["Revenue Operations", "Partnerships", "Customer Success", "Enterprise Sales", "Channel Sales"];

    finalDimensions = finalDimensions.map((d) => {
      if (d.key === "functionalCategory") {
        const val = d.jdEvidence.value;
        let bucket: "Matched" | "Adjacent" | "Contradicted" | "Missing" = "Missing";
        if (val) {
          if (primaryCategories.includes(val)) {
            bucket = "Matched";
          } else if (adjacentCategories.includes(val)) {
            bucket = "Adjacent";
          } else {
            bucket = "Contradicted";
          }
        }
        return { ...d, bucket };
      }
      if (d.key === "functionalScope" && isFunctionalMismatch(oi.role)) {
        return { ...d, bucket: "Contradicted" as const };
      }
      return d;
    });

    const evaluatedOi = { ...oi, dimensions: finalDimensions };

    // Compute Evidence Sufficiency Index (ESI)
    const { esi, diligenceStatus } = computeESI(finalDimensions, 0, consensusConfidence);

    const market = input.market(oi.jobHash);
    const ctx = buildEvaluationContext({
      opportunity: evaluatedOi,
      identity: input.identity,
      preferences: input.preferences,
      strategy: input.strategy,
      market,
    });
    const priorityResult = computePriority(ctx);
    let verb0 = decide(priorityResult.priority);
    let finalPriority = priorityResult.priority;

    // Force PASSed/Excluded records to have priority 0 and PASS verb
    if (!gate.eligible) {
      verb0 = "PASS";
      finalPriority = 0;
    }

    rows.push({
      oi: evaluatedOi,
      priority: finalPriority,
      priorityResult: {
        ...priorityResult,
        priority: finalPriority,
      },
      verb0,
      completeness: ctx.completeness,
      marketAvailable: market.status === "ready",
      esi,
      diligenceStatus,
    });
  }

  // Phase 2: Rank and compare across the full sorted list.
  const ranked = [...rows].sort((a, b) => b.priority - a.priority);
  const rankedForComparison = ranked.map((r) => ({
    jobHash: r.oi.jobHash,
    company: r.oi.company,
    priority: r.priority,
    oi: r.oi,
  }));
  const comparisons = analyseComparatively(rankedForComparison);

  // Phase 3: Headspace filter + Stability + Explanation + Trace + Record.
  const records: RecommendationRecord[] = ranked.map((r) => {
    const headspaceOutcome = applyHeadspaceFilter(r.verb0, input.headspace);
    const stability = computeStability({
      priority: r.priority,
      verb: headspaceOutcome.finalVerb,
      factors: r.priorityResult.factors,
      completeness: r.completeness,
      dominantFactor: r.priorityResult.dominantFactor,
    });
    const explanation = explain({
      oi: r.oi,
      priority: r.priorityResult,
      marketAvailable: r.marketAvailable,
    });
    const trace = buildTrace({
      priority: r.priorityResult,
      verb0: r.verb0,
      finalVerb: headspaceOutcome.finalVerb,
      confidence: r.completeness,
      stability,
      headspace: headspaceOutcome,
      missing: explanation.missingEvidence,
    });
    const record: RecommendationRecord = Object.freeze({
      jobHash: r.oi.jobHash,
      engineVersion: ENGINE_VERSION,
      recommendationVersion: fingerprint({
        jobHash: r.oi.jobHash,
        priority: r.priority,
        verb: headspaceOutcome.finalVerb,
      }),
      verb: headspaceOutcome.finalVerb,
      priority: r.priority,
      factors: r.priorityResult.factors,
      confidence: r.completeness,
      stability,
      headspace: headspaceOutcome,
      comparison: comparisons.get(r.oi.jobHash)!,
      explanation,
      trace,
      esi: r.esi,
      diligenceStatus: r.diligenceStatus,
    });
    return record;
  });

  return { records, excluded };
}