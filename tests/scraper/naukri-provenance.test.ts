import { describe, it, expect, vi } from "vitest";
import { naukriHandler } from "../../scripts/scraper/portals/naukri";
import type { PortalContext, FeedCard } from "../../scripts/scraper/types";

describe("Naukri Full-Description Provenance & Detail Bypass Contract", () => {
  it("does not infer authoritative full description solely from length (1200 chars snippet)", async () => {
    // 1200 characters of job description text
    const longSnippet = "A".repeat(1200);

    const mockJob = {
      jobId: "job_snippet_1200",
      title: "Chief Marketing Officer",
      companyName: "Acme Global",
      placeholders: [
        { type: "location", label: "Bengaluru, India" },
        { type: "experience", label: "15-20 Yrs" },
      ],
      jdURL: "https://www.naukri.com/job-listings-snippet-1200",
      jobDescription: `<p>${longSnippet}</p>`,
      // Note: NO authoritative flags (hasAuthoritativeFullDescription / isDetailedJd / descriptionProvenance)
    };

    let responseCb: any;
    const mockPage: any = {
      isClosed: () => false,
      url: () => "https://www.naukri.com/chief-marketing-officer-jobs-in-india",
      title: async () => "CMO Jobs",
      mouse: { move: vi.fn().mockResolvedValue(undefined) },
      on: (ev: string, cb: any) => { if (ev === "response") responseCb = cb; },
      off: vi.fn(),
      goto: vi.fn().mockImplementation(async () => {
        await responseCb({
          url: () => "https://www.naukri.com/jobapi/v3/search?k=chief%20marketing%20officer&pageNo=1",
          headers: () => ({ "content-type": "application/json" }),
          json: async () => ({ jobDetails: [mockJob] }),
        });
      }),
      evaluate: vi.fn().mockResolvedValue(true),
      locator: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
      waitForSelector: vi.fn().mockResolvedValue(null),
    };

    const ctx: PortalContext = {
      runId: "run-prov-1",
      portal: "Naukri",
      keyword: "chief marketing officer",
      page: 1,
      searchUrl: naukriHandler.buildSearchUrl({ query: "chief marketing officer", page: 1, maxCardsPerPage: 20 }),
      activePage: mockPage,
      searchPage: mockPage,
      maxCardsPerPage: 20,
      logger: () => {},
    };

    const cards = await naukriHandler.listCards(ctx);
    expect(cards.length).toBe(1);
    const card = cards[0];

    // INVARIANT: Even though rawText length is well over 1200 characters,
    // hasAuthoritativeFullDescription MUST be false because length is not provenance!
    expect(card.rawText!.length).toBeGreaterThan(1200);
    expect(card.hasAuthoritativeFullDescription).toBe(false);
  });

  it("sets hasAuthoritativeFullDescription = true only when explicit authoritative provenance is provided", async () => {
    const mockJobExplicit = {
      jobId: "job_auth_full_jd",
      title: "Chief Marketing Officer",
      companyName: "Acme Global",
      placeholders: [
        { type: "location", label: "Bengaluru, India" },
        { type: "experience", label: "15-20 Yrs" },
      ],
      jdURL: "https://www.naukri.com/job-listings-auth-full",
      jobDescription: "<p>Authoritative complete job specification and leadership deliverables.</p>",
      hasAuthoritativeFullDescription: true,
    };

    let responseCb: any;
    const mockPage: any = {
      isClosed: () => false,
      url: () => "https://www.naukri.com/chief-marketing-officer-jobs-in-india",
      title: async () => "CMO Jobs",
      mouse: { move: vi.fn().mockResolvedValue(undefined) },
      on: (ev: string, cb: any) => { if (ev === "response") responseCb = cb; },
      off: vi.fn(),
      goto: vi.fn().mockImplementation(async () => {
        await responseCb({
          url: () => "https://www.naukri.com/jobapi/v3/search?k=chief%20marketing%20officer&pageNo=1",
          headers: () => ({ "content-type": "application/json" }),
          json: async () => ({ jobDetails: [mockJobExplicit] }),
        });
      }),
      evaluate: vi.fn().mockResolvedValue(true),
      locator: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
      waitForSelector: vi.fn().mockResolvedValue(null),
    };

    const ctx: PortalContext = {
      runId: "run-prov-2",
      portal: "Naukri",
      keyword: "chief marketing officer",
      page: 1,
      searchUrl: naukriHandler.buildSearchUrl({ query: "chief marketing officer", page: 1, maxCardsPerPage: 20 }),
      activePage: mockPage,
      searchPage: mockPage,
      maxCardsPerPage: 20,
      logger: () => {},
    };

    const cards = await naukriHandler.listCards(ctx);
    expect(cards.length).toBe(1);
    expect(cards[0].hasAuthoritativeFullDescription).toBe(true);
  });

  it("verifies acquisition gate contract: non-authoritative snippet requires detail fetch, while authoritative bypasses", () => {
    // Simulating the acquisition gate logic from scrape.ts:
    const classifyAcquisition = (card: FeedCard) => {
      const isNaukriRichDiscovery =
        card.portal === "Naukri" &&
        card.hasAuthoritativeFullDescription === true &&
        card.rawText &&
        card.rawText.length >= 200 &&
        card.rawHtml;

      if (isNaukriRichDiscovery) {
        return "DISCOVERY_RICH_BYPASS";
      }
      return "FETCH_NATIVE_DETAIL_REQUIRED";
    };

    // Card 1: 1200 char snippet, hasAuthoritativeFullDescription: false
    const snippetCard: FeedCard = {
      cardHash: "hash-snippet",
      portal: "Naukri",
      keyword: "VP Marketing",
      searchUrl: "https://www.naukri.com/vp",
      detailUrl: "https://www.naukri.com/job-listings-snippet",
      title: "VP Marketing",
      company: "Acme",
      location: "Bengaluru",
      discoveredAt: new Date().toISOString(),
      rawText: "A".repeat(1200),
      rawHtml: `<p>${"A".repeat(1200)}</p>`,
      hasAuthoritativeFullDescription: false,
    };

    // Card 2: >200 char authoritative full description
    const fullText = "Full authoritative description with requirements, compensation, and qualifications. ".repeat(4);
    const authCard: FeedCard = {
      cardHash: "hash-auth",
      portal: "Naukri",
      keyword: "VP Marketing",
      searchUrl: "https://www.naukri.com/vp",
      detailUrl: "https://www.naukri.com/job-listings-auth",
      title: "VP Marketing",
      company: "Acme",
      location: "Bengaluru",
      discoveredAt: new Date().toISOString(),
      rawText: fullText,
      rawHtml: `<p>${fullText}</p>`,
      hasAuthoritativeFullDescription: true,
    };

    expect(classifyAcquisition(snippetCard)).toBe("FETCH_NATIVE_DETAIL_REQUIRED");
    expect(classifyAcquisition(authCard)).toBe("DISCOVERY_RICH_BYPASS");
  });
});
