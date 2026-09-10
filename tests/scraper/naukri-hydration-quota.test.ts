import { describe, it, expect, vi } from "vitest";
import { naukriHandler } from "../../scripts/scraper/portals/naukri";
import type { PortalContext } from "../../scripts/scraper/types";

function makeJob(id: number, suffix = "") {
  return {
    jobId: `job_${id}${suffix}`,
    title: `Chief Marketing Officer ${id}`,
    companyName: `Acme ${id} Corp`,
    placeholders: [
      { type: "location", label: "Bengaluru, India" },
      { type: "experience", label: "15-20 Yrs" },
      { type: "salary", label: "50-70 Lacs" }
    ],
    jdURL: `https://www.naukri.com/job-listings-${id}${suffix}`,
    jobDescription: `<p>Executive leadership role ${id} in growth and marketing strategy.</p>`,
    tagsAndSkills: "Marketing, Growth, Strategy",
  };
}

describe("Naukri Hydration & Quota Accumulation Invariant", () => {
  it("accumulates 20 + 20 + 20 unique API jobs into 60 unique discoveries without premature cutoff", async () => {
    // Generate 3 batches of 20 unique jobs
    const batch1 = Array.from({ length: 20 }, (_, i) => makeJob(i + 1));
    const batch2 = Array.from({ length: 20 }, (_, i) => makeJob(i + 21));
    const batch3 = Array.from({ length: 20 }, (_, i) => makeJob(i + 41));

    let responseCallback: (res: any) => void;
    const mockPage: any = {
      isClosed: () => false,
      url: () => "https://www.naukri.com/chief-marketing-officer-jobs-in-india",
      title: async () => "Chief Marketing Officer Jobs",
      mouse: { move: vi.fn().mockResolvedValue(undefined) },
      on: (event: string, cb: any) => {
        if (event === "response") {
          responseCallback = cb;
        }
      },
      off: vi.fn(),
      removeListener: vi.fn(),
      goto: vi.fn().mockImplementation(async () => {
        if (responseCallback) {
          await responseCallback({
            url: () => "https://www.naukri.com/jobapi/v3/search?noOfResults=20&pageNo=1",
            status: () => 200,
            headers: () => ({ "content-type": "application/json" }),
            json: async () => ({ jobDetails: batch1 })
          });
          await responseCallback({
            url: () => "https://www.naukri.com/jobapi/v3/search?noOfResults=20&pageNo=1&scroll=1",
            status: () => 200,
            headers: () => ({ "content-type": "application/json" }),
            json: async () => ({ jobDetails: batch2 })
          });
          await responseCallback({
            url: () => "https://www.naukri.com/jobapi/v3/search?noOfResults=20&pageNo=1&scroll=2",
            status: () => 200,
            headers: () => ({ "content-type": "application/json" }),
            json: async () => ({ jobDetails: batch3 })
          });
        }
      }),
      evaluate: vi.fn().mockResolvedValue(true),
      locator: vi.fn().mockReturnValue({
        count: vi.fn().mockResolvedValue(0),
        first: vi.fn().mockReturnValue({
          scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined)
        })
      }),
      waitForSelector: vi.fn().mockResolvedValue(null),
    };

    const ctx: PortalContext = {
      runId: "run-test",
      portal: "Naukri",
      keyword: "Chief Marketing Officer",
      page: 1,
      searchUrl: "https://www.naukri.com/chief-marketing-officer-jobs-1",
      activePage: mockPage,
      searchPage: mockPage,
      maxCardsPerPage: 60,
      logger: () => {},
    };

    const cards = await naukriHandler.listCards(ctx);
    expect(cards.length).toBe(60);

    // Verify all 60 are distinct
    const uniqueHrefs = new Set(cards.map(c => c.detailUrl));
    expect(uniqueHrefs.size).toBe(60);
  });

  it("accumulates 40 + 20 unique jobs to reach the 60 target", async () => {
    const batch1 = Array.from({ length: 40 }, (_, i) => makeJob(i + 1));
    const batch2 = Array.from({ length: 20 }, (_, i) => makeJob(i + 41));

    let responseCallback: (res: any) => void;
    const mockPage: any = {
      isClosed: () => false,
      url: () => "https://www.naukri.com/chief-marketing-officer-jobs-in-india",
      title: async () => "Chief Marketing Officer Jobs",
      mouse: { move: vi.fn().mockResolvedValue(undefined) },
      on: (event: string, cb: any) => {
        if (event === "response") responseCallback = cb;
      },
      off: vi.fn(),
      removeListener: vi.fn(),
      goto: vi.fn().mockImplementation(async () => {
        if (responseCallback) {
          await responseCallback({
            url: () => "https://www.naukri.com/jobapi/v3/search?noOfResults=40&pageNo=1",
            status: () => 200,
            headers: () => ({ "content-type": "application/json" }),
            json: async () => ({ jobDetails: batch1 })
          });
          await responseCallback({
            url: () => "https://www.naukri.com/jobapi/v3/search?noOfResults=20&pageNo=1&scroll=1",
            status: () => 200,
            headers: () => ({ "content-type": "application/json" }),
            json: async () => ({ jobDetails: batch2 })
          });
        }
      }),
      evaluate: vi.fn().mockResolvedValue(true),
      locator: vi.fn().mockReturnValue({
        count: vi.fn().mockResolvedValue(0),
      }),
      waitForSelector: vi.fn().mockResolvedValue(null),
    };

    const ctx: PortalContext = {
      runId: "run-test",
      portal: "Naukri",
      keyword: "Chief Marketing Officer",
      page: 1,
      searchUrl: "https://www.naukri.com/chief-marketing-officer-jobs-1",
      activePage: mockPage,
      searchPage: mockPage,
      maxCardsPerPage: 60,
      logger: () => {},
    };

    const cards = await naukriHandler.listCards(ctx);
    expect(cards.length).toBe(60);
  });

  it("ensures duplicate jobs across batches are counted once and do NOT consume unique quota", async () => {
    // Batch 1 has 20 unique jobs: 1..20
    const batch1 = Array.from({ length: 20 }, (_, i) => makeJob(i + 1));
    // Batch 2 has 10 duplicate jobs (1..10) and 20 new jobs (21..40)
    const batch2 = [
      ...Array.from({ length: 10 }, (_, i) => makeJob(i + 1)),
      ...Array.from({ length: 20 }, (_, i) => makeJob(i + 21)),
    ];
    // Batch 3 has 20 new jobs: 41..60
    const batch3 = Array.from({ length: 20 }, (_, i) => makeJob(i + 41));

    let responseCallback: (res: any) => void;
    const mockPage: any = {
      isClosed: () => false,
      url: () => "https://www.naukri.com/chief-marketing-officer-jobs-in-india",
      title: async () => "Chief Marketing Officer Jobs",
      mouse: { move: vi.fn().mockResolvedValue(undefined) },
      on: (event: string, cb: any) => {
        if (event === "response") responseCallback = cb;
      },
      off: vi.fn(),
      removeListener: vi.fn(),
      goto: vi.fn().mockImplementation(async () => {
        if (responseCallback) {
          await responseCallback({
            url: () => "https://www.naukri.com/jobapi/v3/search?pageNo=1",
            status: () => 200,
            headers: () => ({ "content-type": "application/json" }),
            json: async () => ({ jobDetails: batch1 })
          });
          await responseCallback({
            url: () => "https://www.naukri.com/jobapi/v3/search?pageNo=1&scroll=1",
            status: () => 200,
            headers: () => ({ "content-type": "application/json" }),
            json: async () => ({ jobDetails: batch2 })
          });
          await responseCallback({
            url: () => "https://www.naukri.com/jobapi/v3/search?pageNo=1&scroll=2",
            status: () => 200,
            headers: () => ({ "content-type": "application/json" }),
            json: async () => ({ jobDetails: batch3 })
          });
        }
      }),
      evaluate: vi.fn().mockResolvedValue(true),
      locator: vi.fn().mockReturnValue({
        count: vi.fn().mockResolvedValue(0),
      }),
      waitForSelector: vi.fn().mockResolvedValue(null),
    };

    const ctx: PortalContext = {
      runId: "run-test",
      portal: "Naukri",
      keyword: "Chief Marketing Officer",
      page: 1,
      searchUrl: "https://www.naukri.com/chief-marketing-officer-jobs-1",
      activePage: mockPage,
      searchPage: mockPage,
      maxCardsPerPage: 60,
      logger: () => {},
    };

    const cards = await naukriHandler.listCards(ctx);
    // Because duplicates (1..10) did NOT consume the quota, batch 3 was absorbed to achieve 60 total unique jobs!
    expect(cards.length).toBe(60);
    const uniqueIds = new Set(cards.map(c => c.detailUrl));
    expect(uniqueIds.size).toBe(60);
  });

  it("adversarially rejects cross-query contamination and out-of-sequence stale responses (Gate 1)", async () => {
    // Current work unit: Query A ("Chief Marketing Officer") / Page 1
    // Target: 60 unique jobs from Query A
    const batchA1 = Array.from({ length: 20 }, (_, i) => ({
      ...makeJob(i + 1, "-A1"),
      title: `Chief Marketing Officer A1-${i + 1}`,
    }));
    const batchA2 = Array.from({ length: 20 }, (_, i) => ({
      ...makeJob(i + 21, "-A2"),
      title: `Chief Marketing Officer A2-${i + 21}`,
    }));
    const batchBConcurrent = Array.from({ length: 20 }, (_, i) => ({
      ...makeJob(i + 100, "-B"),
      title: `Java Backend Engineer ${i + 100}`,
    }));
    const batchAStaleOutBounds = Array.from({ length: 20 }, (_, i) => ({
      ...makeJob(i + 200, "-Aold"),
      title: `Chief Marketing Officer Old-${i + 200}`,
    }));
    const batchA3 = Array.from({ length: 20 }, (_, i) => ({
      ...makeJob(i + 41, "-A3"),
      title: `Chief Marketing Officer A3-${i + 41}`,
    }));

    let responseCallback: (res: any) => void;
    const mockPage: any = {
      isClosed: () => false,
      url: () => "https://www.naukri.com/chief-marketing-officer-jobs-in-india",
      title: async () => "Chief Marketing Officer Jobs",
      mouse: { move: vi.fn().mockResolvedValue(undefined) },
      on: (event: string, cb: any) => {
        if (event === "response") responseCallback = cb;
      },
      off: vi.fn(),
      removeListener: vi.fn(),
      goto: vi.fn().mockImplementation(async () => {
        if (responseCallback) {
          // 1. Valid A / page 1
          await responseCallback({
            url: () => "https://www.naukri.com/jobapi/v3/search?k=chief%20marketing%20officer&pageNo=1",
            status: () => 200,
            headers: () => ({ "content-type": "application/json" }),
            json: async () => ({ jobDetails: batchA1 })
          });
          // 2. Valid A / page 2 (lazy scroll)
          await responseCallback({
            url: () => "https://www.naukri.com/jobapi/v3/search?k=chief%20marketing%20officer&pageNo=2",
            status: () => 200,
            headers: () => ({ "content-type": "application/json" }),
            json: async () => ({ jobDetails: batchA2 })
          });
          // 3. Stale/concurrent Query B ("Software Engineer") -> MUST BE REJECTED
          await responseCallback({
            url: () => "https://www.naukri.com/jobapi/v3/search?k=software%20engineer&pageNo=1",
            status: () => 200,
            headers: () => ({ "content-type": "application/json" }),
            json: async () => ({ jobDetails: batchBConcurrent })
          });
          // 4. Stale/out-of-bounds Page 5 from prior navigation -> MUST BE REJECTED
          await responseCallback({
            url: () => "https://www.naukri.com/jobapi/v3/search?k=chief%20marketing%20officer&pageNo=5",
            status: () => 200,
            headers: () => ({ "content-type": "application/json" }),
            json: async () => ({ jobDetails: batchAStaleOutBounds })
          });
          // 5. Valid A / page 3 (lazy scroll) -> MUST BE ACCEPTED to finish 60 quota
          await responseCallback({
            url: () => "https://www.naukri.com/jobapi/v3/search?k=chief%20marketing%20officer&pageNo=3",
            status: () => 200,
            headers: () => ({ "content-type": "application/json" }),
            json: async () => ({ jobDetails: batchA3 })
          });
        }
      }),
      evaluate: vi.fn().mockResolvedValue(true),
      locator: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
      waitForSelector: vi.fn().mockResolvedValue(null),
    };

    const ctx: PortalContext = {
      runId: "run-adversarial",
      portal: "Naukri",
      keyword: "Chief Marketing Officer",
      page: 1,
      searchUrl: "https://www.naukri.com/chief-marketing-officer-jobs-1",
      activePage: mockPage,
      searchPage: mockPage,
      maxCardsPerPage: 60,
      logger: () => {},
    };

    const cards = await naukriHandler.listCards(ctx);

    // Exactly 60 cards from Query A batches (A1: 20, A2: 20, A3: 20)
    expect(cards.length).toBe(60);
    // None of Query B or Stale Out-of-bounds A jobs are present!
    expect(cards.some(c => c.title.includes("Java Backend Engineer"))).toBe(false);
    expect(cards.some(c => c.title.includes("Old-"))).toBe(false);
    expect(cards.every(c => c.title.includes("Chief Marketing Officer A"))).toBe(true);
  });
});
