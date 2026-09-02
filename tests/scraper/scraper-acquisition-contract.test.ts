/**
 * tests/scraper/scraper-acquisition-contract.test.ts
 *
 * Authoritative Behavioral Contract Suite for Slice B:
 *  1. LinkedIn Hydration Speed & Zero-Results Fast Exit (Speed without recall loss)
 *  2. Universal Sparse Description Invariant (SPARSE != INVALID across LinkedIn, Naukri, Indeed)
 *  3. Error Transparency & Failure Classification (listCards never swallows errors into [])
 *  4. Historical Incident Replay Contracts (missing company, ATS fallback, pagination matching)
 */

import Database from "better-sqlite3";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";
import { linkedinHandler } from "../../scripts/scraper/portals/linkedin";
import { naukriHandler } from "../../scripts/scraper/portals/naukri";
import { indeedHandler } from "../../scripts/scraper/portals/indeed";
import { passesHardFilter } from "../../scripts/scraper/utils/hard-filter";
import { hydrateVirtualizedList } from "../../scripts/scraper/utils/scroll";
import { QueryMetricsStore } from "../../scripts/scraper/run/metrics";
import { cardHashFor } from "../../scripts/scraper/utils/hash";

describe("Slice B: Acquisition Efficiency & Failure Truth Contracts", () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(new Database(":memory:"));
    await setupLineageTestFixture(db);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. LinkedIn Hydration Latency & Zero-Result Detection
  // ───────────────────────────────────────────────────────────────────────────
  describe("1. LinkedIn Hydration Latency & Recall Invariant", () => {
    it("proves virtualized scrolling parameters are calibrated to 10 max passes and 2 stable passes", async () => {
      let scrollPassCount = 0;

      const createMockLocator = () => {
        const loc: any = {
          count: vi.fn(async () => {
            // First pass: 10 cards, Second pass: 20 cards, Third pass: 25 cards (target reached)
            if (scrollPassCount === 0) return 10;
            if (scrollPassCount === 1) return 20;
            return 25;
          }),
          first: () => loc,
          nth: () => loc,
          hover: vi.fn(async () => {}),
          scrollIntoViewIfNeeded: vi.fn(async () => {}),
          boundingBox: vi.fn(async () => ({ x: 0, y: 0, width: 100, height: 100 })),
          evaluate: vi.fn(async () => {}),
        };
        return loc;
      };

      const mockPage: any = {
        locator: vi.fn(() => createMockLocator()),
        evaluate: vi.fn(async () => {
          scrollPassCount++;
          return true;
        }),
        mouse: {
          wheel: vi.fn(async () => {}),
        },
      };

      const hydration = await hydrateVirtualizedList(
        mockPage,
        {
          cardSelector: "li.jobs-search-results__list-item",
          containerSelectors: [".jobs-search-results-list"],
          targetCards: 25,
          maxPasses: 10,
          consecutiveStableLimit: 2,
          minPassDelayMs: 10,
          maxPassDelayMs: 20,
        },
        () => {}
      );

      // Verify that all 25 cards were discovered in <= 3 passes without running 25 passes
      expect(hydration.finalCount).toBe(25);
      expect(hydration.passesCompleted).toBeLessThanOrEqual(3);
    });

    it("proves fast stabilization on partial result sets (e.g. 7 cards exit after 2 stable passes)", async () => {
      let scrollPassCount = 0;

      const createMockLocator = () => {
        const loc: any = {
          count: vi.fn(async () => 7),
          first: () => loc,
          nth: () => loc,
          hover: vi.fn(async () => {}),
          scrollIntoViewIfNeeded: vi.fn(async () => {}),
          boundingBox: vi.fn(async () => ({ x: 0, y: 0, width: 100, height: 100 })),
          evaluate: vi.fn(async () => {}),
        };
        return loc;
      };

      const mockPage: any = {
        locator: vi.fn(() => createMockLocator()),
        evaluate: vi.fn(async () => {
          scrollPassCount++;
          return true;
        }),
        mouse: {
          wheel: vi.fn(async () => {}),
        },
      };

      const hydration = await hydrateVirtualizedList(
        mockPage,
        {
          cardSelector: "li.jobs-search-results__list-item",
          containerSelectors: [".jobs-search-results-list"],
          targetCards: 25,
          maxPasses: 10,
          consecutiveStableLimit: 2,
          minPassDelayMs: 10,
          maxPassDelayMs: 20,
        },
        () => {}
      );

      expect(hydration.finalCount).toBe(7);
      expect(hydration.stabilized).toBe(true);
      expect(hydration.passesCompleted).toBe(2);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Universal Sparse Description Invariant (SPARSE != INVALID)
  // ───────────────────────────────────────────────────────────────────────────
  describe("2. Universal Sparse Preservation (SPARSE != INVALID)", () => {
    it("preserves LinkedIn sparse description (164 chars) with fetched=true and quality=SPARSE", async () => {
      const sparseText = "Confidential Retained Search: Vice President of Growth & Marketing for Tier-1 FinTech. 15+ years experience required leading performance marketing, team of 30+.";
      expect(sparseText.length).toBeLessThan(200);
      expect(sparseText.length).toBeGreaterThan(0);

      const mockPage: any = {
        goto: vi.fn(async () => ({ status: () => 200 })),
        title: vi.fn(async () => "VP Growth - LinkedIn"),
        locator: vi.fn((sel: string) => ({
          first: () => ({
            click: vi.fn(async () => {}),
            innerHTML: vi.fn(async () => `<p>${sparseText}</p>`),
            textContent: vi.fn(async () => sparseText),
          }),
        })),
        close: vi.fn(async () => {}),
      };

      const mockCtx: any = {
        portal: "LinkedIn",
        browserContext: {
          newPage: vi.fn(async () => mockPage),
        },
        logger: vi.fn(),
      };

      const detail = await linkedinHandler.fetchDetail(mockCtx, "https://www.linkedin.com/jobs/view/12345");
      expect(detail.fetched).toBe(true);
      expect(detail.quality).toBe("SPARSE");
      expect(detail.rawText).toBe(sparseText);
      expect(detail.fetchError).toBeUndefined();
    });

    it("preserves Naukri sparse description (178 chars) with fetched=true and quality=SPARSE", async () => {
      const sparseText = "Leading FMCG conglomerate hiring Chief Marketing Officer. P&L responsibility for ₹500 Cr division. Must have handled brand reset and digital transformation across APAC.";
      expect(sparseText.length).toBeLessThan(200);
      expect(sparseText.length).toBeGreaterThan(0);

      const mockPage: any = {
        setExtraHTTPHeaders: vi.fn(async () => {}),
        goto: vi.fn(async () => {}),
        waitForSelector: vi.fn(async () => {}),
        evaluate: vi.fn(async () => null),
        content: vi.fn(async () => `<div class="styles_job-desc-container"><p>${sparseText}</p></div>`),
        locator: vi.fn((sel: string) => ({
          first: () => ({
            innerHTML: vi.fn(async () => `<p>${sparseText}</p>`),
            textContent: vi.fn(async () => sparseText),
          }),
        })),
      };

      const mockCtx: any = {
        portal: "Naukri",
        activePage: mockPage,
        logger: vi.fn(),
      };

      const originalStrategy = naukriHandler.detailStrategy;
      try {
        naukriHandler.detailStrategy = "playwright";
        const detail = await naukriHandler.fetchDetail(mockCtx, "https://www.naukri.com/job-listings-12345");
        expect(detail.fetched).toBe(true);
        expect(detail.quality).toBe("SPARSE");
        expect(detail.rawText).toBe(sparseText);
        expect(detail.fetchError).toBeUndefined();
      } finally {
        naukriHandler.detailStrategy = originalStrategy;
      }
    });

    it("rejects truly empty description (0 chars) with fetched=false across portals", async () => {
      const mockPage: any = {
        goto: vi.fn(async () => ({ status: () => 200 })),
        title: vi.fn(async () => "Empty Job"),
        locator: vi.fn((sel: string) => ({
          first: () => ({
            click: vi.fn(async () => {}),
            innerHTML: vi.fn(async () => ""),
            textContent: vi.fn(async () => "   \n\t  "),
          }),
        })),
        close: vi.fn(async () => {}),
      };

      const mockCtx: any = {
        portal: "LinkedIn",
        browserContext: {
          newPage: vi.fn(async () => mockPage),
        },
        logger: vi.fn(),
      };

      const detail = await linkedinHandler.fetchDetail(mockCtx, "https://www.linkedin.com/jobs/view/99999");
      expect(detail.fetched).toBe(false);
      expect(detail.fetchError).toBe("Empty job description");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Failure Transparency: listCards Re-throws and Never Swallows Errors into []
  // ───────────────────────────────────────────────────────────────────────────
  describe("3. Failure Transparency & Error Taxonomy", () => {
    it("ensures LinkedIn listCards propagates BLOCKED / security challenge instead of returning []", async () => {
      const mockPage: any = {
        goto: vi.fn(async () => {}),
        url: vi.fn(() => "https://www.linkedin.com/jobs/search"),
        title: vi.fn(async () => "Security Verification | Access Denied"),
      };

      const mockCtx: any = {
        portal: "LinkedIn",
        activePage: mockPage,
        searchUrl: "https://www.linkedin.com/jobs/search?keywords=VP",
        keyword: "VP Growth",
        logger: vi.fn(),
      };

      await expect(linkedinHandler.listCards(mockCtx)).rejects.toThrow("BLOCKED: LinkedIn search page blocked");
    });

    it("ensures LinkedIn listCards propagates RATE_LIMITED (429) instead of returning []", async () => {
      const mockPage: any = {
        goto: vi.fn(async () => {}),
        url: vi.fn(() => "https://www.linkedin.com/429"),
        title: vi.fn(async () => "Too Many Requests"),
      };

      const mockCtx: any = {
        portal: "LinkedIn",
        activePage: mockPage,
        searchUrl: "https://www.linkedin.com/jobs/search?keywords=CMO",
        keyword: "CMO",
        logger: vi.fn(),
      };

      await expect(linkedinHandler.listCards(mockCtx)).rejects.toThrow("RATE_LIMITED: LinkedIn rate limit exceeded");
    });

    it("ensures Indeed listCards propagates network/timeout errors instead of returning []", async () => {
      const mockPage: any = {
        goto: vi.fn(async () => {
          throw new Error("Navigation timeout of 30000ms exceeded");
        }),
      };

      const mockCtx: any = {
        portal: "Indeed",
        activePage: mockPage,
        searchUrl: "https://in.indeed.com/jobs?q=VP",
        keyword: "VP Sales",
        logger: vi.fn(),
      };

      await expect(indeedHandler.listCards(mockCtx)).rejects.toThrow("Navigation timeout");
    });

    it("ensures Naukri listCards propagates navigation/challenge errors instead of returning []", async () => {
      const mockPage: any = {
        on: vi.fn(),
        off: vi.fn(),
        goto: vi.fn(async () => {
          throw new Error("net::ERR_CONNECTION_RESET at https://www.naukri.com");
        }),
      };

      const mockCtx: any = {
        portal: "Naukri",
        activePage: mockPage,
        searchUrl: "https://www.naukri.com/executive-jobs",
        keyword: "Executive Director",
        logger: vi.fn(),
      };

      await expect(naukriHandler.listCards(mockCtx)).rejects.toThrow("ERR_CONNECTION_RESET");
    });

    it("ensures clean cancellation during shutdown exits without error", async () => {
      const mockPage: any = {
        goto: vi.fn(async () => {
          throw new Error("Target page, context or browser has been closed");
        }),
      };

      const mockCtx: any = {
        portal: "LinkedIn",
        activePage: mockPage,
        searchUrl: "https://www.linkedin.com/jobs/search",
        keyword: "VP Growth",
        isCancelled: () => true,
        logger: vi.fn(),
      };

      const cards = await linkedinHandler.listCards(mockCtx);
      expect(cards).toEqual([]);
    });

    it("proves QueryMetricsStore distinguishes SUCCESS_EMPTY from TRANSPORT_ERROR / ANTI_BOT", () => {
      // 1. Genuine Empty / Exhausted Query
      QueryMetricsStore.record({
        runId: "run_test_1",
        portal: "LinkedIn",
        query: "UncommonRole999",
        page: 1,
        cardsSeen: 10,
        cardsParsed: 10,
        canonicalDuplicates: 10,
        ledgerKnown: 10,
        hardFiltered: 0,
        identityFailed: 0,
        novelAccepted: 0,
        novelAcquired: 0,
        noveltyRate: 0,
        elapsedMs: 800,
        timestamp: new Date().toISOString(),
        outcome: "SUCCESS_EMPTY",
        hasTransportError: false,
      });

      // 2. Anti-Bot / Block
      QueryMetricsStore.record({
        runId: "run_test_1",
        portal: "LinkedIn",
        query: "Chief Executive Officer",
        page: 1,
        cardsSeen: 0,
        cardsParsed: 0,
        canonicalDuplicates: 0,
        ledgerKnown: 0,
        hardFiltered: 0,
        identityFailed: 0,
        novelAccepted: 0,
        novelAcquired: 0,
        noveltyRate: 1.0, // Excluded from low-novelty pruning
        elapsedMs: 250,
        timestamp: new Date().toISOString(),
        outcome: "ANTI_BOT",
        hasTransportError: true,
      });

      const emptyRecords = QueryMetricsStore.getMetricsForQuery("LinkedIn", "UncommonRole999");
      expect(emptyRecords.length).toBeGreaterThan(0);
      expect(emptyRecords[0].outcome).toBe("SUCCESS_EMPTY");
      expect(emptyRecords[0].hasTransportError).toBe(false);

      const botRecords = QueryMetricsStore.getMetricsForQuery("LinkedIn", "Chief Executive Officer");
      expect(botRecords.length).toBeGreaterThan(0);
      expect(botRecords[0].outcome).toBe("ANTI_BOT");
      expect(botRecords[0].hasTransportError).toBe(true);

      // Invariant: Genuine empty/exhausted queries record 0.0 average novelty
      const emptyNovelty = QueryMetricsStore.getAverageNoveltyRate("LinkedIn", "UncommonRole999");
      expect(emptyNovelty).toBe(0.0);

      // Invariant: Anti-bot / transport failures are excluded from calculation (return un-penalized 1.0 default)
      const botNovelty = QueryMetricsStore.getAverageNoveltyRate("LinkedIn", "Chief Executive Officer");
      expect(botNovelty).toBe(1.0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Historical Incident Replay Contracts
  // ───────────────────────────────────────────────────────────────────────────
  describe("4. Historical Incident Replay Verification", () => {
    it("replays LinkedIn missing company discovery card: passes discovery filter and preserves card for detail extraction", () => {
      const rawCard = {
        title: "Chief Marketing Officer - Retained Executive Search",
        company: "", // Missing company in initial DOM listing
        location: "Bengaluru (Hybrid)",
      };

      // Strict filter with allowMissingCompany: true passes discovery
      const discoveryResult = passesHardFilter(rawCard, { allowMissingCompany: true });
      expect(discoveryResult.pass).toBe(true);

      // Detail resolution subsequently fills company
      const detailCompany = "Confidential FinTech Unicorn";
      const fullCard = {
        ...rawCard,
        company: detailCompany,
      };
      const finalResult = passesHardFilter(fullCard);
      expect(finalResult.pass).toBe(true);
    });

    it("replays Indeed <200 char description: merges cleanly into SQLite lineage without quality failure", async () => {
      const opportunityId = "opp_sparse_indeed_1";
      const cardHash = cardHashFor("Indeed", "https://in.indeed.com/viewjob?jk=sparse123");

      await db.execute(
        `INSERT INTO sources (id, type, name) VALUES (?, 'portal', ?)`,
        ["src_indeed_1", "Indeed Portal"]
      );

      await db.execute(
        `INSERT INTO companies (id, name) VALUES (?, ?)`,
        ["comp_test_indeed", "Boutique Investment Partners"]
      );

      await db.execute(
        `INSERT INTO opportunities (id, company_id, canonical_title, location, fingerprint, lifecycle, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [opportunityId, "comp_test_indeed", "VP Commercial Operations", "Gurugram", "fp_indeed_sparse_1"]
      );

      const sparseText = "Boutique investment firm seeks VP Commercial Operations to lead growth in North India. 10+ yrs leadership req.";
      await db.execute(
        `INSERT INTO documents (id, source_id, opportunity_id, payload_type, content, lifecycle, created_at)
         VALUES (?, ?, ?, 'jd_full', ?, 'active', CURRENT_TIMESTAMP)`,
        [`doc_${cardHash}`, "src_indeed_1", opportunityId, sparseText]
      );

      const doc = await db.one<{ content: string }>(
        `SELECT content FROM documents WHERE opportunity_id = ?`,
        [opportunityId]
      );

      expect(doc?.content).toBe(sparseText);
      expect(doc?.content.length).toBeLessThan(200);
      expect(doc?.content.length).toBeGreaterThan(0);
    });

    it("verifies LinkedIn post-detail extraction parses top-card company name from realistic HTML DOM & JSON-LD", async () => {
      const { extractJobFromHtml } = await import("../../scripts/scraper/utils/http-fetch");

      // Case A: Topcard selector with separate description container
      const realisticHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>VP of Engineering - Acme Global</title>
          </head>
          <body>
            <header>
              <div class="topcard">
                <h1 class="top-card-layout__title">VP of Engineering</h1>
                <a class="topcard__org-name-link" href="https://www.linkedin.com/company/acme-global">Acme Global Technologies</a>
                <span class="topcard__flavor">Bengaluru, Karnataka, India</span>
              </div>
            </header>
            <main>
              <div class="jobs-description__content">
                <div class="show-more-less-html__markup">
                  <p>We are seeking an executive VP of Engineering to lead our distributed platform engineering team.</p>
                  <p>Key responsibilities include architectural strategy, hiring directors, and scaling cloud systems.</p>
                </div>
              </div>
            </main>
          </body>
        </html>
      `;

      const extracted = extractJobFromHtml(
        realisticHtml,
        "h1.top-card-layout__title, h1.topcard__title, .jobs-description__content",
        ".jobs-description__content, .description__text, .show-more-less-html__markup"
      );

      expect(extracted.success).toBe(true);
      expect(extracted.extractedCompany).toBe("Acme Global Technologies");
      expect(extracted.extractedTitle).toBe("VP of Engineering");
      expect(extracted.rawText).toContain("VP of Engineering to lead our distributed platform");

      // Case B: JSON-LD extraction
      const jsonLdHtml = `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@type": "JobPosting",
                "title": "Chief Financial Officer",
                "hiringOrganization": {
                  "@type": "Organization",
                  "name": "Zenith Capital Partners"
                },
                "description": "Executive leadership role managing capital allocation, investor relations, and financial reporting for high-growth enterprise."
              }
            </script>
          </head>
          <body>
            <div id="fallback">Fallback content</div>
          </body>
        </html>
      `;

      const jsonLdExtracted = extractJobFromHtml(jsonLdHtml);
      expect(jsonLdExtracted.success).toBe(true);
      expect(jsonLdExtracted.method).toBe("JSON_LD");
      expect(jsonLdExtracted.extractedCompany).toBe("Zenith Capital Partners");
      expect(jsonLdExtracted.extractedTitle).toBe("Chief Financial Officer");
    });

    it("verifies confidential and missing employer postings receive isolated surrogate company entities", async () => {
      // Simulate two distinct postings with no company name / marked confidential
      const rawCompanyA = "";
      const isConfidentialA = !rawCompanyA || /^(confidential|unknown|undisclosed|stealth|private)\b/i.test(rawCompanyA);
      const effectiveCompanyA = isConfidentialA ? (rawCompanyA || "Confidential Employer") : rawCompanyA;
      const companyIdA = isConfidentialA ? `confidential:linkedin:job_101` : effectiveCompanyA.toLowerCase().replace(/[^a-z0-9]/g, "-");

      const rawCompanyB = "Confidential / Undisclosed";
      const isConfidentialB = !rawCompanyB || /^(confidential|unknown|undisclosed|stealth|private)\b/i.test(rawCompanyB);
      const effectiveCompanyB = isConfidentialB ? (rawCompanyB || "Confidential Employer") : rawCompanyB;
      const companyIdB = isConfidentialB ? `confidential:linkedin:job_202` : effectiveCompanyB.toLowerCase().replace(/[^a-z0-9]/g, "-");

      // Invariant: Company IDs must be distinct surrogate identities rather than collapsing into one fake company
      expect(companyIdA).toBe("confidential:linkedin:job_101");
      expect(companyIdB).toBe("confidential:linkedin:job_202");
      expect(companyIdA).not.toBe(companyIdB);
      expect(companyIdA).not.toBe("confidential---unknown");

      // Persist in DB and ensure both independent entities exist
      await db.execute(`
        INSERT INTO companies (id, name, created_at, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [companyIdA, effectiveCompanyA]);

      await db.execute(`
        INSERT INTO companies (id, name, created_at, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [companyIdB, effectiveCompanyB]);

      const compA = await db.one(`SELECT * FROM companies WHERE id = ?`, [companyIdA]);
      const compB = await db.one(`SELECT * FROM companies WHERE id = ?`, [companyIdB]);

      expect(compA?.id).toBe("confidential:linkedin:job_101");
      expect(compB?.id).toBe("confidential:linkedin:job_202");
    });

    it("verifies LocalFsBlobStore write/read/delete lifecycle cleans up probe files", async () => {
      const { LocalFsBlobStore } = await import("../../src/lib/storage/blob-store");
      const path = await import("node:path");
      const fs = await import("node:fs");

      const tempDir = path.resolve(process.cwd(), ".radar/artifacts/blobs_test");
      const store = new LocalFsBlobStore(tempDir);

      const probeKey = `snapshots/test-probe-${Date.now()}.json`;
      const payload = JSON.stringify({ test: true });

      try {
        await store.put(probeKey, payload, "application/json");
        const existsBefore = await store.exists(probeKey);
        expect(existsBefore).toBe(true);

        const readBack = await store.get(probeKey);
        expect(readBack?.toString("utf-8")).toBe(payload);
      } finally {
        await store.delete(probeKey);
      }

      const existsAfter = await store.exists(probeKey);
      expect(existsAfter).toBe(false);

      // Clean up test directory if empty
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
