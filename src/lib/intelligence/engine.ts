/**
 * engine.ts
 *
 * RADAR V4 Core Engine Orchestrator.
 * Fully integrates the Type-Safe Ontological Pipeline:
 * CandidateProjection -> JobProjections -> Standalone Assessments -> DecisionPolicyEngine -> RecommendationViewModel -> UI Presenter
 */

import { rawOpportunities as authored, type Opportunity, type OpportunitySource } from "@/data/opportunity-fixtures";
import { extraOpportunities } from "@/data/extra-fixtures";
import decisionPolicy from "@/data/ontology/decision_policy.json";
import { CandidateIntelligencePipeline } from "./cip";
import { JobIntelligencePipeline } from "./jip";
import { present, type Presented } from "./present";
import { buildHeadspace } from "./candidate";
import { applyHeadspaceFilter } from "./headspace-filter";
import type { RecommendationRecord } from "./record";
import type { CandidateProjection } from "../domain/candidate_projection";
import { computeEvidenceGroundingMap, EvidenceGroundingState } from "@/domain/evidence";
import { buildCandidateEvaluationContext } from "./context";

// Phase 4 Semantic Imports
import { CandidateProjectionBuilderImpl } from "./builders/CandidateProjectionBuilder";
import { JobProjectionBuilder } from "./builders/JobProjectionBuilder";
import { IdentityAssessmentEngine } from "./engines/IdentityAssessmentEngine";
import { CapabilityAssessmentEngine } from "./engines/CapabilityAssessmentEngine";
import { OpportunityAssessmentEngine } from "./engines/OpportunityAssessmentEngine";
import { CareerAssessmentEngine } from "./engines/CareerAssessmentEngine";
import { CareerValueEngine } from "./engines/CareerValueEngine";
import { LifestyleAssessmentEngine } from "./engines/LifestyleAssessmentEngine";
import { DecisionPolicyEngine } from "./policy/DecisionPolicyEngine";
import { EvidenceGate } from "./gates/EvidenceGate";
import { calculateShortlistingPotentialFromAssessments } from "./calculators/ShortlistingPotentialCalculator";
import crypto from "node:crypto";

const KEY = "radar.opportunities.v3";
let baseOpportunitiesCache: OpportunitySource[] | null = null;

function getBaseOpportunities(): OpportunitySource[] {
  if (!baseOpportunitiesCache) {
    baseOpportunitiesCache = authored;
  }
  return baseOpportunitiesCache;
}

let memoryCache: OpportunitySource[] | null = null;

let cachedRuns = new Map<string, { presented: Presented[]; records: RecommendationRecord[] }>();

export function invalidateEngineCache() {
  baseOpportunitiesCache = null;
  cachedRuns.clear();
  itemEvaluationCache.clear();
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
  const baseOps = getBaseOpportunities();
  const merged = new Map<string, OpportunitySource>();
  for (const item of baseOps) merged.set(item.jobHash, item);
  for (const item of extraOpportunities) merged.set(item.jobHash, item);
  writeOpportunities(Array.from(merged.values()));
}

export function injectFreshRecords(records: OpportunitySource[]) {
  writeOpportunities([...records]);
}

export function clearInjectedRecords() {
  memoryCache = null;
  invalidateEngineCache();
}

/** Explicit Fixture / Corpus Isolation APIs (Boundary 9) */
export function injectFixtureRecords(records: OpportunitySource[]) {
  memoryCache = [...records];
  invalidateEngineCache();
}

export function clearFixtureRecords() {
  memoryCache = null;
  invalidateEngineCache();
}

export function readLiveOpportunities(): OpportunitySource[] {
  memoryCache = null;
  invalidateEngineCache();
  return getBaseOpportunities();
}

export function assertLiveCorpusNotEmpty(): OpportunitySource[] {
  const ops = readLiveOpportunities();
  if (ops.length === 0) {
    throw new Error("[CorpusInvariant] Live opportunity corpus is empty! Check database/fixtures.");
  }
  return ops;
}

const candidateBuilder = new CandidateProjectionBuilderImpl();

