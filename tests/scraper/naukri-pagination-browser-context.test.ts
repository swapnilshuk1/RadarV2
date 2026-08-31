import { describe, it, expect, vi } from "vitest";
import { naukriHandler } from "../../scripts/scraper/portals/naukri";

describe("Naukri Browser-Context Pagination Lifecycle Contract", () => {
  it("builds canonical paginated search URLs for multi-unit dispatch", () => {
    const urlP1 = naukriHandler.buildSearchUrl("Chief Marketing Officer", 1);
    const urlP2 = naukriHandler.buildSearchUrl("Chief Marketing Officer", 2);
    const urlP3 = naukriHandler.buildSearchUrl("Chief Marketing Officer", 3);

    expect(urlP1).toBe("https://www.naukri.com/chief-marketing-officer-jobs-in-india?k=Chief%20Marketing%20Officer&pageNo=1");
    expect(urlP2).toBe("https://www.naukri.com/chief-marketing-officer-jobs-in-india-2?k=Chief%20Marketing%20Officer&pageNo=2");
    expect(urlP3).toBe("https://www.naukri.com/chief-marketing-officer-jobs-in-india-3?k=Chief%20Marketing%20Officer&pageNo=3");
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
      evaluate: vi.fn().mockImplementation(async (fn: any, args: any) => {
        evaluateCalls.push(JSON.stringify(args));
        return [];
      })
    };

    const mockCtx: any = {
      portal: "Naukri",
      keyword: "Chief Marketing Officer",
      page: 1,
      searchUrl: "https://www.naukri.com/chief-marketing-officer-jobs-in-india-1?k=Chief%20Marketing%20Officer",
      activePage: mockPage,
      logger: vi.fn(),
      maxCards: 20
    };

    await naukriHandler.listCards(mockCtx);

    // Invariant: No evaluate calls should be fetching pageNo: 2 or pageNo: 3 inside Page 1!
    const page2Fetch = evaluateCalls.some(c => c.includes('"pageNo":2') || c.includes('"pageNo": 2'));
    expect(page2Fetch).toBe(false);
  });
});
