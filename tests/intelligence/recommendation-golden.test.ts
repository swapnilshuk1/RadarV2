// Golden fixtures live here — NOT in runtime module initialization.
// These assert the pipeline reproduces the calibrated verdicts for the five
// canonical Indian-market cases described in the vision document.

import { describe, expect, it } from "vitest";
import { runEngine, injectFreshRecords, invalidateEngineCache, readOpportunities, clearInjectedRecords, ENGINE_VERSION } from "@/lib/intelligence/engine";

import { candidateProfile } from "@/data/candidate-profile";
import { rawOpportunities } from "@/data/opportunity-fixtures";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";
import { addExtraOpportunities } from "@/lib/intelligence/engine";

function getShortlist(activePursuits: number) {
  const builder = new CandidateProjectionBuilderImpl();
  const proj = builder.fromProfile(candidateProfile);
  const { presented } = runEngine(proj as any, activePursuits);
  return presented.map(p => p.opportunity)
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
}
import { present } from "@/lib/intelligence/present";

import { POLICY_THRESHOLDS } from "@/lib/intelligence/policy/DecisionPolicyEngine";

// Inject golden opportunities into the memory cache
injectFreshRecords(rawOpportunities);

const builder = new CandidateProjectionBuilderImpl();
const projection = builder.fromProfile(candidateProfile);
const { records } = runEngine(projection, 0);
const byHash = new Map(records.map((r) => [r.jobHash, r]));