const ONTOLOGY_VERSION = "14.2.0";
export const ENGINE_VERSION = "4.3.0-positive-domain-validation";

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
  engineVersion: string = ENGINE_VERSION,
  policyHash = "",
  candHash = "",
  oppContentHash = ""
): string {
  const raw = `${jobHash}:${projectionTimestamp}:${ontologyVersion}:${engineVersion}:${policyHash}:${candHash}:${oppContentHash}`;
  return simpleStringHash(raw);
}

function getOppContentHash(raw: OpportunitySource): string {
  const role = raw.role || "";
  const company = raw.company || "";
  const r = raw as unknown as Record<string, unknown>;
  const text = (r.description || r.normalizedText || r.rawText || r.rawDescription || "") as string;
  const dimsStr = Array.isArray(raw.dimensions)
    ? raw.dimensions.map((d: Record<string, unknown>) => `${d.key}:${d.label}:${(d.jdEvidence as Record<string, unknown> | undefined)?.status || ""}`).join(";")
    : "";
  return simpleStringHash(`${raw.jobHash || ""}|${role}|${company}|${text}|${dimsStr}`);
}

const itemEvaluationCache = new Map<string, { record: RecommendationRecord; presented: Presented }>();

/**
 * Executes the full V4 pipeline: Candidate/Job Projections -> Assessments -> Rules Engine -> Presentation
 */
