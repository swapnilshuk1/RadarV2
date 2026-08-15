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
import path from "path";
import fs from "fs";
import { CandidateIntelligencePipeline } from "./cip";
import { JobIntelligencePipeline } from "./jip";
import { present, type Presented } from "./present";
import { buildHeadspace } from "./candidate";
import { applyHeadspaceFilter } from "./headspace-filter";
import type { RecommendationRecord } from "./record";
import type { CandidateProjection } from "../domain/candidate_projection";
import { computeEvidenceGroundingMap, EvidenceGroundingState } from "@/domain/evidence";

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
import { EvidenceGate } from "./gates/EvidenceGate";
import { calculateShortlistingPotentialFromAssessments } from "./calculators/ShortlistingPotentialCalculator";

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
      if (baseOpportunitiesCache.length > 0) return baseOpportunitiesCache;
    }
  } catch (err) {
    console.warn("[Engine] Failed to load live-scraped.json dynamically:", err);
  }

  try {
    const mainDbPath = path.resolve(process.cwd(), "radar.sqlite");
    if (fs.existsSync(mainDbPath)) {
      const Database = require("better-sqlite3");
      const db = new Database(mainDbPath, { readonly: true });
      const rows = db.prepare(`
        SELECT o.id as jobHash, o.canonical_title as role, c.name as company, o.location as location,
               d.content as rawContent
        FROM opportunities o
        LEFT JOIN companies c ON o.company_id = c.id
        LEFT JOIN documents d ON d.opportunity_id = o.id
      `).all() as any[];
      db.close();

      const ops: OpportunitySource[] = rows.map((r) => {
        let contentObj: any = {};
        try { if (r.rawContent) contentObj = JSON.parse(r.rawContent); } catch {}
        return {
          jobHash: r.jobHash,
          role: r.role || contentObj.role || "Executive Role",
          company: r.company || contentObj.company || "Target Company",
          location: r.location || contentObj.location || "Remote",
          scrapedFrom: contentObj.scrapedFrom || "LinkedIn",
          postedRelative: contentObj.postedRelative || "Recently Ingested",
          rawText: contentObj.normalizedText || contentObj.rawText || "",
          dimensions: contentObj.dimensions || [],
          primaryConcern: contentObj.primaryConcern || null,
          whyNow: contentObj.whyNow,
          positioning: contentObj.positioning,
        };
      });

      if (ops.length > 0) {
        baseOpportunitiesCache = ops;
        return baseOpportunitiesCache;
      }
    }
  } catch (err: any) {
    console.warn("[Engine] Failed to load opportunities from radar.sqlite:", err.message);
  }

  return [];
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
  writeOpportunities(extraOpportunities);
}

