/**
 * engine.ts
 *
 * RADAR V4 Core Engine Orchestrator.
 * Fully integrates the Type-Safe Ontological Pipeline:
 * CandidateProjection -> JobProjections -> Standalone Assessments -> DecisionPolicyEngine -> RecommendationViewModel -> UI Presenter
 */

import { rawOpportunities as authored, type Opportunity, type OpportunitySource } from "@/data/opportunity-fixtures";
import { extraOpportunities } from "@/data/extra-fixtures";
import liveScraped from "../../data/live-scraped.json";
import { CandidateIntelligencePipeline } from "./cip";
import { JobIntelligencePipeline } from "./jip";
import { V3EvaluationEngine } from "./V3EvaluationEngine";
import { present, type Presented } from "./present";
import type { RecommendationRecord } from "./record";
import { loadDecisionPolicy, computeDecisionVerdict } from "../recommendation/EvaluationAdapter";
import type { CandidateProjection } from "../domain/candidate_projection";

// Phase 4 Semantic Imports
import { CandidateProjectionBuilderImpl } from "./builders/CandidateProjectionBuilder";
import { JobProjectionBuilder } from "./builders/JobProjectionBuilder";
import { CapabilityAssessmentEngine } from "./engines/CapabilityAssessmentEngine";
import { OpportunityAssessmentEngine } from "./engines/OpportunityAssessmentEngine";
import { CareerAssessmentEngine } from "./engines/CareerAssessmentEngine";
import { LifestyleAssessmentEngine } from "./engines/LifestyleAssessmentEngine";
import { IdentityAssessmentEngine } from "./engines/IdentityAssessmentEngine";
import { DecisionPolicyEngine } from "./policy/DecisionPolicyEngine";

const KEY = "radar.opportunities.v3";
const baseOpportunities = [...(liveScraped as OpportunitySource[])];
let memoryCache: OpportunitySource[] | null = null;

let cachedRuns = new Map<number, {
  currentAuthoredLength: number;
  currentAuthoredHashes: string;
  result: { presented: Presented[]; records: RecommendationRecord[] };
}>();

export function invalidateEngineCache() {
  cachedRuns.clear();
}

export function readOpportunities(): OpportunitySource[] {
  if (typeof window === "undefined") return memoryCache ?? baseOpportunities;
  try {
    const raw = window.localStorage.getItem(KEY);
    const cached = raw ? JSON.parse(raw) : [];
    
    const merged = new Map<string, OpportunitySource>();
    for (const item of cached) merged.set(item.jobHash, item);
    for (const item of baseOpportunities) merged.set(item.jobHash, item);
    
    return Array.from(merged.values());
  } catch {
    return baseOpportunities;
  }
}

export function writeOpportunities(next: OpportunitySource[]) {
  invalidateEngineCache();
  if (typeof window === "undefined") {
    memoryCache = next;
    return;
  }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("radar:opportunities"));
  } catch {
    /* ignore */
  }
}

export function addExtraOpportunities() {
  writeOpportunities(extraOpportunities);
}

export function injectFreshRecords(records: any[]) {
  writeOpportunities([...(records as OpportunitySource[])]);
}

const candidateBuilder = new CandidateProjectionBuilderImpl();

/**
 * Executes the full V4 pipeline: Candidate/Job Projections -> Assessments -> Rules Engine -> Presentation
 */
