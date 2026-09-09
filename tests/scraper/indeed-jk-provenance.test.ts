import { describe, it, expect, vi } from "vitest";
import { indeedHandler } from "../../scripts/scraper/portals/indeed";
import type { PortalContext } from "../../scripts/scraper/types";

describe("Indeed JK Provenance & JSON-LD Identity Invariant", () => {
  it("does NOT treat generic employer requisition ID in JSON-LD as an Indeed JK", async () => {
    const mockJsonLd = {
      "@type": "JobPosting",
      title: "VP Engineering",
      hiringOrganization: { name: "Fintech Enterprise" },
      jobLocation: { address: { addressLocality: "Bengaluru, Karnataka" } },
      url: "https://fintech.careers.example.com/jobs/requisition-9988",
      identifier: {
        "@type": "PropertyValue",
        name: "Fintech Enterprise",
        value: "REQ-9988-PROD", // Employer Requisition ID, NOT an Indeed JK!
      },
      datePosted: "2026-09-01",
      description: "<p>Direct employer posting via JSON-LD</p>",
    };

    const mockPage: any = {
      isClosed: () => false,
      goto: vi.fn().mockResolvedValue(null),
      url: vi.fn().mockReturnValue("https://in.indeed.com/jobs?q=VP+Engineering"),
      title: async () => "VP Engineering Jobs",
      evaluate: vi.fn().mockImplementation(async (fn: any) => {
        // First evaluate call is bot/captcha check (returns false)
        // Subsequent evaluate call returns extracted cards
        return [
          {
            title: mockJsonLd.title,
            company: mockJsonLd.hiringOrganization.name,
            location: mockJsonLd.jobLocation.address.addressLocality,
            rawHref: mockJsonLd.url,
            jk: "", // Not an Indeed JK
            externalRequisitionId: mockJsonLd.identifier.value,
            rawPosted: mockJsonLd.datePosted,
            rawHtml: mockJsonLd.description,
            rawText: "Direct employer posting via JSON-LD",
          }
        ];
      }),
      waitForSelector: vi.fn().mockResolvedValue(null),
    };

    const ctx: PortalContext = {
      runId: "run-jk-1",
      portal: "Indeed",
      keyword: "VP Engineering",
      page: 1,
      searchUrl: indeedHandler.buildSearchUrl({ query: "VP Engineering", page: 1 }),
      activePage: mockPage,
      searchPage: mockPage,
      maxCardsPerPage: 20,
      logger: () => {},
    };

    const cards = await indeedHandler.listCards(ctx);
    expect(cards.length).toBe(1);
    const card = cards[0];

    // INVARIANT: The employer requisition ID must NOT be synthesized into an Indeed viewjob JK URL!
    expect(card.detailUrl).not.toContain("viewjob?jk=REQ-9988-PROD");
    expect(card.detailUrl).toBe("https://fintech.careers.example.com/jobs/requisition-9988");
  });

  it("identifies authoritative 16-hex Indeed JK from DOM or URL and constructs canonical viewjob link", async () => {
    const validHexJk = "1a2b3c4d5e6f7a8b";

    const mockPage: any = {
      isClosed: () => false,
      goto: vi.fn().mockResolvedValue(null),
      url: vi.fn().mockReturnValue("https://in.indeed.com/jobs?q=VP+Engineering"),
      title: async () => "VP Engineering Jobs",
      evaluate: vi.fn().mockImplementation(async () => [
        {
          title: "VP Engineering",
          company: "Enterprise Software Corp",
          location: "Bengaluru",
          rawHref: `/rc/clk?jk=${validHexJk}&fccid=12345`,
          jk: validHexJk,
          rawPosted: "Just posted",
          rawHtml: "<p>Direct card</p>",
          rawText: "Direct card text",
        }
      ]),
      waitForSelector: vi.fn().mockResolvedValue(null),
    };

    const ctx: PortalContext = {
      runId: "run-jk-2",
      portal: "Indeed",
      keyword: "VP Engineering",
      page: 1,
      searchUrl: indeedHandler.buildSearchUrl({ query: "VP Engineering", page: 1 }),
      activePage: mockPage,
      searchPage: mockPage,
      maxCardsPerPage: 20,
      logger: () => {},
    };

    const cards = await indeedHandler.listCards(ctx);
    expect(cards.length).toBe(1);
    const card = cards[0];

    // INVARIANT: Authoritative 16-hex JK constructs the canonical viewjob URL
    expect(card.detailUrl).toBe(`https://in.indeed.com/viewjob?jk=${validHexJk}`);
    expect(card.applyRedirectUrl).toBe(`https://in.indeed.com/rc/clk?jk=${validHexJk}&fccid=12345`);
  });

  it("rejects non-hex invalid JKs and falls back safely to discovery URL", async () => {
    const invalidJk = "not-a-valid-hex-key";

    const mockPage: any = {
      isClosed: () => false,
      goto: vi.fn().mockResolvedValue(null),
      url: vi.fn().mockReturnValue("https://in.indeed.com/jobs?q=VP+Engineering"),
      title: async () => "VP Engineering Jobs",
      evaluate: vi.fn().mockImplementation(async () => [
        {
          title: "VP Engineering",
          company: "Enterprise Software Corp",
          location: "Bengaluru",
          rawHref: `https://in.indeed.com/job/vp-eng-123`,
          jk: invalidJk,
          rawPosted: "1 day ago",
          rawHtml: "<p>Job info</p>",
          rawText: "Job info",
        }
      ]),
      waitForSelector: vi.fn().mockResolvedValue(null),
    };

    const ctx: PortalContext = {
      runId: "run-jk-3",
      portal: "Indeed",
      keyword: "VP Engineering",
      page: 1,
      searchUrl: indeedHandler.buildSearchUrl({ query: "VP Engineering", page: 1 }),
      activePage: mockPage,
      searchPage: mockPage,
      maxCardsPerPage: 20,
      logger: () => {},
    };

    const cards = await indeedHandler.listCards(ctx);
    expect(cards.length).toBe(1);
    const card = cards[0];

    // INVARIANT: Non-16-hex string must NOT be treated as JK
    expect(card.detailUrl).not.toContain("viewjob?jk=not-a-valid-hex-key");
    expect(card.detailUrl).toBe("https://in.indeed.com/job/vp-eng-123");
  });
});