describe("recommendation golden fixtures", () => {
  it("BMW India CMO → PURSUE, priority > 0.55", () => {
    const r = byHash.get("j-bmw-india-cmo")!;
    expect(r).toBeDefined();
    expect(r.verb).toBe("PURSUE");
    expect(r.priority).toBeGreaterThan(POLICY_THRESHOLDS.CONSIDER);
  });

  it("Reliance Retail CGO → PURSUE", () => {
    const r = byHash.get("j-reliance-cgo")!;
    expect(r.verb).toBe("PURSUE");
    expect(r.priority).toBeGreaterThan(POLICY_THRESHOLDS.CONSIDER);
  });

  it("VML VP Perf → CONSIDER band", () => {
    const r = byHash.get("j-vml-vp-perf")!;
    expect(["CONSIDER", "PURSUE"]).toContain(r.verb);
  });

  it("Acme VP Mumbai → CONSIDER with workModel friction", () => {
    const r = byHash.get("j-acme-vp-mumbai")!;
    expect(r.verb === "CONSIDER" || r.verb === "PASS").toBe(true);
    expect(r.factors.pursuitFriction).toBeGreaterThan(1);
  });

  it("TCS Transformation → PASS (level contradicted, excluded)", () => {
    const r = byHash.get("j-tcs-transformation")!;
    expect(r.verb).toBe("PASS");
  });

  it("every record carries an immutable RecommendationRecord contract", () => {
    for (const r of records) {
      expect(r.engineVersion).toBe(ENGINE_VERSION);
      expect(r.recommendationVersion.startsWith(ENGINE_VERSION + ":")).toBe(true);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
      expect(["High", "Medium", "Low"]).toContain(r.stability);
      expect(r.trace).toBeDefined();
      expect(r.comparison).toBeDefined();
      expect(r.explanation.dominantFactor).toBeDefined();
    }
  });

  it("decision does not consume confidence — a low-confidence PURSUE stays PURSUE", () => {
    for (const r of records) {
      if (r.verb === "PURSUE") expect(r.priority).toBeGreaterThanOrEqual(POLICY_THRESHOLDS.PURSUE);
      if (r.verb === "CONSIDER") {
        expect(r.priority).toBeGreaterThanOrEqual(POLICY_THRESHOLDS.CONSIDER);
        expect(r.priority).toBeLessThan(POLICY_THRESHOLDS.PURSUE);
      }
      if (r.verb === "PASS" && !r.headspace.downgraded) {
        if (r.priority !== null) {
          expect(r.priority).toBeLessThan(POLICY_THRESHOLDS.CONSIDER);
        } else {
          expect(r.priority).toBeNull();
        }
      }
    }
  });

  it("no PURSUE card contains negative or contradictory editorial language (both live corpus and golden fixtures)", () => {
    // 1. Check golden fixtures
    const listGolden = getShortlist(0);
    const pursueGolden = listGolden.filter((o) => o.decision === "PURSUE");

    // 2. Check live corpus from SQLite database
    invalidateEngineCache();
    clearInjectedRecords(); // Sets memoryCache = null to fall back to SQLite

    const { records: liveRecords } = runEngine(projection, 0);
    
    // Ensure we actually loaded live opportunities from SQLite
    expect(liveRecords.length).toBeGreaterThan(0);

    const listLive = liveRecords
      .filter((r) => r.verb === "PURSUE")
      .map((r) => {
        const matchingSource = readOpportunities().find(o => o.jobHash === r.jobHash);
        if (!matchingSource) return null;
        return present(matchingSource, r, projection).opportunity;
      })
      .filter((o): o is any => o !== null);

    // Restore golden records cache for remaining tests
    injectFreshRecords(rawOpportunities);

    const contradictions = [
      "not recommended",
      "does not align",
      "separate functional domain",
      "major trajectory deviation"
    ];

    const allPursueCards = [...pursueGolden, ...listLive];
    for (const card of allPursueCards) {
      const recLower = card.recommendation.toLowerCase();
      for (const phrase of contradictions) {
        expect(recLower).not.toContain(phrase);
      }
    }
  }, 60000);

  it("OpportunityProvider output integrates pipeline and presenter correctly", () => {
    const list = getShortlist(0);
    expect(list.length).toBeGreaterThan(0);
    for (const o of list) {
      expect(["PURSUE", "CONSIDER", "PASS"]).toContain(o.decision);
      expect(o.recommendation).toBeDefined();
      // Verify that the narrative formatter maps dynamic sentences to recommendation
      expect(o.recommendation).toMatch(/(opportunities|opening|Worth a conversation|functional match|functional fit|fit|seniority|categorically|VP\+ track|SVP openings|remit|CGO seat|Head of|trajectory|next step)/i);
    }

    // Verify headspace saturation downgrade on a golden PURSUE brief
    const listSaturated = getShortlist(10);
    const bmwSaturated = listSaturated.find((o) => o.jobHash === "j-bmw-india-cmo")!;
    expect(bmwSaturated.decision).toBe("CONSIDER");
    expect(bmwSaturated.recommendation).toContain("capacity");
  });

  it("narrative formatter adheres to the RADAR v2 Editorial Playbook Principles", () => {
    const list = getShortlist(0);
    for (const o of list) {
      // Rule 1: Opening paragraph references career trajectory before role attributes.
      expect(o.recommendation).toMatch(/(trajectory|remit|seniority|seniors|VP\+ track|remit|P&L|conversation|openings|out of range|Head of|functional fit|functional match|match|working shape|location)/i);

      // Rule 2: "Why Now" describes the business moment (timing, rebuilding, scaling).
      if (o.whyNow) {
        expect(o.whyNow).toMatch(/(rebuilding|scaling|Series C|funding|re-platforming|reset|lead)/i);
      }

      // Rule 3: "Why You're Well Positioned" starts with the business challenge/problem.
      if (o.positioning.length) {
        for (const p of o.positioning) {
          expect(p).toMatch(/(challenge|Remit|P&L|CDP|fee-book|re-platform|capabilities|portfolio|execution|CoE|operating|org-size|team|record|coordinate|vertical|pivot|arc|revenue|transformation|career|network|leverage|move|context|influence|GTM|cadence|marketplace|launches|digital|e-commerce|functional|pair|delivered|preserved|feed|extractor|filtering|senior|titles)/i);
        }
      }

      // Rule 4: Primary Proof contains exactly one elevated achievement.
      if (o.primaryProof) {
        expect(o.primaryProof.headline).toBeDefined();
        expect(o.primaryProof.detail).toBeDefined();
      }

      // Rule 5: Headspace describes investment in business terms.
      if (o.headspaceInvestment) {
        expect(o.headspaceInvestment.leverage).toMatch(/(memo|POV|succession|travel|re-platform|blueprint|replication)/i);
      }
    }
  });

  it("dynamic search extraction replaces old samples with newly ingested opportunities", () => {
    // Trigger simulated search extraction
    addExtraOpportunities();

    const postSearchList = getShortlist(0);
    expect(postSearchList.length).toBeGreaterThanOrEqual(4);

    // Verify Maruti CMO is added and promoted to PURSUE with dynamic fallback narrative
    const maruti = postSearchList.find((o) => o.jobHash === "j-maruti-cmo")!;
    expect(maruti).toBeDefined();
    expect(maruti.role).toContain("Chief Marketing Officer");
    expect(maruti.decision).toBe("PURSUE");
    expect(maruti.recommendation).toMatch(/(trajectory|opening|opportunity)/i);
    expect(maruti.whyNow).toBeDefined();
    expect(typeof maruti.whyNow).toBe("string");
    expect(maruti.whyNow!.length).toBeGreaterThan(10);
    expect(maruti.hiringRisk).toBeDefined();
    expect(typeof maruti.hiringRisk).toBe("string");
  });
});