export function runEngine(projection: CandidateProjection, activePursuits = 0): {
  presented: Presented[];
  records: RecommendationRecord[];
} {
  const currentAuthored = readOpportunities();
  const currentHashes = currentAuthored.map(o => o.jobHash).join(",");

  const cached = cachedRuns.get(activePursuits);
  if (
    cached &&
    cached.currentAuthoredLength === currentAuthored.length &&
    cached.currentAuthoredHashes === currentHashes
  ) {
    return cached.result;
  }

  // Fallback V3 Dossier and CandidateProjectionBuilder removed since projection is already built
  const candProjV4 = projection;

  const records: RecommendationRecord[] = [];

  for (const raw of currentAuthored) {
    // 2. Build Job V4 Projection
    const jobProjV4 = JobProjectionBuilder.build(raw);

    // 3. Evaluate Isolated Assessments
    const identity = IdentityAssessmentEngine.evaluate(candProjV4, jobProjV4);
    const capability = CapabilityAssessmentEngine.evaluate(candProjV4, jobProjV4);
    const opportunityAssess = OpportunityAssessmentEngine.evaluate(candProjV4, jobProjV4);
    const career = CareerAssessmentEngine.evaluate(candProjV4, jobProjV4);
    const lifestyle = LifestyleAssessmentEngine.evaluate(candProjV4, jobProjV4);

    // 4. Resolve Verdict via Rules-Based Decision Policy Engine
    const policyResult = DecisionPolicyEngine.evaluate(
      identity,
      capability,
      opportunityAssess,
      career,
      lifestyle
    );

    const finalVerb = policyResult.verdict;

    // Use Continuous Priority Score directly from DecisionPolicyEngine
    const finalScore = policyResult.priorityScore;

    // Extract actual missing dimensions directly from the scraped database
    const dims = raw.dimensions || [];
    const rawGaps = dims.filter(
      (d: any) => d.bucket === "Missing" || d.bucket === "Gap" || d.jdEvidence?.status === "Missing"
    );

    // Backwards compatibility translation
    const record: RecommendationRecord = {
      jobHash: raw.jobHash,
      engineVersion: "4.0.0",
      recommendationVersion: `v4:${raw.jobHash}:${finalVerb}`,
      verb: finalVerb,
      priority: finalScore,
      factors: {
        careerValue: capability.overallFit,
        shortlistingPotential: capability.overallFit,
        pursuitFriction: 1.0
      },
      confidence: finalScore,
      stability: "High",
      headspace: {
        finalVerb,
        downgraded: false,
        reason: undefined
      },
      comparison: {
        higherThan: [],
        lowerThan: [],
        differentiators: [],
        tradeOffs: []
      },
      explanation: {
        reason: "composite-evidence-sufficiency",
        dominantFactor: "shortlistingPotential",
        missingEvidence: rawGaps.map((g: any) => g.key),
        unknowns: []
      },
      trace: {
        priority: finalScore,
        factors: {
          careerValue: capability.overallFit,
          shortlistingPotential: capability.overallFit,
          pursuitFriction: 1.0
        },
        verb0: finalVerb,
        finalVerb,
        confidence: finalScore,
        stability: "High",
        headspace: {
          finalVerb,
          downgraded: false,
          reason: undefined
        },
        missing: rawGaps.map((g: any) => g.key),
        timestamp: new Date().toISOString()
      },
      esi: capability.overallFit,
      diligenceStatus: "READY"
    };

    records.push(record);
  }

  // Populate comparative queue ranking
  for (const r of records) {
    const higherThan = records.filter(other => other.priority < r.priority).map(other => other.jobHash);
    const lowerThan = records.filter(other => other.priority > r.priority).map(other => other.jobHash);
    (r as any).comparison = { higherThan, lowerThan, differentiators: [], tradeOffs: [] };
  }

  // Generate Presented mappings
  const byHash = new Map(currentAuthored.map((a) => [a.jobHash, a]));
  const presented = records
    .map((r) => {
      // In V4 paradigm, we still present candidates in the view, but let the UI filter out PASS records or let presentation-boundary hide scores
      const a = byHash.get(r.jobHash);
      return a ? present(a, r, projection) : null;
    })
    .filter((x): x is Presented => x !== null);

  const result = { presented, records };
  cachedRuns.set(activePursuits, {
    currentAuthoredLength: currentAuthored.length,
    currentAuthoredHashes: currentHashes,
    result
  });
  return result;
}

export function runEngineSingle(jobHash: string, projection: CandidateProjection, activePursuits = 0): Presented | undefined {
  const currentAuthored = readOpportunities();
  const found = currentAuthored.find((o) => o.jobHash === jobHash);
  if (!found) return undefined;

  const { presented } = runEngine(projection, activePursuits);
  return presented.find(p => p.opportunity.jobHash === jobHash);
}