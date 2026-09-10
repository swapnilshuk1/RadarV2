import { describe, it, expect } from "vitest";

describe("Scheduler Yield Separation Invariant", () => {
  interface YieldEvaluationInput {
    sourceDiscoveryYield: number; // cards.length discovered from portal
    downstreamAdmissionYield: number; // novelAccepted
    minSourceDiscoveryPerPage?: number;
    maxConsecutiveLowYield?: number;
    currentStreak?: number;
  }

  function evaluateYield({
    sourceDiscoveryYield,
    downstreamAdmissionYield: _downstreamAdmissionYield,
    minSourceDiscoveryPerPage = 2,
    maxConsecutiveLowYield = 2,
    currentStreak = 0,
  }: YieldEvaluationInput) {
    const isSourceLowYield = sourceDiscoveryYield < minSourceDiscoveryPerPage;
    const newStreak = isSourceLowYield ? currentStreak + 1 : 0;
    const shouldStop = newStreak >= maxConsecutiveLowYield;
    const decision = shouldStop ? "STOP" : "CONTINUE";
    const reason = shouldStop
      ? "consecutive_low_yield_page"
      : isSourceLowYield
      ? "LowSourceDiscoveryYield"
      : "DiscoveryRateAboveThreshold";

    return {
      isSourceLowYield,
      streak: newStreak,
      decision,
      reason,
      concludedSourceExhausted: shouldStop,
    };
  }

  it("does not conclude source exhausted when 60 cards are discovered but 0 are admitted downstream", () => {
    // 60 unique cards scraped from Naukri, but all 60 are already in ledger or filtered
    const result = evaluateYield({
      sourceDiscoveryYield: 60,
      downstreamAdmissionYield: 0,
      currentStreak: 1, // had a prior low yield
    });

    expect(result.isSourceLowYield).toBe(false);
    expect(result.streak).toBe(0); // Resets streak
    expect(result.decision).toBe("CONTINUE");
    expect(result.reason).toBe("DiscoveryRateAboveThreshold");
    expect(result.concludedSourceExhausted).toBe(false);
  });

  it("separates portal starvation from candidate filtering", () => {
    // Case A: 25 cards from Indeed, 0 new candidates admitted
    const caseA = evaluateYield({
      sourceDiscoveryYield: 25,
      downstreamAdmissionYield: 0,
      currentStreak: 0,
    });
    expect(caseA.isSourceLowYield).toBe(false);
    expect(caseA.decision).toBe("CONTINUE");

    // Case B: Truly starved portal (0 cards returned due to blank DOM / blocked page)
    const caseB1 = evaluateYield({
      sourceDiscoveryYield: 0,
      downstreamAdmissionYield: 0,
      currentStreak: 0,
    });
    expect(caseB1.isSourceLowYield).toBe(true);
    expect(caseB1.streak).toBe(1);
    expect(caseB1.decision).toBe("CONTINUE");

    // Second consecutive starved page triggers genuine source exhaustion
    const caseB2 = evaluateYield({
      sourceDiscoveryYield: 1, // 1 card < min threshold of 2
      downstreamAdmissionYield: 0,
      currentStreak: caseB1.streak,
    });
    expect(caseB2.isSourceLowYield).toBe(true);
    expect(caseB2.streak).toBe(2);
    expect(caseB2.decision).toBe("STOP");
    expect(caseB2.reason).toBe("consecutive_low_yield_page");
    expect(caseB2.concludedSourceExhausted).toBe(true);
  });

  describe("Gate 4 Unique Portal Identity Yield Computation", () => {
    function computeSourceDiscoveryYield(cards: Array<{ detailUrl?: string; cardHash: string }>): number {
      const uniqueSourceIdentities = new Set<string>();
      for (const card of cards) {
        const identity = (card.detailUrl ? card.detailUrl.split("?")[0].split("#")[0].toLowerCase().trim() : "") || card.cardHash;
        if (identity) {
          uniqueSourceIdentities.add(identity);
        }
      }
      return uniqueSourceIdentities.size;
    }

    it("Case A: 60 unique source identities, 0 downstream admissions => NOT source-low-yield", () => {
      const cards = Array.from({ length: 60 }, (_, i) => ({
        detailUrl: `https://www.naukri.com/job-${i + 1}?src=search`,
        cardHash: `hash-${i + 1}`,
      }));
      const sourceDiscoveryYield = computeSourceDiscoveryYield(cards);
      expect(sourceDiscoveryYield).toBe(60);

      const res = evaluateYield({
        sourceDiscoveryYield,
        downstreamAdmissionYield: 0,
      });
      expect(res.isSourceLowYield).toBe(false);
      expect(res.decision).toBe("CONTINUE");
    });

    it("Case B: 60 raw records, only 1 unique portal identity => source yield = 1 => low-yield triggers", () => {
      // 60 raw records that all point to the same underlying job identity with varying tracking parameters
      const cards = Array.from({ length: 60 }, (_, i) => ({
        detailUrl: `https://www.naukri.com/job-123456?trackingParam=${i}&utm_source=feed`,
        cardHash: `hash-dup-${i}`,
      }));
      const sourceDiscoveryYield = computeSourceDiscoveryYield(cards);
      expect(sourceDiscoveryYield).toBe(1);

      const res = evaluateYield({
        sourceDiscoveryYield,
        downstreamAdmissionYield: 0,
        minSourceDiscoveryPerPage: 2,
      });
      expect(res.isSourceLowYield).toBe(true);
      expect(res.streak).toBe(1);
    });

    it("Case C: many canonical/ledger-known jobs, but 60 distinct source identities => still high SOURCE yield", () => {
      const cards = Array.from({ length: 60 }, (_, i) => ({
        detailUrl: `https://www.naukri.com/historical-job-${i + 1}?ref=search`,
        cardHash: `hist-hash-${i + 1}`,
      }));
      const sourceDiscoveryYield = computeSourceDiscoveryYield(cards);
      expect(sourceDiscoveryYield).toBe(60);

      // Downstream: 0 novel admissions (all 60 known in ledger)
      const res = evaluateYield({
        sourceDiscoveryYield,
        downstreamAdmissionYield: 0,
      });
      expect(res.isSourceLowYield).toBe(false);
      expect(res.streak).toBe(0);
      expect(res.decision).toBe("CONTINUE");
    });
  });
});
