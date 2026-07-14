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
import { checkEligibility } from "./eligibility";
import { computePriority } from "./priority";
import { decide } from "./decision";
import { applyHeadspaceFilter } from "./headspace-filter";
import { computeStability } from "./stability";
import { analyseComparatively } from "./comparative";
import { explain } from "./explain";
import { buildTrace } from "./trace";
import { ENGINE_VERSION, fingerprint, type RecommendationRecord } from "./record";

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
  };
  const rows: Row[] = [];

  for (const oi of input.opportunities) {
    const gate = checkEligibility(oi, input.preferences, input.strategy);
    if (!gate.eligible) {
      excluded.push({ jobHash: oi.jobHash, blockers: gate.blockers });
      // We still emit a record downstream so the UI can show the PASS reason.
    }
    const market = input.market(oi.jobHash);
    const ctx = buildEvaluationContext({
      opportunity: oi,
      identity: input.identity,
      preferences: input.preferences,
      strategy: input.strategy,
      market,
    });
    const priorityResult = computePriority(ctx);
    const verb0 = decide(priorityResult.priority);
    rows.push({
      oi,
      priority: priorityResult.priority,
      priorityResult,
      verb0,
      completeness: ctx.completeness,
      marketAvailable: market.status === "ready",
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
    });
    return record;
  });

  return { records, excluded };
}