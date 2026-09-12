// typescript tests/architecture-contracts-strong.test.ts
/**
 * Phase-0 Strong Architecture Contract Tests — hardened shortlist/ranking/cache checks.
 *
 * Read-only. Run with:
 *   npm ci
 *   npx vitest run tests/architecture-contracts-strong.test.ts
 *
 * Failures form the authoritative Phase-0 scorecard.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { runEngine, readOpportunities, injectFreshRecords, clearInjectedRecords, computeEvaluationSignature, invalidateEngineCache, ENGINE_VERSION } from "@/lib/intelligence/engine";
import { present } from "@/lib/intelligence/present";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "@/data/candidate-profile";
import { CapabilityAssessmentEngine } from "@/lib/intelligence/engines/CapabilityAssessmentEngine";
import decisionPolicy from "@/data/ontology/decision_policy.json";
import { POLICY_THRESHOLDS } from "@/lib/intelligence/policy/DecisionPolicyEngine";

function deepClone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

function canonicalDecisionPackage(r: any) {
  return {
    recommendation: r.verb ?? null,
    evaluationStatus: r.evaluationStatus ?? null,
    priority: r.priority ?? null,
    confidence: r.confidence ?? null,
    evidenceSufficiency: r.evidenceSufficiency ?? null,
    vetoed: r.vetoed ?? false,
    vetoReason: r.vetoReason ?? null,
    policySignature: r.policySignature ?? r.recommendationVersion ?? null,
    candidateProjectionHash: r.trace?.candidateProjectionHash ?? null,
    opportunityContentHash: r.trace?.opportunityContentHash ?? null,
  };
}

describe("Phase-0 Strong Architecture Contract Tests — Hardened", () => {

  // --- Evidence & provenance checks (unchanged from stronger harness) ---
  it("Evidence purity: synthetic contamination fixture ensures rawText is verbatim", () => {
    const syntheticSource = {
      jobHash: "tst-synthetic-1",
      role: "Chief Marketing Officer",
      company: "TestCo",
      rawText: "Chief Marketing Officer responsible for growth.",
      dimensions: [
        {
          key: "pl_ownership",
          jdEvidence: {
            status: "Explicit",
            value: "Owns P&L",
            evidence: [{ quote: "Owns P&L", provenance: "fixture" }]
          }
        }
      ],
      originalOpportunity: { sourcePayload: "Chief Marketing Officer responsible for growth." }
    } as any;

    injectFreshRecords([syntheticSource]);
    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile(candidateProfile);
    runEngine(projection, 0);

    const ops = readOpportunities();
    const op = ops.find((o: any) => o.jobHash === syntheticSource.jobHash);
    expect(op).toBeDefined();
    const raw = (op as any).rawText || (op as any).description || "";
    expect(raw).toBe("Chief Marketing Officer responsible for growth.");

    clearInjectedRecords();
  });

  it("Provenance: structured quotes must be in rawText or have explicit provenance", () => {
    const ops = readOpportunities();
    for (const o of ops) {
      const rawText: string = String((o as any).rawText || (o as any).description || (o as any).normalizedText || `${(o as any).role || ""} ${(o as any).company || ""} ${(o as any).location || ""}`);
      const dims = (o as any).dimensions || [];
      for (const d of dims) {
        const evs = d?.jdEvidence?.evidence || [];
        for (const ev of evs) {
          const quote = String(ev?.quote || "").trim();
          if (!quote) continue;
          const nRaw = rawText.toLowerCase().replace(/\s+/g, " ");
          const nQuote = quote.toLowerCase().replace(/\s+/g, " ");
          const foundInRaw = nRaw.includes(nQuote);
          const hasProvenance = !!(ev?.provenance || ev?.source || d?.jdEvidence?.source);
          expect(foundInRaw || hasProvenance).toBe(true);
        }
      }
    }
  });

  // --- Candidate causality (hardened) ---
  it("Candidate causality: candidate projection hash & record.trace.candidateProjectionHash must reflect changes", () => {
    const builder = new CandidateProjectionBuilderImpl();
    const projA = builder.fromProfile(candidateProfile);
    const projB = deepClone(projA);
    projB.executiveThemes = [...(projB.executiveThemes || []), "MUTATION_X"];

    const ops = readOpportunities();
    if (ops.length === 0) {
      // if no corpus, skip (explicit)
      return;
    }
    const job = ops[0];
    const jobHash = job.jobHash;

    // Compute signature variation (sanity)
    const sA = computeEvaluationSignature(jobHash, (projA as any).updatedAt || "v1", "ov", ENGINE_VERSION, "policy-x", JSON.stringify(projA), "opp-x");
    const sB = computeEvaluationSignature(jobHash, (projB as any).updatedAt || "v1", "ov", ENGINE_VERSION, "policy-x", JSON.stringify(projB), "opp-x");
    expect(sA).not.toBe(sB);

    // Run engine and check trace presence
    const { records: recA } = runEngine(projA as any, 0);
    const { records: recB } = runEngine(projB as any, 0);

    const rA = recA.find(r => r.jobHash === jobHash);
    const rB = recB.find(r => r.jobHash === jobHash);
    // must have traces containing candidateProjectionHash & opportunityContentHash
    const anyRec = rA || rB;
    if (anyRec) {
      expect(anyRec.trace).toBeDefined();
      expect(anyRec.trace.candidateProjectionHash).toBeDefined();
      expect(anyRec.trace.opportunityContentHash).toBeDefined();
    }

    // If both exist, canonical packages should reflect that a candidate change could change the record
    if (rA && rB) {
      const pkgA = canonicalDecisionPackage(rA);
      const pkgB = canonicalDecisionPackage(rB);
      // They may be identical for unrelated jobs but capture candidateProjectionHash difference
      expect(pkgA.candidateProjectionHash).not.toBe(pkgB.candidateProjectionHash);
    }
  });

  // --- Capability UNKNOWN stronger check ---
  it("Capability UNKNOWN: EMPTY_CAPABILITIES must not hide unknown as numeric 0.50", () => {
    const fakeJob = { jobHash: "fake-no-cap", role: "Test", company: "X", originalOpportunity: {}, capabilities: [] } as any;
    const builder = new CandidateProjectionBuilderImpl();
    const cand = builder.fromProfile(candidateProfile) as any;
    const assessment = CapabilityAssessmentEngine.evaluate(cand, fakeJob);
    if (assessment.evidenceState === "UNAVAILABLE") {
      expect(assessment.overallFit).not.toBeCloseTo(0.50);
    } else {
      expect(["UNAVAILABLE", "PARTIAL", "SUFFICIENT"].includes(assessment.evidenceState as any)).toBe(true);
    }
  });

  // --- Decision determinism (compare full canonical package across repeated runs) ---
  it("Decision determinism: identical inputs must produce identical canonical decision packages", () => {
    const builder = new CandidateProjectionBuilderImpl();
    const proj = builder.fromProfile(candidateProfile);
    const run1 = runEngine(proj as any, 0);
    const run2 = runEngine(proj as any, 0);

    const map1 = new Map(run1.records.map(r => [r.jobHash, canonicalDecisionPackage(r)]));
    const map2 = new Map(run2.records.map(r => [r.jobHash, canonicalDecisionPackage(r)]));

    for (const [k, v] of map1) {
      expect(JSON.stringify(map2.get(k))).toBe(JSON.stringify(v));
    }
  });

  // --- Cache mutation & cold-start / restart test (hardened) ---
  it("Cache correctness: changing candidate must not return stale cached A; restart reproduces B", () => {
    const builder = new CandidateProjectionBuilderImpl();
    const projA = builder.fromProfile(candidateProfile);
    const projB = deepClone(projA);
    projB.executiveThemes = [...(projB.executiveThemes || []), "CACHE_MUTATION_TEST"];
    // Run with projA
    invalidateEngineCache(); // ensure clean start
    const { records: recA } = runEngine(projA as any, 0);
    // Choose a sample job (if none available, skip)
    const ops = readOpportunities();
    if (ops.length === 0) return;
    const jobHash = ops[0].jobHash;
    const rA = recA.find(r => r.jobHash === jobHash);

    // Run with projB without clearing caches -> engine should compute new signature (candidate hash included) so result should not equal rA
    const { records: recB } = runEngine(projB as any, 0);
    const rB = recB.find(r => r.jobHash === jobHash);
    // We require that either recommendationVersion or priority differs (or candidateProjectionHash differs)
    let different = false;
    if (rA && rB) {
      if (rA.recommendationVersion !== rB.recommendationVersion) different = true;
      if ((rA.priority ?? null) !== (rB.priority ?? null)) different = true;
      if ((rA.trace?.candidateProjectionHash ?? null) !== (rB.trace?.candidateProjectionHash ?? null)) different = true;
    }
    expect(different).toBe(true);

    // Now simulate restart: clear caches and re-run with projB -> should reproduce rB
    invalidateEngineCache();
    const { records: recB2 } = runEngine(projB as any, 0);
    const rB2 = recB2.find(r => r.jobHash === jobHash);
    if (rB && rB2) {
      expect(rB2.recommendationVersion).toBe(rB.recommendationVersion);
      expect(rB2.priority).toBe(rB.priority);
      expect(rB2.trace?.candidateProjectionHash).toBe(rB.trace?.candidateProjectionHash);
    }
  });

  // --- Presenter fidelity (unchanged but kept strict) ---
  it("Presenter fidelity: present() must render the same decision/score/status/veto as record", () => {
    const builder = new CandidateProjectionBuilderImpl();
    const proj = builder.fromProfile(candidateProfile);
    const { records } = runEngine(proj as any, 0);
    const ops = readOpportunities();
    const recMap = new Map(records.map(r => [r.jobHash, r]));

    for (const src of ops) {
      const rec = recMap.get(src.jobHash);
      if (!rec) continue;
      const pres = present(src as any, rec, proj as any);
      expect(pres.record.verb).toBe(pres.opportunity.decision);
      const rp = rec.vetoed ? null : (rec.qualityScore ?? rec.priority ?? null);
      const uiScore = pres.opportunity.recommendationResult?.score ?? null;
      if (rp === null || rec.vetoed) {
        expect(uiScore === null || uiScore === 0 || uiScore === undefined).toBe(true);
      } else {
        expect(Number(uiScore)).toBe(Math.round(Number(rp)));
      }
      expect(Boolean(pres.record.vetoed)).toBe(Boolean(pres.opportunity.recommendationResult?.vetoed ?? false));
    }
  });

  // --- Shortlist & ranking integrity (HARDENED)
  it("Shortlist fidelity & ranking isolation: shortlist items must carry record trace fields and SPARSE_SPEC cannot be in scored ranking", () => {
    const builder = new CandidateProjectionBuilderImpl();
    const proj = builder.fromProfile(candidateProfile);
    const engine = runEngine(proj as any, 0);
    const shortlist = engine.presented.map(p => p.opportunity)
      .filter(o => o.decision !== "PASS")
      .sort((a, b) => {
        const decisionRank: Record<string, number> = { PURSUE: 0, CONSIDER: 1, PASS: 2 };
        const tierDiff = (decisionRank[a.decision] ?? 3) - (decisionRank[b.decision] ?? 3);
        if (tierDiff !== 0) return tierDiff;
        const scoreA = a.recommendationResult?.score ?? null;
        const scoreB = b.recommendationResult?.score ?? null;
        if (scoreA !== null && scoreB !== null) return scoreB - scoreA;
        if (scoreA !== null) return -1;
        if (scoreB !== null) return 1;
        return a.jobHash.localeCompare(b.jobHash);
      });
    expect(Array.isArray(shortlist)).toBe(true);
    const recMap = new Map(engine.records.map(r => [r.jobHash, r]));

    // Build scoredRanking per desired invariant: only evaluated & recommendation in {PURSUE, CONSIDER, PASS} & priority != null
    const scoredRanking = shortlist.filter(item => {
      const p = item.recommendationResult;
      return p && typeof p.score === "number" && p.score !== null;
    });

    for (const item of shortlist) {
      // Each shortlist item must carry jobHash and the trace metadata (policySignature/recommendationVersion & candidateProjectionHash & evaluationStatus & priority & vetoed)
      expect(item.jobHash).toBeDefined();
      expect(item.recommendationResult).toBeDefined();
      const rec = recMap.get(item.jobHash);
      // There must be an originating record; if not, it's suspect
      expect(rec).toBeDefined();
      if (!rec) continue;

      // The shortlist object MUST carry the trace fields and they must match the record
      // Accept either policySignature or recommendationVersion for policy linkage
      const uiPolicy = item.recommendationResult?.policyVersion ?? item.recommendationVersion ?? null;
      const recordPolicy = rec.policySignature ?? rec.recommendationVersion ?? null;
      expect(recordPolicy).toBeDefined();
      expect(uiPolicy === recordPolicy || item.recommendationVersion === rec.recommendationVersion).toBe(true);

      const uiCandHash = item.recommendationResult?.policyVersion ? item.recommendationResult?.candidateProjectionHash : (item.candidateProjectionHash ?? null);
      // record.trace.candidateProjectionHash must exist
      expect(rec.trace?.candidateProjectionHash).toBeDefined();
      // If shortlist exposes candidateProjectionHash, they must match
      if (item.candidateProjectionHash) {
        expect(item.candidateProjectionHash).toBe(rec.trace.candidateProjectionHash);
      }

      // evaluationStatus parity if provided
      if (item.diligenceStatus) {
        // Map UI status to record.evaluationStatus if possible and assert equality for fidelity
        const uiStatus = item.diligenceStatus;
        const recordStatus = rec.diligenceStatus || rec.evaluationStatus || rec.verb;
        // When defined, these must align (test expects alignment)
        expect(recordStatus).toBeDefined();
        // best-effort compare
        if (recordStatus) {
          expect(uiStatus.toLowerCase().includes(String(recordStatus).toLowerCase()) || uiStatus === recordStatus).toBe(true);
        }
      }

      // SPARSE_SPEC must NOT be present in scoredRanking
      if (rec.evaluationStatus === "SPARSE_SPEC") {
        const inScored = scoredRanking.some(s => s.jobHash === item.jobHash);
        expect(inScored).toBe(false);
      }

      // finally, if rec.priority is null -> UI must not present numeric score or ranking position
      if (rec.priority === null) {
        const uiScore = item.recommendationResult?.score ?? null;
        expect(uiScore === null || uiScore === 0 || uiScore === undefined).toBe(true);
      }
    }
  });

  // --- M5.5 Durable Architectural Isolation Contract ---
  it("M5.5 Contract: OpportunityService.listForUser MUST NOT import runEngine, call runEngine, call OpportunityProvider, or synchronously evaluate the corpus", () => {
    const serviceFilePath = path.resolve(process.cwd(), "src/lib/intelligence/opportunity-service.ts");
    const serviceContent = fs.readFileSync(serviceFilePath, "utf8");

    // 1. MUST NOT import bulk runEngine (only runEngineSingle is permitted for deferred single-item evaluation)
    expect(serviceContent).not.toMatch(/import\s+[^;]*\brunEngine\b[^;]*from/);

    // 2. MUST NOT call bulk runEngine()
    expect(serviceContent).not.toMatch(/\brunEngine\s*\(/);

    // 3. MUST NOT import or reference legacy OpportunityProvider
    expect(serviceContent).not.toContain("OpportunityProvider");

    // 4. listForUser implementation MUST NOT perform synchronous engine runs
    const listForUserMatch = serviceContent.match(/static\s+async\s+listForUser\s*\([^)]*\)\s*:\s*Promise<Opportunity\[\]>\s*\{([\s\S]*?)\n\s*static\s+async\s+getForUser/);
    expect(listForUserMatch).not.toBeNull();
    const listForUserBody = listForUserMatch![1];

    expect(listForUserBody).not.toContain("runEngine");
    expect(listForUserBody).not.toContain("OpportunityProvider");
    expect(listForUserBody).toMatch(/repos\.canonicalServing\.listOpportunities|repos\.evaluations\.listEvaluationsForUser/);
  });

});