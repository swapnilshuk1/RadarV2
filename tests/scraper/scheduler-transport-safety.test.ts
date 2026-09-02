import { describe, it, expect, beforeEach } from "vitest";
import { QueryMetricsStore, type QueryRunRecord } from "../../scripts/scraper/run/metrics";

describe("Adaptive Scheduler Transport Safety Contract", () => {
  beforeEach(() => {
    // Reset in-memory records between tests
    (QueryMetricsStore as any).records = [];
  });

  it("does NOT penalize novelty or trigger pruning when a page encounters a transport error (e.g. HTTP 406)", () => {
    const portal = "Naukri";
    const query = "Chief Marketing Officer";

    // Page 1: Successful acquisition with 10 parsed cards, 8 novel
    QueryMetricsStore.record({
      runId: "run-test-1",
      portal,
      query,
      page: 1,
      cardsSeen: 10,
      cardsParsed: 10,
      canonicalDuplicates: 2,
      ledgerKnown: 2,
      hardFiltered: 0,
      identityFailed: 0,
      novelAccepted: 8,
      novelAcquired: 8,
      noveltyRate: 0.8,
      elapsedMs: 1500,
      timestamp: new Date().toISOString(),
      outcome: "SUCCESS",
      hasTransportError: false
    });

    expect(QueryMetricsStore.getAverageNoveltyRate(portal, query)).toBe(0.8);

    // Page 2: Fails with HTTP 406 (0 cards parsed)
    QueryMetricsStore.record({
      runId: "run-test-1",
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
      outcome: "ANTI_BOT",
      hasTransportError: true
    });

    // INVARIANT: The average novelty rate MUST NOT be diluted or set to 0.0% by the transport error!
    const noveltyAfter406 = QueryMetricsStore.getAverageNoveltyRate(portal, query);
    expect(noveltyAfter406).toBe(0.8);
    expect(noveltyAfter406).toBeGreaterThanOrEqual(0.05); // Above the 5% pruning threshold
  });

  it("does NOT penalize novelty when timeouts or 5xx server errors occur", () => {
    const portal = "LinkedIn";
    const query = "VP Growth";

    // Initial page succeeded
    QueryMetricsStore.record({
      runId: "run-test-2",
      portal,
      query,
      page: 1,
      cardsSeen: 15,
      cardsParsed: 15,
      canonicalDuplicates: 3,
      ledgerKnown: 3,
      hardFiltered: 0,
      identityFailed: 0,
      novelAccepted: 10,
      novelAcquired: 10,
      noveltyRate: 10 / 15,
      elapsedMs: 2000,
      timestamp: new Date().toISOString(),
      outcome: "SUCCESS",
      hasTransportError: false
    });

    // Subsequent page timed out
    QueryMetricsStore.record({
      runId: "run-test-2",
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
      elapsedMs: 30000,
      timestamp: new Date().toISOString(),
      outcome: "TIMEOUT",
      hasTransportError: true
    });

    const rate = QueryMetricsStore.getAverageNoveltyRate(portal, query);
    expect(rate).toBeCloseTo(10 / 15, 2);
  });
});
