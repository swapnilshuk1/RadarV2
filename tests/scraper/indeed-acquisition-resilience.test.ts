import { describe, it, expect, vi } from "vitest";
import { indeedHandler } from "../../scripts/scraper/portals/indeed";
import type { PortalContext } from "../../scripts/scraper/types";

describe("Indeed Acquisition Resilience Invariant", () => {
  it("extracts 25 cards from DOM selector results up to target quota", async () => {
    const rawCards = Array.from({ length: 25 }, (_, i) => ({
      title: `Chief Marketing Officer ${i + 1}`,
      company: `Enterprise ${i + 1} Corp`,
      location: "Bengaluru, Karnataka",
      salary: "₹50,00,000 - ₹70,00,000 a year",
      rawHref: `/rc/clk?jk=indeed_jk_${i + 1}`,
      jk: `indeed_jk_${i + 1}`,
      rawPosted: "Just posted",
      rawHtml: `<div>Job description ${i + 1}</div>`,
      rawText: `Job description ${i + 1}`,
    }));

    const mockPage: any = {
      isClosed: () => false,
      content: async () => "<html></html>",
      goto: vi.fn().mockResolvedValue(undefined),
      title: async () => "Marketing Jobs in Bengaluru - Indeed",
      url: () => "https://in.indeed.com/jobs?q=Chief+Marketing+Officer",
      waitForSelector: vi.fn().mockResolvedValue(true),
      evaluate: vi.fn().mockImplementation((fn: any, arg: any) => {
        // If passed selector, return DOM cards
        if (typeof fn === "function" && arg) {
          return Promise.resolve(rawCards);
        }
        return Promise.resolve(false);
      }),
    };

    const ctx: PortalContext = {
      runId: "run-test",
      portal: "Indeed",
      keyword: "Chief Marketing Officer",
      page: 1,
      searchUrl: "https://in.indeed.com/jobs?q=Chief+Marketing+Officer",
      activePage: mockPage,
      searchPage: mockPage,
      maxCardsPerPage: 25,
      logger: () => {},
    };

    const cards = await indeedHandler.listCards(ctx);
    expect(cards.length).toBe(25);
    expect(cards[0].title).toBe("Chief Marketing Officer 1");
    expect(cards[24].title).toBe("Chief Marketing Officer 25");
  });

  it("falls back to structured embedded mosaic data when DOM selector is absent", async () => {
    const structuredMosaicJobs = Array.from({ length: 15 }, (_, i) => ({
      title: `VP Growth & Marketing ${i + 1}`,
      company: `Growth Co ${i + 1}`,
      location: "Mumbai, Maharashtra",
      salary: "₹60 Lacs",
      rawHref: `https://in.indeed.com/viewjob?jk=mosaic_jk_${i + 1}`,
      jk: `mosaic_jk_${i + 1}`,
      rawPosted: "2 days ago",
      rawHtml: `<p>Strategic growth role ${i + 1}</p>`,
      rawText: `Strategic growth role ${i + 1}`,
    }));

    let callCount = 0;
    const mockPage: any = {
      isClosed: () => false,
      content: async () => "<html></html>",
      goto: vi.fn().mockResolvedValue(undefined),
      title: async () => "Indeed Search",
      url: () => "https://in.indeed.com/jobs",
      screenshot: vi.fn().mockResolvedValue(Buffer.from("")),
      waitForSelector: vi.fn().mockRejectedValue(new Error("Selector timeout")),
      evaluate: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(false); // isBlocked check
        // Subsequent evaluate is structured mosaic data
        return Promise.resolve(structuredMosaicJobs);
      }),
    };

    const ctx: PortalContext = {
      runId: "run-test",
      portal: "Indeed",
      keyword: "VP Growth",
      page: 1,
      searchUrl: "https://in.indeed.com/jobs?q=VP+Growth",
      activePage: mockPage,
      searchPage: mockPage,
      maxCardsPerPage: 25,
      logger: () => {},
    };

    const cards = await indeedHandler.listCards(ctx);
    expect(cards.length).toBe(15);
    expect(cards[0].title).toBe("VP Growth & Marketing 1");
    expect(cards[0].company).toBe("Growth Co 1");
  });

  it("handles complete absence of DOM and structured data with bounded empty return without hanging", async () => {
    const mockPage: any = {
      isClosed: () => false,
      content: async () => "<html></html>",
      goto: vi.fn().mockResolvedValue(undefined),
      title: async () => "Indeed Search",
      url: () => "https://in.indeed.com/jobs",
      screenshot: vi.fn().mockResolvedValue(Buffer.from("")),
      waitForSelector: vi.fn().mockRejectedValue(new Error("Selector timeout")),
      evaluate: vi.fn().mockImplementation((fn: any, arg: any) => {
        if (typeof fn === "function" && arg) return Promise.resolve([]);
        return Promise.resolve(false);
      }),
    };

    const ctx: PortalContext = {
      runId: "run-test",
      portal: "Indeed",
      keyword: "NonExistentJobTitleXYZ",
      page: 1,
      searchUrl: "https://in.indeed.com/jobs?q=NonExistentJobTitleXYZ",
      activePage: mockPage,
      searchPage: mockPage,
      maxCardsPerPage: 25,
      logger: () => {},
    };

    const startTime = Date.now();
    const cards = await indeedHandler.listCards(ctx);
    const elapsed = Date.now() - startTime;

    expect(cards).toEqual([]);
    // Bounded execution completes promptly
    expect(elapsed).toBeLessThan(3000);
  });

  it("classifies anti-bot challenge / Cloudflare block pages cleanly without hanging (Gate 6)", async () => {
    const mockPage: any = {
      isClosed: () => false,
      content: async () => "<html><title>Just a moment...</title><body><div id='cf-challenge'></div></body></html>",
      goto: vi.fn().mockResolvedValue(undefined),
      title: async () => "Just a moment...",
      url: () => "https://in.indeed.com/jobs?q=Chief+Marketing+Officer",
      evaluate: vi.fn().mockResolvedValue(true), // isBlocked returns true
    };

    const ctx: PortalContext = {
      runId: "run-test",
      portal: "Indeed",
      keyword: "Chief Marketing Officer",
      page: 1,
      searchUrl: "https://in.indeed.com/jobs?q=Chief+Marketing+Officer",
      activePage: mockPage,
      searchPage: mockPage,
      maxCardsPerPage: 25,
      logger: () => {},
    };

    await expect(indeedHandler.listCards(ctx)).rejects.toThrow("Indeed search blocked by anti-bot verification");
  });
});
