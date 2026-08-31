import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { naukriHandler } from "../../scripts/scraper/portals/naukri";
import type { PortalContext } from "../../scripts/scraper/types";

describe("Naukri Cancellation & Legacy Fetch Protection Contract", () => {
  it("Naukri Architectural Invariant: Zero synthetic fetch or jobapi evaluation in listing", () => {
    const naukriCode = fs.readFileSync(
      path.resolve(process.cwd(), "scripts/scraper/portals/naukri.ts"),
      "utf-8"
    );

    // Extract the listCards implementation slice
    const listCardsStart = naukriCode.indexOf("async listCards(");
    const listCardsEnd = naukriCode.indexOf("fetchDetail,", listCardsStart);
    expect(listCardsStart).not.toBe(-1);
    expect(listCardsEnd).not.toBe(-1);
    const listCardsBody = naukriCode.slice(listCardsStart, listCardsEnd);

    // 1. Literal string check
    expect(listCardsBody.includes("[API Fetch]")).toBe(false);

    // 2. Architectural invariant: no evaluate calling fetch
    expect(/page\.evaluate\s*\(\s*async.*fetch\s*\(/s.test(listCardsBody)).toBe(false);
    expect(/evaluate\s*\(\s*\(\)\s*=>.*fetch\s*\(/s.test(listCardsBody)).toBe(false);

    // 3. Architectural invariant: no synthetic jobapi url construction
    expect(listCardsBody.includes("jobapi/v3/search")).toBe(false);

    // 4. Architectural invariant: zero page.evaluate in listCards
    expect(listCardsBody.includes("page.evaluate")).toBe(false);
  });

  it("Naukri Cancellation Contract: Immediate exit when isCancelled is true before start", async () => {
    let gotoCalled = false;
    let responseListenerAttached = false;
    let responseListenerDetached = false;

    const mockPage: any = {
      isClosed: () => false,
      url: () => "https://www.naukri.com/chief-marketing-officer-jobs-in-india",
      on: (evt: string) => {
        if (evt === "response") responseListenerAttached = true;
      },
      off: (evt: string) => {
        if (evt === "response") responseListenerDetached = true;
      },
      goto: async () => {
        gotoCalled = true;
        return null;
      }
    };

    const logs: string[] = [];
    const ctx: PortalContext = {
      portal: "Naukri",
      runId: "test-run",
      keyword: "Chief Marketing Officer",
      page: 1,
      searchUrl: "https://www.naukri.com/chief-marketing-officer-jobs-in-india",
      browserContext: {},
      activePage: mockPage,
      logger: (msg) => logs.push(msg),
      isCancelled: () => true // Pre-cancelled
    };

    const cards = await naukriHandler.listCards(ctx);

    expect(cards).toEqual([]);
    expect(gotoCalled).toBe(false);
    expect(logs.some(l => l.includes("cancelled before start"))).toBe(true);
  });

  it("Naukri Cancellation Contract: Exits wait loop immediately without triggering DOM fallback", async () => {
    let cancelled = false;
    let domFallbackTriggered = false;
    let failureArtifactDumped = false;

    const mockPage: any = {
      isClosed: () => false,
      url: () => "https://www.naukri.com/chief-marketing-officer-jobs-in-india",
      on: () => {},
      off: () => {},
      goto: async () => {
        // Simulate abort arriving right after navigation
        cancelled = true;
        return null;
      },
      title: async () => "Chief Marketing Officer Jobs",
      waitForSelector: async () => {
        domFallbackTriggered = true;
        throw new Error("Selector timeout");
      },
      locator: () => {
        domFallbackTriggered = true;
        return { all: async () => [] };
      }
    };

    const logs: string[] = [];
    const ctx: PortalContext = {
      portal: "Naukri",
      runId: "test-run",
      keyword: "Chief Marketing Officer",
      page: 1,
      searchUrl: "https://www.naukri.com/chief-marketing-officer-jobs-in-india",
      browserContext: {},
      activePage: mockPage,
      logger: (msg) => logs.push(msg),
      isCancelled: () => cancelled
    };

    const t0 = Date.now();
    const cards = await naukriHandler.listCards(ctx);
    const elapsed = Date.now() - t0;

    expect(cards).toEqual([]);
    expect(elapsed).toBeLessThan(2000);
    expect(domFallbackTriggered).toBe(false);
    expect(failureArtifactDumped).toBe(false);
  });

  it("Naukri Cancellation Contract: Closed browser during shutdown does not throw or log scraper failure", async () => {
    let isCancelled = false;
    const mockPage: any = {
      isClosed: () => false,
      url: () => "https://www.naukri.com/chief-marketing-officer-jobs-in-india",
      on: () => {},
      off: () => {},
      goto: async () => {
        isCancelled = true;
        throw new Error("locator.all: Target page, context or browser has been closed");
      },
    };

    const logs: string[] = [];
    const ctx: PortalContext = {
      portal: "Naukri",
      runId: "test-run",
      keyword: "Chief Marketing Officer",
      page: 1,
      searchUrl: "https://www.naukri.com/chief-marketing-officer-jobs-in-india",
      browserContext: {},
      activePage: mockPage,
      logger: (msg) => logs.push(msg),
      isCancelled: () => isCancelled
    };

    const cards = await naukriHandler.listCards(ctx);

    expect(cards).toEqual([]);
    expect(logs.some(l => l.includes("cancelled cleanly"))).toBe(true);
    expect(logs.some(l => l.includes("Naukri listCards failed"))).toBe(false);
  });

  it("Naukri Pagination Identity Contract: onResponse ignores mismatched page responses", async () => {
    let registeredListener: ((res: any) => Promise<void>) | null = null;

    const mockPage: any = {
      isClosed: () => false,
      url: () => "https://www.naukri.com/chief-marketing-officer-jobs-in-india-2?k=Chief%20Marketing%20Officer",
      on: (evt: string, fn: any) => {
        if (evt === "response") registeredListener = fn;
      },
      off: () => {},
      goto: async () => {
        // Simulate an in-flight Page 1 response arriving during Page 2
        if (registeredListener) {
          await registeredListener({
            url: () => "https://www.naukri.com/jobapi/v3/search?noOfResults=20&pageNo=1&k=CMO",
            headers: () => ({ "content-type": "application/json" }),
            json: async () => ({
              jobDetails: [
                { jobId: "p1-job-1", title: "Chief Marketing Officer", companyName: "Acme", jdURL: "/job-1" }
              ]
            })
          });

          // Now simulate the genuine Page 2 response
          await registeredListener({
            url: () => "https://www.naukri.com/jobapi/v3/search?noOfResults=20&pageNo=2&k=CMO",
            headers: () => ({ "content-type": "application/json" }),
            json: async () => ({
              jobDetails: [
                { jobId: "p2-job-2", title: "VP Marketing", companyName: "Globex", jdURL: "/job-2" }
              ]
            })
          });
        }
        return null;
      },
      title: async () => "Chief Marketing Officer Jobs"
    };

    const logs: string[] = [];
    const ctx: PortalContext = {
      portal: "Naukri",
      runId: "test-run",
      keyword: "Chief Marketing Officer",
      page: 2, // Querying Page 2
      searchUrl: "https://www.naukri.com/chief-marketing-officer-jobs-in-india-2?k=Chief%20Marketing%20Officer",
      browserContext: {},
      activePage: mockPage,
      logger: (msg) => logs.push(msg),
      isCancelled: () => false
    };

    const cards = await naukriHandler.listCards(ctx);

    // Assert that Page 1 job was rejected and Page 2 job was accepted
    expect(cards.length).toBe(1);
    expect(cards[0].title).toBe("VP Marketing");
    expect(cards[0].company).toBe("Globex");
    expect(logs.some(l => l.includes("Ignored mismatched JobAPI response (received Page 1, expected Page 2)"))).toBe(true);
    expect(logs.some(l => l.includes("Discovered 1 structured jobs from Naukri jobapi (Page 2)"))).toBe(true);
  });
});
