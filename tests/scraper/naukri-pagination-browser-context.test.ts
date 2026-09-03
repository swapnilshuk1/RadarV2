import { describe, it, expect, vi } from "vitest";
import { naukriHandler } from "../../scripts/scraper/portals/naukri";

// Keep this contract test focused on response capture, not portal timing.
vi.mock("../../scripts/scraper/utils/scroll", () => ({
  hydrateVirtualizedList: vi.fn().mockResolvedValue({ initialCount: 0, finalCount: 0, passesCompleted: 0, stabilized: true }),
}));
vi.mock("../../scripts/scraper/utils/jitter", () => ({
  humanize: vi.fn().mockResolvedValue(undefined),
  sleep: vi.fn().mockResolvedValue(undefined),
  jitter: vi.fn().mockResolvedValue(undefined),
}));

describe("Naukri Browser-Context Pagination Lifecycle Contract", () => {
  it("builds canonical paginated search URLs for multi-unit dispatch", () => {
    const urlP1 = naukriHandler.buildSearchUrl({ query: "Chief Marketing Officer", page: 1 });
    const urlP2 = naukriHandler.buildSearchUrl({ query: "Chief Marketing Officer", page: 2 });
    const urlP3 = naukriHandler.buildSearchUrl({ query: "Chief Marketing Officer", page: 3 });

    expect(urlP1).toBe("https://www.naukri.com/chief-marketing-officer-jobs-in-india?k=Chief+Marketing+Officer&pageNo=1");
    expect(urlP2).toBe("https://www.naukri.com/chief-marketing-officer-jobs-in-india-2?k=Chief+Marketing+Officer&pageNo=2");
    expect(urlP3).toBe("https://www.naukri.com/chief-marketing-officer-jobs-in-india-3?k=Chief+Marketing+Officer&pageNo=3");
  });

  it("installs response listener before navigation and removes it in finally block", async () => {
    const eventsRegistered: string[] = [];
    const eventsRemoved: string[] = [];

    const mockPage: any = {
      on: vi.fn((event: string, handler: Function) => {
        eventsRegistered.push(event);
      }),
      off: vi.fn((event: string, handler: Function) => {
        eventsRemoved.push(event);
      }),
      goto: vi.fn().mockImplementation(async () => {
        // Assert that 'response' was already registered before goto was called!
        expect(eventsRegistered).toContain("response");
        return null;
      }),
      url: vi.fn().mockReturnValue("https://www.naukri.com/chief-marketing-officer-jobs-in-india-2?k=Chief%20Marketing%20Officer&pageNo=2"),
      title: vi.fn().mockResolvedValue("Chief Marketing Officer Jobs"),
      waitForSelector: vi.fn().mockResolvedValue(null),
      locator: vi.fn(() => ({ count: vi.fn().mockResolvedValue(0), all: vi.fn().mockResolvedValue([]) })),
      mouse: { wheel: vi.fn().mockResolvedValue(null) },
      evaluate: vi.fn().mockResolvedValue([])
    };

    const mockCtx: any = {
      portal: "Naukri",
      keyword: "Chief Marketing Officer",
      page: 2,
      searchUrl: "https://www.naukri.com/chief-marketing-officer-jobs-in-india-2?k=Chief%20Marketing%20Officer&pageNo=2",
      activePage: mockPage,
      logger: vi.fn(),
      maxCards: 20
    };

    await naukriHandler.listCards(mockCtx);

    // Verified lifecycle:
    // 1. Registered 'response' listener
    expect(eventsRegistered).toContain("response");
    // 2. Navigated via page.goto
    expect(mockPage.goto).toHaveBeenCalledTimes(1);
    // 3. Removed 'response' listener in finally block
    expect(eventsRemoved).toContain("response");
  });

  it("does NOT execute synthetic in-page fetch loop for subsequent pages", async () => {
    const evaluateCalls: string[] = [];

    const mockPage: any = {
      on: vi.fn(),
      off: vi.fn(),
      goto: vi.fn().mockResolvedValue(null),
      url: vi.fn().mockReturnValue("https://www.naukri.com/chief-marketing-officer-jobs-in-india-1"),
      title: vi.fn().mockResolvedValue("Chief Marketing Officer Jobs"),
      waitForSelector: vi.fn().mockResolvedValue(null),
      locator: vi.fn(() => ({ count: vi.fn().mockResolvedValue(0), all: vi.fn().mockResolvedValue([]) })),
      mouse: { wheel: vi.fn().mockResolvedValue(null) },
      evaluate: vi.fn().mockImplementation(async (fn: any, args: any) => {
        evaluateCalls.push(args !== undefined ? JSON.stringify(args) : "undefined");
        return [];
      })
    };

    const mockCtx: any = {
      portal: "Naukri",
      keyword: "Chief Marketing Officer",
      page: 1,
      searchUrl: "https://www.naukri.com/chief-marketing-officer-jobs-in-india-1?k=Chief+Marketing+Officer",
      activePage: mockPage,
      logger: vi.fn(),
      maxCards: 20
    };

    await naukriHandler.listCards(mockCtx);

    // Invariant: No evaluate calls should be fetching pageNo: 2 or pageNo: 3 inside Page 1!
    const page2Fetch = evaluateCalls.some(c => c && (c.includes('"pageNo":2') || c.includes('"pageNo": 2')));
    expect(page2Fetch).toBe(false);
  });

  it("retains API-only page results when the DOM has zero cards", async () => {
    const makeJob = (page: number, index: number) => ({
      title: `VP Platform ${page}-${index}`,
      companyName: `Company ${page}-${index}`,
      jdURL: `/job-listings/vp-platform-${page}-${index}`,
      placeholders: [{ type: "location", label: "Gurgaon" }],
    });

    const runPage = async (pageNumber: number) => {
      let responseHandler: ((response: any) => Promise<void>) | undefined;
      const mockPage: any = {
        on: vi.fn((_event: string, handler: (response: any) => Promise<void>) => { responseHandler = handler; }),
        off: vi.fn(),
        goto: vi.fn().mockImplementation(async () => {
          await responseHandler?.({
            url: () => `https://www.naukri.com/jobapi/v4/search?pageNo=${pageNumber}`,
            headers: () => ({ "content-type": "application/json" }),
            json: async () => ({ jobDetails: Array.from({ length: 20 }, (_, i) => makeJob(pageNumber, i)) }),
          });
        }),
        url: vi.fn().mockReturnValue(`https://www.naukri.com/vice-president-jobs-in-india-${pageNumber}`),
        title: vi.fn().mockResolvedValue("VP Platform Jobs"),
        waitForSelector: vi.fn().mockResolvedValue(null),
        locator: vi.fn(() => ({ count: vi.fn().mockResolvedValue(0), all: vi.fn().mockResolvedValue([]) })),
        mouse: { wheel: vi.fn().mockResolvedValue(null), move: vi.fn().mockResolvedValue(null) },
        evaluate: vi.fn().mockResolvedValue([]),
      };

      return naukriHandler.listCards({
        portal: "Naukri",
        keyword: "VP Platform",
        page: pageNumber,
        searchUrl: naukriHandler.buildSearchUrl({ query: "VP Platform", page: pageNumber }),
        activePage: mockPage,
        logger: vi.fn(),
        maxCards: 20,
      } as any);
    };

    const pageOne = await runPage(1);
    const pageTwo = await runPage(2);

    expect(pageOne).toHaveLength(20);
    expect(pageTwo).toHaveLength(20);
    expect(new Set([...pageOne, ...pageTwo].map((card) => card.detailUrl)).size).toBe(40);
    expect(pageOne.every((card) => card.portal === "Naukri")).toBe(true);
  });
});
