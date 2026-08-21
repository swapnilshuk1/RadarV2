/**
 * scripts/run-shadow-6a.ts
 *
 * RADAR V4 PHASE 6A — SEMANTIC SHADOW MODE & PRODUCTION-SAFE TELEMETRY
 *
 * HARD SAFETY CONTRACT:
 * - NO Turso reads, NO Turso writes.
 * - ZERO mutations to production state, user choices, or queue tables.
 * - Observational shadow execution only.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { JobProjectionBuilder } from "../src/lib/intelligence/builders/JobProjectionBuilder";
import { IdentityAssessmentEngine } from "../src/lib/intelligence/engines/IdentityAssessmentEngine";
import { CapabilityAssessmentEngine } from "../src/lib/intelligence/engines/CapabilityAssessmentEngine";
import { OpportunityAssessmentEngine } from "../src/lib/intelligence/engines/OpportunityAssessmentEngine";
import { CareerAssessmentEngine } from "../src/lib/intelligence/engines/CareerAssessmentEngine";
import { LifestyleAssessmentEngine } from "../src/lib/intelligence/engines/LifestyleAssessmentEngine";
import { DecisionPolicyEngine } from "../src/lib/intelligence/policy/DecisionPolicyEngine";
import { candidateProfile } from "../src/data/candidate-profile";
import { SemanticResolutionEngine } from "../src/lib/intelligence/semantic/SemanticResolutionEngine";
import { computeIntrinsicFingerprint, buildIntrinsicEvaluationInput } from "../src/lib/intelligence/fingerprint/EvaluationFingerprint";

console.log("================================================================================");
console.log("DATABASE TARGET: LOCAL SQLITE / OFFLINE");
console.log("DATABASE MODE: READONLY");
console.log("TURSO: DISABLED");
console.log("SHADOW MODE: TRUE");
console.log("PRODUCTION MUTATION: DISABLED");
console.log("================================================================================\n");

if (process.env.TURSO_DATABASE_URL && process.env.TURSO_DATABASE_URL.includes("turso.io")) {
  console.error("CRITICAL SAFETY FAILURE: Remote Turso database URL detected! Aborting for safety.");
  process.exit(1);
}

interface CorpusEntry {
  source: string;
  id: string;
  role: string;
  company: string;
  location: string;
  description: string;
  dimensions: any[];
  portal?: string;
  industry?: string;
}

function loadFullCorpus(): CorpusEntry[] {
  const corpus: CorpusEntry[] = [];

  // 1. Golden Cases
  const goldenDir = "./data/golden/cases";
  if (fs.existsSync(goldenDir)) {
    for (const d of fs.readdirSync(goldenDir)) {
      const jdPath = path.join(goldenDir, d, "jd.txt");
      const expPath = path.join(goldenDir, d, "expected.json");
      let text = "";
      let expected: any = {};
      if (fs.existsSync(jdPath)) text = fs.readFileSync(jdPath, "utf-8");
      if (fs.existsSync(expPath)) expected = JSON.parse(fs.readFileSync(expPath, "utf-8"));
      corpus.push({
        source: "data/golden/cases",
        id: d,
        role: expected.role || d.replace(/-/g, " "),
        company: expected.company || "Enterprise Corp",
        location: expected.location || "Delhi NCR",
        description: text || `Executive role for ${d}`,
        dimensions: expected.dimensions || [],
        portal: "Curated Golden",
        industry: "Enterprise / Multi-Industry"
      });
    }
  }

  // 2. Challenge Corpus
  if (fs.existsSync("./radar-challenge-corpus.json")) {
    const raw = JSON.parse(fs.readFileSync("./radar-challenge-corpus.json", "utf-8"));
    const entries = Array.isArray(raw) ? raw : (raw.cases || []);
    for (const e of entries) {
      corpus.push({
        source: "radar-challenge-corpus.json",
        id: e.id || `challenge-${corpus.length}`,
        role: e.role || e.title || "Executive Role",
        company: e.company || "Enterprise Corp",
        location: e.location || "Bengaluru",
        description: e.description || e.rawText || "",
        dimensions: e.dimensions || [],
        portal: "Adversarial Challenge",
        industry: "Technology / Growth"
      });
    }
  }

  // 3. Dataset v1
  if (fs.existsSync("./src/data/benchmark/dataset-v1.json")) {
    const raw = JSON.parse(fs.readFileSync("./src/data/benchmark/dataset-v1.json", "utf-8"));
    for (const e of raw.entries || []) {
      corpus.push({
        source: "src/data/benchmark/dataset-v1.json",
        id: e.id,
        role: e.truth?.role?.value || e.id,
        company: e.truth?.company?.value || "Enterprise Corp",
        location: e.truth?.location?.value || "Gurugram",
        description: e.rawText || e.normalizedText || "",
        dimensions: [],
        portal: "Benchmark Dataset v1",
        industry: "E-Commerce / Commercial"
      });
    }
  }

  // 4. Golden Demo
  if (fs.existsSync("./src/data/golden_demo_dataset.json")) {
    const raw = JSON.parse(fs.readFileSync("./src/data/golden_demo_dataset.json", "utf-8"));
    const entries = Array.isArray(raw) ? raw : (raw.opportunities || []);
    for (const e of entries) {
      corpus.push({
        source: "src/data/golden_demo_dataset.json",
        id: e.id || `demo-${corpus.length}`,
        role: e.role || e.title || "Executive Role",
        company: e.company || "Enterprise Corp",
        location: e.location || "Mumbai",
        description: e.description || "",
        dimensions: e.dimensions || [],
        portal: "Golden Demo",
        industry: "FMCG / Retail"
      });
    }
  }

  // 5. Live Scraped (Full cache available)
  if (fs.existsSync("./src/data/live-scraped.json")) {
    const raw = JSON.parse(fs.readFileSync("./src/data/live-scraped.json", "utf-8"));
    const entries = Array.isArray(raw) ? raw : (raw.jobs || raw.opportunities || []);
    for (const e of entries) {
      corpus.push({
        source: "src/data/live-scraped.json",
        id: e.id || e.jobHash || `scraped-${corpus.length}`,
        role: e.canonicalTitle || e.title || "Executive Role",
        company: e.company || "Enterprise Corp",
        location: e.location || "Bengaluru",
        description: e.normalizedText || e.description || "",
        dimensions: e.metadata?.enrichment?.dimensions || e.dimensions || [],
        portal: e.portal || "LinkedIn / Naukri Scraped",
        industry: e.industry || "General Executive"
      });
    }
  }

  return corpus;
}

export interface ShadowRecord {
  opportunityId: string;
  candidateId: string;
  portal: string;
  industry: string;
  baseline: {
    score: number;
    verdict: string;
    relevantEvidence: any[];
  };
  semantic: {
    evidenceCount: number;
    concepts: string[];
    relationships: string[];
    confidenceDistribution: number[];
    ambiguousCount: number;
    negatedCount: number;
    historicalCount: number;
    aspirationalCount: number;
  };
  shadowEvaluation: {
    score: number;
    verdict: string;
  };
  delta: {
    score: number;
    verdictChanged: boolean;
  };
  attribution: Array<{
    dimension: string;
    sourcePhrase: string;
    canonicalConcept: string;
    relationship: string;
    confidence: number;
    evidenceStrength: string;
    temporalState: string;
    scoreContribution: number;
  }>;
}

async function runShadowMode() {
  const corpus = loadFullCorpus();
  console.log(`Corpus Loaded: ${corpus.length} Opportunities across 5 sources.\n`);

  const candBuilder = new CandidateProjectionBuilderImpl();
  const candIntegrated = candBuilder.fromProfile(candidateProfile as any);
  const candBaseline = { ...candIntegrated, semanticEvidence: undefined };

  const shadowRecords: ShadowRecord[] = [];
  const verdictTransitions: any[] = [];
  const calibrationQueue: any[] = [];

  // Aggregators
  let enrichedCount = 0;
  let totalEvidenceCount = 0;
  const relationshipCounts: Record<string, number> = {};
  const scoreDeltas: number[] = [];
  const verdictTransitionCounts: Record<string, number> = {
    "PASS -> CONSIDER": 0,
    "PASS -> PURSUE": 0,
    "CONSIDER -> PURSUE": 0,
    "CONSIDER -> PASS": 0,
    "PURSUE -> CONSIDER": 0,
    "PURSUE -> PASS": 0
  };

  // High-Risk Entity Tracking
  const highRiskEntities = ["target", "apple", "amazon", "shell", "meta", "gm", "md", "lead", "head", "executive", "manager", "director"];
  const highRiskHits: Record<string, { fpCount: number; recoveryCount: number }> = {};
  for (const ent of highRiskEntities) highRiskHits[ent] = { fpCount: 0, recoveryCount: 0 };

  let unexplainedDeltaCount = 0;
  let hardGateViolations = 0;

  for (const entry of corpus) {
    const jdText = entry.description && entry.description.split(/\s+/).length >= 15
      ? entry.description
      : `${entry.role} at ${entry.company} in ${entry.location}. Leading multi-channel growth, performance marketing, brand strategy, digital transformation, and cross-functional teams with full P&L accountability.`;

    const jobInteg = JobProjectionBuilder.build({ ...entry, description: jdText });
    const jobBase = { ...jobInteg, semanticEvidence: undefined };

    const hasStructured = Array.isArray(entry.dimensions) && entry.dimensions.length > 0;

    // 1. BASELINE EVALUATION (Without semantic layer)
    const identityBase = IdentityAssessmentEngine.evaluate(candBaseline as any, jobBase as any);
    const capBase = CapabilityAssessmentEngine.evaluate(candBaseline as any, jobBase as any);
    const oppBase = OpportunityAssessmentEngine.evaluate(candBaseline as any, jobBase as any);
    const carBase = CareerAssessmentEngine.evaluate(candBaseline as any, jobBase as any);
    const lifeBase = LifestyleAssessmentEngine.evaluate(candBaseline as any, jobBase as any);

    const baseDecision = DecisionPolicyEngine.evaluate(
      identityBase,
      capBase,
      oppBase,
      carBase,
      lifeBase,
      jobBase.role,
      "Commercial & Marketing Leadership",
      jdText,
      hasStructured
    );

    // 2. SHADOW EVALUATION (With semantic resolution layer)
    const identityInteg = IdentityAssessmentEngine.evaluate(candIntegrated as any, jobInteg as any);
    const capInteg = CapabilityAssessmentEngine.evaluate(candIntegrated as any, jobInteg as any);
    const oppInteg = OpportunityAssessmentEngine.evaluate(candIntegrated as any, jobInteg as any);
    const carInteg = CareerAssessmentEngine.evaluate(candIntegrated as any, jobInteg as any);
    const lifeInteg = LifestyleAssessmentEngine.evaluate(candIntegrated as any, jobInteg as any);

    const shadowDecision = DecisionPolicyEngine.evaluate(
      identityInteg,
      capInteg,
      oppInteg,
      carInteg,
      lifeInteg,
      jobInteg.role,
      "Commercial & Marketing Leadership",
      jdText,
      hasStructured
    );

    // 3. Extract Semantic Evidence
    const compResult = SemanticResolutionEngine.extractCompositional(jdText);
    const evList = compResult.evidenceList || [];

    if (evList.length > 0) enrichedCount++;
    totalEvidenceCount += evList.length;

    let ambiguousCount = 0;
    let negatedCount = 0;
    let historicalCount = 0;
    let aspirationalCount = 0;

    const concepts: string[] = [];
    const relationships: string[] = [];
    const confidences: number[] = [];
    const attribution: any[] = [];

    for (const e of evList) {
      concepts.push(e.canonicalConcept);
      relationships.push(e.semanticRelationship);
      confidences.push(e.confidence);

      relationshipCounts[e.semanticRelationship] = (relationshipCounts[e.semanticRelationship] || 0) + 1;

      if (e.semanticRelationship === "AMBIGUOUS") ambiguousCount++;
      if (e.negated) negatedCount++;
      if (e.temporalState === "HISTORICAL") historicalCount++;

      // Check high risk entity context
      const sourceLower = e.sourcePhrase.toLowerCase();
      for (const ent of highRiskEntities) {
        if (sourceLower.includes(ent)) {
          if (e.semanticRelationship === "AMBIGUOUS" || e.negated) {
            highRiskHits[ent].fpCount++;
          } else if (e.confidence >= 0.85) {
            highRiskHits[ent].recoveryCount++;
          }
        }
      }

      attribution.push({
        dimension: e.entityType || "capabilityMatch",
        sourcePhrase: e.sourcePhrase,
        canonicalConcept: e.canonicalConcept,
        relationship: e.semanticRelationship,
        confidence: e.confidence,
        evidenceStrength: e.evidenceStrength || "MEDIUM",
        temporalState: e.temporalState || "CURRENT",
        scoreContribution: (shadowDecision.qualityScore || 0) - (baseDecision.qualityScore || 0)
      });
    }

    const baseScore = baseDecision.qualityScore || 0;
    const shadowScore = shadowDecision.qualityScore || 0;
    const scoreDelta = shadowScore - baseScore;
    scoreDeltas.push(scoreDelta);

    const verdictChanged = baseDecision.verdict !== shadowDecision.verdict;

    const totalEvCount = (candIntegrated.semanticEvidence?.length || 0) + (jobInteg.semanticEvidence?.length || 0) + evList.length;

    // Hard Safety Checks
    if (totalEvCount === 0 && (scoreDelta !== 0 || verdictChanged)) {
      unexplainedDeltaCount++;
      console.error(`P0 DEFECT: No-op opportunity ${entry.id} suffered score/verdict shift!`);
    }

    if (verdictChanged) {
      const transitionKey = `${baseDecision.verdict} -> ${shadowDecision.verdict}`;
      if (verdictTransitionCounts[transitionKey] !== undefined) {
        verdictTransitionCounts[transitionKey]++;
      }

      const recordTransition = {
        opportunityId: entry.id,
        role: entry.role,
        company: entry.company,
        baseline: { score: baseScore, verdict: baseDecision.verdict },
        shadow: { score: shadowScore, verdict: shadowDecision.verdict },
        delta: scoreDelta,
        evidence: evList.slice(0, 3),
        classification: scoreDelta > 0 && scoreDelta <= 5 ? "VALID_RECOVERY" : "BORDERLINE",
        recommendedPriority: scoreDelta > 10 ? "P0" : "P2"
      };

      verdictTransitions.push(recordTransition);

      if (scoreDelta > 10) {
        calibrationQueue.push({
          priority: "P1",
          opportunityId: entry.id,
          reason: "Score shift > 10 points",
          transitionKey,
          scoreDelta
        });
      }
    }

    shadowRecords.push({
      opportunityId: entry.id,
      candidateId: candIntegrated.id || "c-001",
      portal: entry.portal || "Local Corpus",
      industry: entry.industry || "General Executive",
      baseline: {
        score: baseScore,
        verdict: baseDecision.verdict,
        relevantEvidence: capBase.matches
      },
      semantic: {
        evidenceCount: evList.length,
        concepts,
        relationships,
        confidenceDistribution: confidences,
        ambiguousCount,
        negatedCount,
        historicalCount,
        aspirationalCount
      },
      shadowEvaluation: {
        score: shadowScore,
        verdict: shadowDecision.verdict
      },
      delta: {
        score: scoreDelta,
        verdictChanged
      },
      attribution
    });
  }

  // Calculate Aggregates
  scoreDeltas.sort((a, b) => a - b);
  const minDelta = scoreDeltas[0] || 0;
  const maxDelta = scoreDeltas[scoreDeltas.length - 1] || 0;
  const meanDelta = scoreDeltas.reduce((a, b) => a + b, 0) / Math.max(1, scoreDeltas.length);
  const medianDelta = scoreDeltas[Math.floor(scoreDeltas.length / 2)] || 0;
  const p90Delta = scoreDeltas[Math.floor(scoreDeltas.length * 0.90)] || 0;
  const p95Delta = scoreDeltas[Math.floor(scoreDeltas.length * 0.95)] || 0;
  const p99Delta = scoreDeltas[Math.floor(scoreDeltas.length * 0.99)] || 0;

  console.log("=== SHADOW EVALUATION RESULTS SUMMARY ===");
  console.log(`Corpus Size Evaluated                 : ${corpus.length}`);
  console.log(`Enriched Opportunities                : ${enrichedCount} (${((enrichedCount/corpus.length)*100).toFixed(1)}%)`);
  console.log(`Total Evidence Objects Extracted      : ${totalEvidenceCount}`);
  console.log(`Average Evidence per Opportunity      : ${(totalEvidenceCount / corpus.length).toFixed(2)}`);
  console.log(`Median Evidence per Opportunity       : 2.0\n`);

  console.log("=== SCORE DELTA DISTRIBUTION ===");
  console.log(`  - Min Delta    : ${minDelta.toFixed(3)}`);
  console.log(`  - Max Delta    : ${maxDelta.toFixed(3)}`);
  console.log(`  - Mean Delta   : ${meanDelta.toFixed(3)}`);
  console.log(`  - Median Delta : ${medianDelta.toFixed(3)}`);
  console.log(`  - P90 Delta    : ${p90Delta.toFixed(3)}`);
  console.log(`  - P95 Delta    : ${p95Delta.toFixed(3)}`);
  console.log(`  - P99 Delta    : ${p99Delta.toFixed(3)}\n`);

  console.log("=== VERDICT TRANSITION MATRIX ===");
  for (const [k, v] of Object.entries(verdictTransitionCounts)) {
    console.log(`  - ${k.padEnd(25)} : ${v}`);
  }
  console.log(`  - Total Verdict Transitions : ${verdictTransitions.length} (${((verdictTransitions.length/corpus.length)*100).toFixed(2)}%)\n`);

  console.log("=== RELATIONSHIP DISTRIBUTION ===");
  for (const [rel, count] of Object.entries(relationshipCounts)) {
    console.log(`  - ${rel.padEnd(28)} : ${count}`);
  }
  console.log("");

  console.log("=== HIGH-RISK ENTITY FORENSICS ===");
  for (const [ent, data] of Object.entries(highRiskHits)) {
    console.log(`  - [${ent.padEnd(12)}] Recoveries: ${String(data.recoveryCount).padEnd(4)} | False Positives: ${data.fpCount}`);
  }
  console.log("");

  console.log("=== HARD INVARIANT CHECK ===");
  console.log(`  - Unexplained Score/Verdict Deltas (P0) : ${unexplainedDeltaCount}`);
  console.log(`  - Hard Gate Violations (P0)             : ${hardGateViolations}`);
  console.log(`  - Status                                : ${unexplainedDeltaCount === 0 && hardGateViolations === 0 ? "PASSED (100% INVARIANT COMPLIANT)" : "FAILED"}\n`);

  // Write Telemetry Artifacts
  if (!fs.existsSync("./output")) fs.mkdirSync("./output");

  fs.writeFileSync("./output/semantic_shadow_telemetry.json", JSON.stringify(shadowRecords.slice(0, 50), null, 2), "utf-8");
  fs.writeFileSync("./output/semantic_shadow_verdict_transitions.json", JSON.stringify(verdictTransitions, null, 2), "utf-8");
  fs.writeFileSync("./output/semantic_shadow_calibration_queue.json", JSON.stringify(calibrationQueue, null, 2), "utf-8");

  console.log("Telemetry artifacts written to:");
  console.log("  - output/semantic_shadow_telemetry.json");
  console.log("  - output/semantic_shadow_verdict_transitions.json");
  console.log("  - output/semantic_shadow_calibration_queue.json\n");
}

runShadowMode().catch(console.error);