export function runEngine(
  projection: CandidateProjection,
  activePursuits = 0,
  opportunities?: OpportunitySource[]
): {
  presented: Presented[];
  records: RecommendationRecord[];
} {
  const currentAuthored = opportunities ?? memoryCache ?? readOpportunities();
  
  const evalContext = buildCandidateEvaluationContext(projection);

  const engineVersion = ENGINE_VERSION;
  const policyHash = simpleStringHash(JSON.stringify(decisionPolicy));
  const ontologyVersion = ONTOLOGY_VERSION;
  const candHash = simpleStringHash(JSON.stringify(projection));
  
  const oppContentHashByJobHash = new Map<string, string>();
  for (const o of currentAuthored) {
    oppContentHashByJobHash.set(o.jobHash, getOppContentHash(o));
  }
  const opportunityCorpusHash = simpleStringHash(currentAuthored.map(o => oppContentHashByJobHash.get(o.jobHash)!).join(";"));

  const topLevelCacheKey = `${engineVersion}:${policyHash}:${ontologyVersion}:${candHash}:${opportunityCorpusHash}:${activePursuits}`;

  const cached = cachedRuns.get(topLevelCacheKey);
  if (cached) {
    return cached;
  }

  // Fallback V3 Dossier and CandidateProjectionBuilder removed since projection is already built
  const candProjV4 = projection;
  const pProj = projection as unknown as Record<string, unknown>;
  const projTimestamp = (pProj.updatedAt || pProj.createdAt || "v1") as string;

  const records: RecommendationRecord[] = [];
  const presentedList: Presented[] = [];

  for (const raw of currentAuthored) {
    const oppContentHash = oppContentHashByJobHash.get(raw.jobHash) || getOppContentHash(raw);

    const signature = computeEvaluationSignature(
      raw.jobHash,
      `${projTimestamp}:${activePursuits}`,
      ontologyVersion,
      engineVersion,
      policyHash,
      candHash,
      oppContentHash
    );
    const existing = itemEvaluationCache.get(signature);

    if (existing) {
      records.push(existing.record);
      presentedList.push(existing.presented);
      continue;
    }

        // PHASE 0.2: EvidenceGate Early Boundary Check
    // Must occur BEFORE any expensive downstream processing (P0-B + P0-C contract)
    const rRaw = raw as unknown as Record<string, unknown>;
    const rawJobText = (rRaw.rawText || rRaw.rawDescription || rRaw.description || rRaw.normalizedText || "") as string;
    const roleTitle = raw.role || "";
    const companyName = raw.company || "";
    
    const hasStructuredEvidence = !!(raw.dimensions && (raw.dimensions as Record<string, unknown>[]).some((d) => {
      const jdEv = d.jdEvidence as Record<string, unknown> | undefined;
      if (!jdEv || jdEv.status !== "Explicit") return false;
      const evidenceList = jdEv.evidence as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(evidenceList) || evidenceList.length === 0) return false;
      return evidenceList.some((ev) => {
        const quote = ev?.quote as string | undefined;
        if (!quote) return false;
        const isGrounded = rawJobText.toLowerCase().includes(quote.toLowerCase());
        const hasTrustedProvenance = ev.provenance === "curated" || ev.provenance === "extractor" || ev.provenance === "gold" || ev.provenance === "fixture" || ev.provenance === "onboarder";
        return isGrounded || hasTrustedProvenance;
      });
    }));

    const gateResult = EvidenceGate.evaluate(rawJobText, roleTitle, companyName, hasStructuredEvidence);

    // P0-B + P0-C: Early termination for SPARSE_SPEC
    if (gateResult.evaluationStatus === "SPARSE_SPEC") {
      const sparseRecord: RecommendationRecord = {
        jobHash: raw.jobHash,
        engineVersion: ENGINE_VERSION,
        recommendationVersion: `${ENGINE_VERSION}:${raw.jobHash}:SPARSE_SPEC`,
        verb: "SPARSE_SPEC",
        qualityScore: null,
        rawScore: 0,
        priority: null,  // P0-B: uncertainty encoded as null
        vetoed: false,   // P0-B: not a veto
        vetoReason: null,
        claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: [] },
        confidence: 0.3,
        factors: { pursuitFriction: 0 },
        evidenceGrounding: {}, // SPARSE_SPEC has no dimensions to ground
        decisionSummary: {
          careerValue: 0,
          shortlistingPotential: 0,
          pursuitFriction: 0
        },
        decisionDrivers: [],
        decisionRisks: [{ factor: "Insufficient Evidence", impact: "negative", strength: "high", evidence: "Specification contains fewer than 25 words." }],
        confidences: { parsing: 0.3, matching: 0.3, recommendation: 0.3 },
        stability: "Low",
        headspace: { finalVerb: "SPARSE_SPEC", downgraded: false, reason: undefined },
        comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
        explanation: {
          reason: "insufficient-evidence-for-evaluation",
          dominantFactor: "careerValue",
          missingEvidence: [],
          unknowns: ["mandate scope", "capability requirements", "reporting structure"]
        },
        trace: {
          priority: 0,
          factors: { careerValue: 0, shortlistingPotential: 0, pursuitFriction: 1.0 },
          verb0: "SPARSE_SPEC",
          finalVerb: "SPARSE_SPEC",
          confidence: 0.3,
          stability: "Low",
          candidateProjectionHash: candHash,
          opportunityContentHash: oppContentHash,
          // P0-C: Pipeline contains ONLY EvidenceGate
          pipeline: [{ stage: "EvidenceGate", status: "SPARSE_SPEC", score: null, reason: "Needs More Signal: < 25 words in job specification." }],
          evidenceMapping: [],
          headspace: { finalVerb: "SPARSE_SPEC", downgraded: false, reason: undefined },
          missing: ["evidence"],
          timestamp: new Date().toISOString()
        } as unknown as RecommendationRecord["trace"],
        esi: undefined,
        diligenceStatus: "FAILED"
      };
      records.push(sparseRecord);
      // Skip ALL expensive downstream processing (Identity, Capability, Career assessments)
      continue;
    }

    // Non-SPARSE_SPEC: Continue with normal pipeline
    // 2. Build Job V4 Projection
    const jobProjV4 = JobProjectionBuilder.build(raw);

    // P0-A: Compute evidence grounding for all dimensions (needed for record and downstream)
    const evidenceGrounding = computeEvidenceGroundingMap(raw.dimensions || [], rawJobText);

    // 3. Evaluate Isolated Assessments
    const identity = IdentityAssessmentEngine.evaluate(candProjV4, jobProjV4, evalContext);
    const capability = CapabilityAssessmentEngine.evaluate(candProjV4, jobProjV4, evalContext);
    const opportunityAssess = OpportunityAssessmentEngine.evaluate(candProjV4, jobProjV4);
    const career = CareerAssessmentEngine.evaluate(candProjV4, jobProjV4, evalContext);
    const lifestyle = LifestyleAssessmentEngine.evaluate(candProjV4, jobProjV4);

    // P3-A: Calculate authoritative Shortlisting Potential BEFORE DecisionPolicyEngine
    // This breaks the circular dependency by using pre-decision assessments only
    const recommendationConfidence = (capability.matchingConfidence || 0.8);
    const shortlistingPotentialCalc = calculateShortlistingPotentialFromAssessments(
      identity,
      capability,
      career,
      opportunityAssess,
      recommendationConfidence
    );
    const shortlistingPotentialScore = shortlistingPotentialCalc.score;

    // 4. Resolve Verdict via Rules-Based Decision Policy Engine
    // P3-A: Pass SP to DecisionPolicyEngine for Easy Trap rule
    const careerValueBreakdown = CareerValueEngine.evaluate(candProjV4, jobProjV4);

    const candProjObj = candProjV4 as unknown as Record<string, unknown>;
    const candIdentityVal = ((candProjObj.executiveIdentity as Record<string, unknown> | undefined)?.value as string) || "Commercial & Marketing Leadership";

    const policyResult = DecisionPolicyEngine.evaluate(
      identity,
      capability,
      opportunityAssess,
      career,
      lifestyle,
      jobProjV4.executiveIdentity.value,
      candIdentityVal,
      rawJobText,
      hasStructuredEvidence || !!((jobProjV4 as any).dimensions && (jobProjV4 as any).dimensions.length > 0),
      undefined, // evidenceGrounding - not used
      (jobProjV4 as any).dimensions, // pass synthesized/grounded dimensions
      shortlistingPotentialScore // P3-A: Pass authoritative SP
    );

    const verb0 = policyResult.verdict;
    const candAttentionWindow = (candProjObj.attentionWindow as number | undefined) ?? (candProjObj.headspaceCapacityPerMonth as number | undefined);
    const headspaceState = buildHeadspace(activePursuits, candAttentionWindow);
    const headspaceOutcome = applyHeadspaceFilter(verb0, headspaceState);
    const finalVerb = headspaceOutcome.finalVerb;

    // Use Continuous Priority Score directly from DecisionPolicyEngine
    const finalScore = policyResult.priorityScore;

    // Extract actual missing dimensions directly from the scraped database
    const dims = (raw.dimensions || []) as Record<string, unknown>[];
    const rawGaps = dims.filter(
      (d) => d.bucket === "Missing" || d.bucket === "Gap" || (d.jdEvidence as Record<string, unknown> | undefined)?.status === "Missing"
    );

    const lifeObj = lifestyle as unknown as Record<string, unknown>;
    const carObj = career as unknown as Record<string, unknown>;

    // Backwards compatibility translation & clean V4 record
    const record: RecommendationRecord = {
      jobHash: raw.jobHash,
      engineVersion: ENGINE_VERSION,
      recommendationVersion: `${ENGINE_VERSION}:${raw.jobHash}:${finalVerb}`,
      verb: finalVerb,
      qualityScore: finalScore !== null ? finalScore : null,
      rawScore: policyResult.rawScore,
      priority: finalScore !== null ? finalScore : null,
      vetoed: policyResult.vetoed,
      vetoReason: policyResult.vetoReason,
      claimPermissions: policyResult.claimPermissions,
      confidence: policyResult.confidences.recommendation,
      factors: {
        pursuitFriction: (lifeObj.locationFrictionPenalty as number | undefined) || 0
      },
      evidenceGrounding,
      // P3-A: decisionSummary.shortlistingPotential now uses authoritative P2-C calculation
      decisionSummary: {
        careerValue: (carObj.careerScore as number | undefined) ?? 0,
        shortlistingPotential: shortlistingPotentialScore,
        pursuitFriction: (lifeObj.locationFrictionPenalty as number | undefined) || 0
      },
      triggeredRuleIds: policyResult.triggeredRuleIds,
      decisionDrivers: policyResult.decisionDrivers,
      decisionRisks: policyResult.decisionRisks,
      relativeDifferentiator: policyResult.relativeDifferentiator,
      trajectoryUpside: policyResult.trajectoryUpside,
      opportunityScoreConfidence: policyResult.opportunityScoreConfidence,
      opportunityScoreSource: policyResult.opportunityScoreSource,
      confidences: policyResult.confidences,
      stability: "High",
      headspace: headspaceOutcome,
      comparison: {
        higherThan: [],
        lowerThan: [],
        differentiators: [],
        tradeOffs: []
      },
      explanation: {
        reason: "composite-evidence-sufficiency",
        dominantFactor: "shortlistingPotential",
        missingEvidence: rawGaps.map((g) => (g.key as string) || ""),
        unknowns: []
      },
      // P3-A: trace.factors.shortlistingPotential now uses the same authoritative value
      // P3-A: Store full SP calculation for synthesizer consumption
      trace: {
        priority: finalScore !== null ? finalScore : 0,
        factors: {
          careerValue: (carObj.careerScore as number | undefined) ?? 0,
          shortlistingPotential: shortlistingPotentialScore,
          pursuitFriction: 1.0
        },
        shortlistingPotentialCalculation: shortlistingPotentialCalc,
        verb0,
        finalVerb,
        confidence: policyResult.confidences.recommendation,
        stability: "High",
        candidateProjectionHash: candHash,
        opportunityContentHash: oppContentHash,
        pipeline: policyResult.pipeline,
        evidenceMapping: capability.matches || [],
        careerValueBreakdown,
        headspace: headspaceOutcome,
        missing: rawGaps.map((g) => (g.key as string) || ""),
        timestamp: new Date().toISOString()
      } as unknown as RecommendationRecord["trace"],
      esi: capability.overallFit ?? 0,
      diligenceStatus: "READY"
    };

    records.push(record);
  }

  // Populate comparative queue ranking (O(U * N) where U = number of unique priority values)
  const comparisonCacheByPriority = new Map<number, { higherThan: string[]; lowerThan: string[]; differentiators: string[]; tradeOffs: string[] }>();

  for (const r of records) {
    const rPriority = r.priority ?? 0;
    let comp = comparisonCacheByPriority.get(rPriority);
    if (!comp) {
      const higherThan = records.filter(other => (other.priority ?? 0) < rPriority).map(other => other.jobHash);
      const lowerThan = records.filter(other => (other.priority ?? 0) > rPriority).map(other => other.jobHash);
      comp = { higherThan, lowerThan, differentiators: [], tradeOffs: [] };
      comparisonCacheByPriority.set(rPriority, comp);
    }
    (r as unknown as Record<string, unknown>).comparison = comp;
  }

  // Generate Presented mappings
  const byHash = new Map(currentAuthored.map((a) => [a.jobHash, a]));
  const presented = records
    .map((r) => {
      const a = byHash.get(r.jobHash);
      if (!a) return null;
      const pres = present(a, r, projection);
      const oppContentHash = oppContentHashByJobHash.get(r.jobHash) || getOppContentHash(a);
      const signature = computeEvaluationSignature(
        r.jobHash,
        `${projTimestamp}:${activePursuits}`,
        ontologyVersion,
        engineVersion,
        policyHash,
        candHash,
        oppContentHash
      );
      itemEvaluationCache.set(signature, { record: r, presented: pres });
      return pres;
    })
    .filter((x): x is Presented => x !== null);

  const result = { presented, records };
  cachedRuns.set(topLevelCacheKey, result);
  return result;
}

