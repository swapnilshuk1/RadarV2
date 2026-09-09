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
    expect(naukriHandler.lastTelemetry?.apiPagesObserved).toBe(3);
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
        // Send stale page 1, 3: MUST be rejected for Unit 2!
        await u2ResponseCb({
          url: () => "https://www.naukri.com/jobapi/v3/search?k=vice%20president%20product&pageNo=1",
          headers: () => ({ "content-type": "application/json" }),
          json: async () => ({ jobDetails: Array.from({ length: 20 }, (_, i) => makeJob(i + 1, "P1_Stale")) }),
        });
        await u2ResponseCb({
          url: () => "https://www.naukri.com/jobapi/v3/search?k=vice%20president%20product&pageNo=3",
          headers: () => ({ "content-type": "application/json" }),
          json: async () => ({ jobDetails: Array.from({ length: 20 }, (_, i) => makeJob(i + 1, "P3_Stale")) }),
        });
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
    expect(naukriHandler.lastTelemetry?.apiPagesObserved).toBe(3);
    expect(naukriHandler.lastTelemetry?.rawApiRecords).toBe(60);
    expect(naukriHandler.lastTelemetry?.returnedCards).toBe(60);
  });
});