export function injectFreshRecords(records: any[]) {
  writeOpportunities([...(records as OpportunitySource[])]);
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

const itemEvaluationCache = new Map<string, { record: RecommendationRecord; presented: Presented }>();

/**
 * Executes the full V4 pipeline: Candidate/Job Projections -> Assessments -> Rules Engine -> Presentation
 */
export function runEngine(projection: CandidateProjection, activePursuits = 0): {
  presented: Presented[];
  records: RecommendationRecord[];
} {
  const currentAuthored = readOpportunities();
  
  const engineVersion = ENGINE_VERSION;
  const policyHash = simpleStringHash(JSON.stringify(decisionPolicy));
  const ontologyVersion = ONTOLOGY_VERSION;
  const candHash = simpleStringHash(JSON.stringify(projection));
  
  const serializedOps = JSON.stringify(currentAuthored.map(o => ({
    hash: o.jobHash,
    role: o.role,
    company: o.company,
    text: (o as any).description || (o as any).normalizedText || (o as any).rawText || (o as any).rawDescription || "",
    dims: o.dimensions
  })));
  const opportunityCorpusHash = simpleStringHash(serializedOps);

  const topLevelCacheKey = `${engineVersion}:${policyHash}:${ontologyVersion}:${candHash}:${opportunityCorpusHash}:${activePursuits}`;

  const cached = cachedRuns.get(topLevelCacheKey);
  if (cached) {
    return cached;
  }

  // Fallback V3 Dossier and CandidateProjectionBuilder removed since projection is already built
  const candProjV4 = projection;
  const projTimestamp = (projection as any).updatedAt || (projection as any).createdAt || "v1";

  const records: RecommendationRecord[] = [];
  const presentedList: Presented[] = [];

  for (const raw of currentAuthored) {
    const oppContentHash = simpleStringHash(JSON.stringify({
      role: raw.role,
      company: raw.company,
      text: (raw as any).description || (raw as any).normalizedText || (raw as any).rawText || (raw as any).rawDescription || "",
      dims: raw.dimensions
    }));

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
    const rawJobText = (raw as any).rawText || (raw as any).rawDescription || (raw as any).description || (raw as any).normalizedText || "";
    const roleTitle = raw.role || "";
    const companyName = raw.company || "";
    
    const hasStructuredEvidence = !!(raw.dimensions && raw.dimensions.some((d: any) => {
      if (!d.jdEvidence || d.jdEvidence.status !== "Explicit") return false;
      const evidenceList = d.jdEvidence.evidence;
      if (!Array.isArray(evidenceList) || evidenceList.length === 0) return false;
      return evidenceList.some((ev: any) => {
        const quote = ev?.quote;
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
          // P0-C: Pipeline contains ONLY EvidenceGate
          pipeline: [{ stage: "EvidenceGate", status: "SPARSE_SPEC", score: null, reason: "Needs More Signal: < 25 words in job specification." }],
          evidenceMapping: [],
          // P0-C: No careerValueBreakdown for SPARSE_SPEC
          careerValueBreakdown: undefined as any,
          headspace: { finalVerb: "SPARSE_SPEC", downgraded: false, reason: undefined },
          missing: ["evidence"],
          timestamp: new Date().toISOString()
        } as any,
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
    const identity = IdentityAssessmentEngine.evaluate(candProjV4, jobProjV4);
    const capability = CapabilityAssessmentEngine.evaluate(candProjV4, jobProjV4);
    const opportunityAssess = OpportunityAssessmentEngine.evaluate(candProjV4, jobProjV4);
    const career = CareerAssessmentEngine.evaluate(candProjV4, jobProjV4);
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

    const candIdentityVal = (candProjV4 as any).executiveIdentity?.value || "Commercial & Marketing Leadership";

    const policyResult = DecisionPolicyEngine.evaluate(
      identity,
      capability,
      opportunityAssess,
      career,
      lifestyle,
      jobProjV4.executiveIdentity.value,
      candIdentityVal,
      rawJobText,
      hasStructuredEvidence,
      undefined, // evidenceGrounding - not used
      undefined, // dimensions - not used
      shortlistingPotentialScore // P3-A: Pass authoritative SP
    );

    const finalVerb = policyResult.verdict;
    const headspaceState = buildHeadspace(activePursuits);
    const headspaceOutcome = applyHeadspaceFilter(finalVerb, headspaceState);

    // Use Continuous Priority Score directly from DecisionPolicyEngine
    const finalScore = policyResult.priorityScore;

    // Extract actual missing dimensions directly from the scraped database
    const dims = raw.dimensions || [];
    const rawGaps = dims.filter(
      (d: any) => d.bucket === "Missing" || d.bucket === "Gap" || d.jdEvidence?.status === "Missing"
    );

    // Backwards compatibility translation & clean V4 record
    const record: RecommendationRecord = {
      jobHash: raw.jobHash,
      engineVersion: ENGINE_VERSION,
      recommendationVersion: `${ENGINE_VERSION}:${raw.jobHash}:${headspaceOutcome.finalVerb}`,
      verb: headspaceOutcome.finalVerb,
      qualityScore: finalScore !== null ? finalScore : null,
      rawScore: policyResult.rawScore,
      priority: finalScore !== null ? finalScore : null,
      vetoed: policyResult.vetoed,
      vetoReason: policyResult.vetoReason,
      claimPermissions: policyResult.claimPermissions,
      confidence: policyResult.confidences.recommendation,
      factors: {
        pursuitFriction: (lifestyle as any).locationFrictionPenalty || 0
      },
      evidenceGrounding,
      // P3-A: decisionSummary.shortlistingPotential now uses authoritative P2-C calculation
      decisionSummary: {
        careerValue: (career as any).careerScore ?? 0,
        shortlistingPotential: shortlistingPotentialScore,
        pursuitFriction: (lifestyle as any).locationFrictionPenalty || 0
      },
      decisionDrivers: policyResult.decisionDrivers,
      decisionRisks: policyResult.decisionRisks,
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
        missingEvidence: rawGaps.map((g: any) => g.key),
        unknowns: []
      },
      // P3-A: trace.factors.shortlistingPotential now uses the same authoritative value
      // P3-A: Store full SP calculation for synthesizer consumption
      trace: {
              priority: finalScore !== null ? finalScore : 0,
              factors: {
                careerValue: (career as any).careerScore ?? 0,
                shortlistingPotential: shortlistingPotentialScore,
                pursuitFriction: 1.0
              },
              shortlistingPotentialCalculation: shortlistingPotentialCalc,
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
      } as any,
      esi: capability.overallFit ?? 0,
      diligenceStatus: "READY"
    };

    records.push(record);
  }

  // Populate comparative queue ranking
  for (const r of records) {
    const rPriority = r.priority ?? 0;
    const higherThan = records.filter(other => (other.priority ?? 0) < rPriority).map(other => other.jobHash);
    const lowerThan = records.filter(other => (other.priority ?? 0) > rPriority).map(other => other.jobHash);
    (r as any).comparison = { higherThan, lowerThan, differentiators: [], tradeOffs: [] };
  }

  // Generate Presented mappings
  const byHash = new Map(currentAuthored.map((a) => [a.jobHash, a]));
  const presented = records
    .map((r) => {
      const a = byHash.get(r.jobHash);
      if (!a) return null;
      const pres = present(a, r, projection);
      const oppContentHash = simpleStringHash(JSON.stringify({
        role: a.role,
        company: a.company,
        text: (a as any).description || (a as any).normalizedText || (a as any).rawText || (a as any).rawDescription || "",
        dims: a.dimensions
      }));
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

export function runEngineSingle(jobHash: string, projection: CandidateProjection, activePursuits = 0): Presented | undefined {
  const currentAuthored = readOpportunities();
  const found = currentAuthored.find((o) => o.jobHash === jobHash);
  if (!found) return undefined;

  const { presented } = runEngine(projection, activePursuits);
  return presented.find(p => p.opportunity.jobHash === jobHash);
}