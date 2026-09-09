import { describe, it, expect, vi } from "vitest";
import { naukriHandler } from "../../scripts/scraper/portals/naukri";
import type { PortalContext } from "../../scripts/scraper/types";

function makeJob(id: number, prefix = "Unit") {
  return {
    jobId: `${prefix}_job_${id}`,
    title: `Vice President of Product ${id}`,
    companyName: `Enterprise Corp ${id}`,
    placeholders: [
      { type: "location", label: "Bengaluru, India" },
      { type: "experience", label: "15-20 Yrs" },
    ],
    jdURL: `https://www.naukri.com/job-listings-${prefix}-${id}`,
    jobDescription: `<p>Executive product leadership role ${id}.</p>`,
  };
}

describe("Naukri Non-Overlapping Work Units & Telemetry Contract", () => {
  it("proves consecutive logical work units (Unit 1 and Unit 2) have zero API page overlap", async () => {
    let u1ResponseCb: (res: any) => Promise<void>;
    let u2ResponseCb: (res: any) => Promise<void>;

    const page1Mock: any = {
      isClosed: () => false,
      url: () => "https://www.naukri.com/vice-president-product-jobs-in-india?k=vice%20president%20product&pageNo=1",
      title: async () => "VP Product Jobs",
      mouse: { move: vi.fn().mockResolvedValue(undefined) },
      on: (ev: string, cb: any) => { if (ev === "response") u1ResponseCb = cb; },
      off: vi.fn(),
      goto: vi.fn().mockImplementation(async () => {
        await u1ResponseCb({
          url: () => "https://www.naukri.com/jobapi/v3/search?k=vice%20president%20product&pageNo=1",
          headers: () => ({ "content-type": "application/json" }),
          json: async () => ({ jobDetails: Array.from({ length: 20 }, (_, i) => makeJob(i + 1, "P1")) }),
        });
        await u1ResponseCb({
          url: () => "https://www.naukri.com/jobapi/v3/search?k=vice%20president%20product&pageNo=2",
          headers: () => ({ "content-type": "application/json" }),
          json: async () => ({ jobDetails: Array.from({ length: 20 }, (_, i) => makeJob(i + 1, "P2")) }),
        });
        await u1ResponseCb({
          url: () => "https://www.naukri.com/jobapi/v3/search?k=vice%20president%20product&pageNo=3",
          headers: () => ({ "content-type": "application/json" }),
          json: async () => ({ jobDetails: Array.from({ length: 20 }, (_, i) => makeJob(i + 1, "P3")) }),
        });
        // Out-of-bounds page 4 for Unit 1: MUST be rejected
        await u1ResponseCb({
          url: () => "https://www.naukri.com/jobapi/v3/search?k=vice%20president%20product&pageNo=4",
          headers: () => ({ "content-type": "application/json" }),
          json: async () => ({ jobDetails: Array.from({ length: 20 }, (_, i) => makeJob(i + 1, "P4_Contaminated")) }),
        });
      }),
      evaluate: vi.fn().mockResolvedValue(true),
      locator: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
      waitForSelector: vi.fn().mockResolvedValue(null),
    };

    const ctx1: PortalContext = {
      runId: "run-u1",
      portal: "Naukri",
      keyword: "vice president product",
      page: 1,
      searchUrl: naukriHandler.buildSearchUrl({ query: "vice president product", page: 1, maxCardsPerPage: 60 }),
      activePage: page1Mock,
      searchPage: page1Mock,
      maxCardsPerPage: 60,
      logger: () => {},
    };

    const cardsU1 = await naukriHandler.listCards(ctx1);
    expect(cardsU1.length).toBe(60);
    expect(cardsU1.some(c => c.detailUrl.includes("P4_Contaminated"))).toBe(false);

    // Verify Unit 1 Telemetry
    expect(naukriHandler.lastTelemetry).toBeDefined();
    expect(naukriHandler.lastTelemetry?.apiPagesExpected).toEqual([1, 2, 3]);
    expect(naukriHandler.lastTelemetry?.apiPagesObserved).toEqual([1, 2, 3]);
    expect(naukriHandler.lastTelemetry?.apiPagesMissing).toEqual([]);
    expect(naukriHandler.lastTelemetry?.paginationGap).toBe(false);
    expect(naukriHandler.lastTelemetry?.rawApiRecords).toBe(60);
    expect(naukriHandler.lastTelemetry?.uniqueApiJobIds).toBe(60);
    expect(naukriHandler.lastTelemetry?.returnedCards).toBe(60);

    // Unit 2 (page 2 in logical units => API pages 4..6)
    const page2Mock: any = {
      isClosed: () => false,
      url: () => "https://www.naukri.com/vice-president-product-jobs-in-india-4?k=vice%20president%20product&pageNo=4",
      title: async () => "VP Product Jobs",
      mouse: { move: vi.fn().mockResolvedValue(undefined) },
      on: (ev: string, cb: any) => { if (ev === "response") u2ResponseCb = cb; },
      off: vi.fn(),
      goto: vi.fn().mockImplementation(async () => {
        // Valid pages 4, 5, 6 for Unit 2
        await u2ResponseCb({
          url: () => "https://www.naukri.com/jobapi/v3/search?k=vice%20president%20product&pageNo=4",
          headers: () => ({ "content-type": "application/json" }),
          json: async () => ({ jobDetails: Array.from({ length: 20 }, (_, i) => makeJob(i + 1, "P4")) }),
        });
        await u2ResponseCb({
          url: () => "https://www.naukri.com/jobapi/v3/search?k=vice%20president%20product&pageNo=5",
          headers: () => ({ "content-type": "application/json" }),
          json: async () => ({ jobDetails: Array.from({ length: 20 }, (_, i) => makeJob(i + 1, "P5")) }),
        });
        await u2ResponseCb({
          url: () => "https://www.naukri.com/jobapi/v3/search?k=vice%20president%20product&pageNo=6",
          headers: () => ({ "content-type": "application/json" }),
          json: async () => ({ jobDetails: Array.from({ length: 20 }, (_, i) => makeJob(i + 1, "P6")) }),
        });
        // Out-of-bounds page 7 for Unit 2
        await u2ResponseCb({
          url: () => "https://www.naukri.com/jobapi/v3/search?k=vice%20president%20product&pageNo=7",
          headers: () => ({ "content-type": "application/json" }),
          json: async () => ({ jobDetails: Array.from({ length: 20 }, (_, i) => makeJob(i + 1, "P7_Contaminated")) }),
        });
      }),
      evaluate: vi.fn().mockResolvedValue(true),
      locator: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
      waitForSelector: vi.fn().mockResolvedValue(null),
    };

    const ctx2: PortalContext = {
      runId: "run-u2",
      portal: "Naukri",
      keyword: "vice president product",
      page: 2,
      searchUrl: naukriHandler.buildSearchUrl({ query: "vice president product", page: 2, maxCardsPerPage: 60 }),
      activePage: page2Mock,
      searchPage: page2Mock,
      maxCardsPerPage: 60,
      logger: () => {},
    };

    const cardsU2 = await naukriHandler.listCards(ctx2);
    expect(cardsU2.length).toBe(60);

    expect(cardsU2.some(c => c.detailUrl.includes("P1_Stale"))).toBe(false);
    expect(cardsU2.some(c => c.detailUrl.includes("P3_Stale"))).toBe(false);
    expect(cardsU2.some(c => c.detailUrl.includes("P7_Contaminated"))).toBe(false);

    // Strict non-overlap: Intersection between Unit 1 and Unit 2 must be strictly empty!
    const u1Urls = new Set(cardsU1.map(c => c.detailUrl));
    const overlap = cardsU2.filter(c => u1Urls.has(c.detailUrl));
    expect(overlap.length).toBe(0);

    // Verify Unit 2 Telemetry
    expect(naukriHandler.lastTelemetry?.apiPagesExpected).toEqual([4, 5, 6]);
    expect(naukriHandler.lastTelemetry?.apiPagesObserved).toEqual([4, 5, 6]);
    expect(naukriHandler.lastTelemetry?.apiPagesMissing).toEqual([]);
    expect(naukriHandler.lastTelemetry?.paginationGap).toBe(false);
    expect(naukriHandler.lastTelemetry?.rawApiRecords).toBe(60);
    expect(naukriHandler.lastTelemetry?.returnedCards).toBe(60);
  });

  it("proves production orchestrator call shape (without explicit maxCardsPerPage in request) defaults cleanly to 60-card 3-page boundaries", async () => {
    // 1. buildSearchUrl without explicit maxCardsPerPage must default to CONFIG.getMaxCardsPerPage("Naukri") = 60
    const url1 = naukriHandler.buildSearchUrl({ query: "VP Engineering", page: 1 });
    const url2 = naukriHandler.buildSearchUrl({ query: "VP Engineering", page: 2 });
    const url3 = naukriHandler.buildSearchUrl({ query: "VP Engineering", page: 3 });

    expect(url1).toContain("pageNo=1");
    expect(url2).toContain("pageNo=4");
    expect(url2).toContain("-4?");
    expect(url3).toContain("pageNo=7");
    expect(url3).toContain("-7?");

    // 2. listCards without explicit maxCardsPerPage must align on [4..6] for page 2
    let responseCb: (res: any) => Promise<void>;
    const page2Mock: any = {
      isClosed: () => false,
      url: () => url2,
      title: async () => "VP Engineering",
      mouse: { move: vi.fn().mockResolvedValue(undefined) },
      on: (ev: string, cb: any) => { if (ev === "response") responseCb = cb; },
      off: vi.fn(),
      goto: vi.fn().mockImplementation(async () => {
        // Page 4 arrives first upon navigating to url2
        await responseCb({
          url: () => "https://www.naukri.com/jobapi/v3/search?k=VP%20Engineering&pageNo=4",
          headers: () => ({ "content-type": "application/json" }),
          json: async () => ({ jobDetails: Array.from({ length: 20 }, (_, i) => makeJob(i + 1, "P4_Default")) }),
        });
      }),
      evaluate: vi.fn().mockResolvedValue(true),
      locator: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
      waitForSelector: vi.fn().mockResolvedValue(null),
    };

    const ctx: PortalContext = {
      runId: "run-prod-shape",
      portal: "Naukri",
      keyword: "VP Engineering",
      page: 2,
      searchUrl: url2,
      activePage: page2Mock,
      searchPage: page2Mock,
      // Intentionally omit maxCardsPerPage to verify default CONFIG parity
      logger: () => {},
    };

    const cards = await naukriHandler.listCards(ctx);
    expect(cards.length).toBeGreaterThanOrEqual(20);
    expect(cards[0].detailUrl).toContain("P4_Default");
  });

  it("fails closed and halts logical unit when an expected API page response is missing (PAGINATION_GAP)", async () => {
    let responseCb: (res: any) => Promise<void>;
    const logs: string[] = [];

    const pageMock: any = {
      isClosed: () => false,
      url: () => "https://www.naukri.com/vice-president-engineering-jobs-in-india?k=vice%20president%20engineering",
      title: async () => "VP Engineering",
      mouse: { move: vi.fn().mockResolvedValue(undefined) },
      on: (ev: string, cb: any) => { if (ev === "response") responseCb = cb; },
      off: vi.fn(),
      goto: vi.fn().mockImplementation(async (targetUrl: string) => {
        // Only deliver response for page 1 upon initial load.
        // For page 2, do NOT deliver any response, simulating network drop or pagination failure.
        if (targetUrl.includes("pageNo=1") || !targetUrl.includes("pageNo=")) {
          await responseCb({
            url: () => "https://www.naukri.com/jobapi/v3/search?k=vice%20president%20engineering&pageNo=1",
            headers: () => ({ "content-type": "application/json" }),
            json: async () => ({ jobDetails: Array.from({ length: 20 }, (_, i) => makeJob(i + 1, "P1")) }),
          });
        }
      }),
      evaluate: vi.fn().mockResolvedValue(true),
      locator: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
      waitForSelector: vi.fn().mockResolvedValue(null),
    };

    const ctx: any = {
      runId: "run-gap-test",
      portal: "Naukri",
      keyword: "vice president engineering",
      page: 1,
      searchUrl: "https://www.naukri.com/vice-president-engineering-jobs-in-india?k=vice%20president%20engineering",
      activePage: pageMock,
      searchPage: pageMock,
      maxCardsPerPage: 60, // expects API pages 1, 2, 3
      logger: (msg: string) => logs.push(msg),
    };

    const cards = await naukriHandler.listCards(ctx);
    // Page 1 yielded 20 cards. Page 2 failed to arrive, so it halted without fetching page 3.
    expect(cards.length).toBe(20);

    // Telemetry must report paginationGap: true, with pages 2 and 3 missing!
    expect(naukriHandler.lastTelemetry?.apiPagesExpected).toEqual([1, 2, 3]);
    expect(naukriHandler.lastTelemetry?.apiPagesObserved).toEqual([1]);
    expect(naukriHandler.lastTelemetry?.apiPagesMissing).toEqual([2, 3]);
    expect(naukriHandler.lastTelemetry?.paginationGap).toBe(true);

    // Must have logged the gap
    expect(logs.some(l => l.includes("PAGINATION_GAP"))).toBe(true);
  });
});
