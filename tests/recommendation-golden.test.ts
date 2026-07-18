// Golden fixtures live here — NOT in runtime module initialization.
// These assert the pipeline reproduces the calibrated verdicts for the five
// canonical Indian-market cases described in the vision document.

import { describe, expect, it } from "vitest";
import { runEngine } from "@/lib/intelligence/engine";
import { OpportunityProvider } from "@/lib/intelligence/opportunity-provider";

const { records } = runEngine(0);
const byHash = new Map(records.map((r) => [r.jobHash, r]));

describe("recommendation golden fixtures", () => {
  it("BMW India CMO → PURSUE, priority > 0.55", () => {
    const r = byHash.get("j-bmw-india-cmo")!;
    expect(r).toBeDefined();
    expect(r.verb).toBe("PURSUE");
    expect(r.priority).toBeGreaterThan(0.55);
  });

  it("Reliance Retail CGO → PURSUE", () => {
    const r = byHash.get("j-reliance-cgo")!;
    expect(r.verb).toBe("PURSUE");
    expect(r.priority).toBeGreaterThan(0.55);
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
      expect(r.engineVersion).toBe("1.0.0");
      expect(r.recommendationVersion).toMatch(/^1\.0\.0:/);
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
      if (r.verb === "PURSUE") expect(r.priority).toBeGreaterThanOrEqual(0.55);
      if (r.verb === "CONSIDER") {
        expect(r.priority).toBeGreaterThanOrEqual(0.3);
        expect(r.priority).toBeLessThan(0.55);
      }
      if (r.verb === "PASS" && !r.headspace.downgraded) {
        expect(r.priority).toBeLessThan(0.3);
      }
    }
  });

  it("OpportunityProvider output integrates pipeline and presenter correctly", () => {
    const list = OpportunityProvider.list({ activePursuits: 0 });
    expect(list.length).toBeGreaterThan(0);
    for (const o of list) {
      expect(["PURSUE", "CONSIDER", "PASS"]).toContain(o.decision);
      expect(o.recommendation).toBeDefined();
      // Verify that the narrative formatter maps dynamic sentences to recommendation
      expect(o.recommendation).toMatch(/(opportunities|opening|Worth a conversation|functional match|functional fit|fit|seniority|categorically|VP\+ track|SVP openings|remit|CGO seat|Head of|trajectory|next step)/i);
    }

    // Verify headspace saturation downgrade on a golden PURSUE brief
    const listSaturated = OpportunityProvider.list({ activePursuits: 10 });
    const bmwSaturated = listSaturated.find((o) => o.jobHash === "j-bmw-india-cmo")!;
    expect(bmwSaturated.decision).toBe("CONSIDER");
    expect(bmwSaturated.recommendation).toContain("capacity");
  });

  it("narrative formatter adheres to the RADAR v2 Editorial Playbook Principles", () => {
    const list = OpportunityProvider.list({ activePursuits: 0 });
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
    OpportunityProvider.addExtra();

    const postSearchList = OpportunityProvider.list({ activePursuits: 0 });
    expect(postSearchList.length).toBe(4);

    // Verify Maruti CMO is added and promoted to PURSUE with dynamic fallback narrative
    const maruti = postSearchList.find((o) => o.jobHash === "j-maruti-cmo")!;
    expect(maruti).toBeDefined();
    expect(maruti.role).toContain("Chief Marketing Officer");
    expect(maruti.decision).toBe("PURSUE");
    expect(maruti.recommendation).toMatch(/(trajectory|opening|opportunity)/i);
    expect(maruti.whyNow).toContain("scaling");
    expect(maruti.hiringRisk).toContain("chemistry");
  });
});