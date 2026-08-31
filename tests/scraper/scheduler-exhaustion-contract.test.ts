import { describe, it, expect, beforeEach } from "vitest";
import { QueryMetricsStore } from "../../scripts/scraper/run/metrics";
import type { AcquisitionOutcome } from "../../scripts/scraper/types";

describe("Scheduler Exhaustion vs Transport Failure Contract", () => {
  beforeEach(() => {
    (QueryMetricsStore as any).records = [];
  });

  it("permits SUCCESS_EMPTY to inform query novelty & corpus exhaustion", () => {
    const portal = "Naukri";
    const query = "VP Transformers";

    // Run 1: Returns 20 cards, all duplicates (0 novel)
    QueryMetricsStore.record({
      runId: "run-exhaust-1",
      portal,
      query,
      page: 1,
      cardsSeen: 20,
      cardsParsed: 20,
      canonicalDuplicates: 20,
      ledgerKnown: 20,
      hardFiltered: 0,
      identityFailed: 0,
      novelAccepted: 0,
      novelAcquired: 0,
      noveltyRate: 0.0,
      elapsedMs: 1200,
      timestamp: new Date().toISOString(),
      outcome: "SUCCESS",
      hasTransportError: false
    });

    // Run 2: Clean search page returns 0 cards (corpus genuinely exhausted)
    QueryMetricsStore.record({
      runId: "run-exhaust-2",
      portal,
      query,
      page: 2,
      cardsSeen: 0,
      cardsParsed: 0,
      canonicalDuplicates: 0,
      ledgerKnown: 0,
      hardFiltered: 0,
      identityFailed: 0,
      novelAccepted: 0,
      novelAcquired: 0,
      noveltyRate: 0.0,
      elapsedMs: 1000,
      timestamp: new Date().toISOString(),
      outcome: "SUCCESS_EMPTY",
      hasTransportError: false
    });

    // INVARIANT: When valid runs yield 0 novel jobs, novelty is 0.0, allowing pruning
    const avgNovelty = QueryMetricsStore.getAverageNoveltyRate(portal, query);
    expect(avgNovelty).toBe(0.0);
    expect(avgNovelty).toBeLessThan(0.05); // Eligible for pruning
  });

  const failureOutcomes: AcquisitionOutcome[] = [
    "TRANSPORT_ERROR",
    "AUTH_ERROR",
    "ANTI_BOT",
    "TIMEOUT",
    "PARSE_ERROR",
    "EXTRACTION_FAILURE"
  ];

  for (const outcome of failureOutcomes) {
    it(`prohibits ${outcome} from informing exhaustion or reducing novelty`, () => {
      const portal = "Naukri";
      const query = `Query-${outcome}`;

      // 1. Initial valid page with 50% novelty
      QueryMetricsStore.record({
        runId: "run-valid",
        portal,
        query,
        page: 1,
        cardsSeen: 10,
        cardsParsed: 10,
        canonicalDuplicates: 5,
        ledgerKnown: 5,
        hardFiltered: 0,
        identityFailed: 0,
        novelAccepted: 5,
        novelAcquired: 5,
        noveltyRate: 0.5,
        elapsedMs: 1000,
        timestamp: new Date().toISOString(),
        outcome: "SUCCESS",
        hasTransportError: false
      });

      // 2. Failure occurs (e.g. 406, 429, timeout)
      QueryMetricsStore.record({
        runId: "run-failure",
        portal,
        query,
        page: 2,
        cardsSeen: 0,
        cardsParsed: 0,
        canonicalDuplicates: 0,
        ledgerKnown: 0,
        hardFiltered: 0,
        identityFailed: 0,
        novelAccepted: 0,
        novelAcquired: 0,
        noveltyRate: 0.0,
        elapsedMs: 500,
        timestamp: new Date().toISOString(),
        outcome,
        hasTransportError: true
      });

      const rate = QueryMetricsStore.getAverageNoveltyRate(portal, query);
      expect(rate).toBe(0.5); // Remains protected at 50%
      expect(rate).toBeGreaterThanOrEqual(0.05);
    });
  }

  it("Architectural Invariant: scripts/scrape.ts does NOT bypass QueryMetricsStore on zero cards", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const scrapeCode = fs.readFileSync(path.resolve(process.cwd(), "scripts/scrape.ts"), "utf-8");

    // Must not contain early return on cards.length === 0 before detail/metrics processing
    const earlyReturnPattern = /if\s*\(\s*cards\.length\s*===\s*0\s*\)\s*\{\s*outcome\.status\s*=\s*"skipped_empty";\s*return outcome;\s*\}/;
    expect(earlyReturnPattern.test(scrapeCode)).toBe(false);

    // Must persist SUCCESS_EMPTY when cards.length === 0
    expect(scrapeCode.includes('cards.length === 0 ? "skipped_empty" : "completed"')).toBe(true);
    expect(scrapeCode.includes('cards.length === 0')).toBe(true);
    expect(scrapeCode.includes('"SUCCESS_EMPTY"')).toBe(true);
  });
});