export function runEngineSingle(
  jobHash: string,
  projection: CandidateProjection,
  activePursuits = 0,
  opportunities?: OpportunitySource[]
): Presented | undefined {
  const currentAuthored = opportunities ?? memoryCache ?? readOpportunities();
  const found = currentAuthored.find((o) => o.jobHash === jobHash);
  if (!found) return undefined;

  const { presented } = runEngine(projection, activePursuits, currentAuthored);
  return presented.find(p => p.opportunity.jobHash === jobHash);
}

export type EvaluationArtifact = {
  record: any;
  opportunity?: any;
  jobProjection?: any;
  recommendation?: any;
};

export function runEngineSingleIntrinsic(
  jobHash: string,
  candidateProjection: any,
  activePursuitsCount: number,
  opps?: OpportunitySource[]
): EvaluationArtifact | undefined {
  const currentAuthored = opps ?? memoryCache ?? readOpportunities();
  const raw = currentAuthored.find((o) => o.jobHash === jobHash);
  if (!raw) return undefined;

  const presented = runEngineSingle(jobHash, candidateProjection, activePursuitsCount, currentAuthored);
  if (!presented) return undefined;

  const jobProj = JobProjectionBuilder.build(raw);

  return {
    record: presented.record,
    jobProjection: jobProj,
    recommendation: (presented as any).recommendationResult,
  };
}