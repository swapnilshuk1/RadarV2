/**
 * engine.ts
 *
 * RADAR V4 Core Engine Orchestrator.
 * Fully integrates the Type-Safe Ontological Pipeline:
 * CandidateProjection -> JobProjections -> Standalone Assessments -> DecisionPolicyEngine -> RecommendationViewModel -> UI Presenter
 */

import { rawOpportunities as authored, type Opportunity, type OpportunitySource } from "@/data/opportunity-fixtures";
import { extraOpportunities } from "@/data/extra-fixtures";
import path from "path";
import fs from "fs";
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
import { CareerValueEngine } from "./engines/CareerValueEngine";
import { LifestyleAssessmentEngine } from "./engines/LifestyleAssessmentEngine";
import { IdentityAssessmentEngine } from "./engines/IdentityAssessmentEngine";
import { DecisionPolicyEngine } from "./policy/DecisionPolicyEngine";

const KEY = "radar.opportunities.v3";
let baseOpportunitiesCache: OpportunitySource[] | null = null;

function getBaseOpportunities(): OpportunitySource[] {
  if (baseOpportunitiesCache) return baseOpportunitiesCache;
  if (typeof window !== "undefined") return [];
  try {
    const jsonPath = path.resolve(process.cwd(), "src/data/live-scraped.json");
    if (fs.existsSync(jsonPath)) {
      const content = fs.readFileSync(jsonPath, "utf-8");
      baseOpportunitiesCache = JSON.parse(content) as OpportunitySource[];
      return baseOpportunitiesCache;
    }
  } catch (err) {
    console.warn("[Engine] Failed to load live-scraped.json dynamically:", err);
  }
  return [];
}

let memoryCache: OpportunitySource[] | null = null;

let cachedRuns = new Map<number, {
  currentAuthoredLength: number;
  currentAuthoredHashes: string;
  result: { presented: Presented[]; records: RecommendationRecord[] };
}>();

export function invalidateEngineCache() {
  baseOpportunitiesCache = null;
  cachedRuns.clear();
}

export function readOpportunities(): OpportunitySource[] {
  const baseOps = getBaseOpportunities();
  if (typeof window === "undefined") return memoryCache ?? baseOps;
  try {
    const raw = window.localStorage.getItem(KEY);
    const cached = raw ? JSON.parse(raw) : [];
    
    const merged = new Map<string, OpportunitySource>();
    for (const item of cached) merged.set(item.jobHash, item);
    for (const item of baseOps) merged.set(item.jobHash, item);
    
    return Array.from(merged.values());
  } catch {
    return baseOps;
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

const ONTOLOGY_VERSION = "14.2.0";
const ENGINE_VERSION = "4.0.0";

function simpleStringHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

export function computeEvaluationSignature(
  jobHash: string,
  projectionTimestamp: string | number = "v1",
  ontologyVersion: string = ONTOLOGY_VERSION,
  engineVersion: string = ENGINE_VERSION
): string {
  const raw = `${jobHash}:${projectionTimestamp}:${ontologyVersion}:${engineVersion}`;
  return simpleStringHash(raw);
}

const itemEvaluationCache = new Map<string, { record: RecommendationRecord; presented: Presented }>();

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
  const projTimestamp = (projection as any).updatedAt || (projection as any).createdAt || "v1";

  const records: RecommendationRecord[] = [];
  const presentedList: Presented[] = [];

  for (const raw of currentAuthored) {
    const signature = computeEvaluationSignature(raw.jobHash, projTimestamp);
    const existing = itemEvaluationCache.get(signature);

    if (existing) {
      records.push(existing.record);
      presentedList.push(existing.presented);
      continue;
    }

    // 2. Build Job V4 Projection
    const jobProjV4 = JobProjectionBuilder.build(raw);

    // 3. Evaluate Isolated Assessments
    const identity = IdentityAssessmentEngine.evaluate(candProjV4, jobProjV4);
    const capability = CapabilityAssessmentEngine.evaluate(candProjV4, jobProjV4);
    const opportunityAssess = OpportunityAssessmentEngine.evaluate(candProjV4, jobProjV4);
    const career = CareerAssessmentEngine.evaluate(candProjV4, jobProjV4);
    const lifestyle = LifestyleAssessmentEngine.evaluate(candProjV4, jobProjV4);

    // 4. Resolve Verdict via Rules-Based Decision Policy Engine
    const careerValueBreakdown = CareerValueEngine.evaluate(candProjV4, jobProjV4);

    const policyResult = DecisionPolicyEngine.evaluate(
      identity,
      capability,
      opportunityAssess,
      career,
      lifestyle,
      jobProjV4.executiveIdentity.value
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
      decisionSummary: {
        careerValue: capability.overallFit,
        shortlistingPotential: finalScore / 100,
        pursuitFriction: (lifestyle as any).locationFrictionPenalty || 0
      },
      decisionDrivers: policyResult.decisionDrivers,
      decisionRisks: policyResult.decisionRisks,
      confidences: policyResult.confidences,
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
        confidence: policyResult.confidences.recommendation,
        stability: "High",
        pipeline: policyResult.pipeline,
        evidenceMapping: capability.matches || [],
        careerValueBreakdown,
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
      const a = byHash.get(r.jobHash);
      if (!a) return null;
      const pres = present(a, r, projection);
      const signature = computeEvaluationSignature(r.jobHash, projTimestamp);
      itemEvaluationCache.set(signature, { record: r, presented: pres });
      return pres;
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