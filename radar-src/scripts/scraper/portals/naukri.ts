import type { CardHandle, JobSnapshot, PortalContext, PortalHandler } from "../types";
import { SNAPSHOT_SCHEMA_VERSION, SCRAPER_VERSION } from "../versions";
import { CONFIG } from "../config";
import { cardHashFor } from "../utils/hash";
import { humanize, jitter, sleep } from "../utils/jitter";

export const naukriHandler: PortalHandler = {
  name: "Naukri",
  buildSearchUrl(kw, page) {
    const slug = kw.toLowerCase().replace(/\s+/g, "-");
    return `https://www.naukri.com/${slug}-jobs-in-india${page > 1 ? `-${page}` : ""}?k=${encodeURIComponent(kw)}`;
  },
  async ensureSession(ctx) {
    const page = await ctx.browserContext.newPage();
    try {
      await page.goto("https://www.naukri.com/", { waitUntil: "domcontentloaded", timeout: CONFIG.navTimeoutMs });
      await sleep(2500);
      return "ready";
    } catch (err: any) {
      ctx.logger(`Naukri session probe failed: ${err.message}`);
      return "error";
    } finally {
      await page.close().catch(() => {});
    }
  },
  async listCards(ctx) {
    const page = await ctx.browserContext.newPage();
    const handles: CardHandle[] = [];
    try {
      await page.goto(ctx.searchUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.navTimeoutMs });
      await humanize(page);
      await sleep(3000);
      const cards = await page.locator(".srp-jobtuple-wrapper, .cust-job-tuple").all();
      const sliced = cards.slice(0, CONFIG.maxCardsPerPage);
      for (const card of sliced) {
        try {
          const titleEl = card.locator("a.title, .title").first();
          const title = ((await titleEl.textContent().catch(() => "")) || "").trim();
          const company = ((await card.locator("a.comp-name, .comp-name").first().textContent().catch(() => "")) || "").trim();
          const location = ((await card.locator(".locWdth, span.loc").first().textContent().catch(() => "")) || "").trim();
          const salary = ((await card.locator(".sal-wrap, span.sal").first().textContent().catch(() => "")) || "").trim();
          const href = ((await titleEl.getAttribute("href").catch(() => "")) || "").trim();
          if (!href || !title) continue;
          // Naukri hrefs are sometimes relative — always resolve absolutely
          // (docs/scraper-quick-wins §8).
          const detailUrl = href.startsWith("http") ? href : `https://www.naukri.com${href.startsWith("/") ? "" : "/"}${href}`;
          const cardHash = cardHashFor("Naukri", detailUrl);
          const rawHtml = await card.innerHTML().catch(() => "");
          const rawText = ((await card.textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
          handles.push({
            cardHash,
            detailUrl,
            extractSnapshot: async () => {
              const detail = await fetchDetail(ctx, detailUrl);
              return {
                snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
                scraperVersion: SCRAPER_VERSION,
                cardHash,
                portal: "Naukri",
                keyword: ctx.keyword,
                discoveredAt: new Date().toISOString(),
                searchUrl: ctx.searchUrl,
                detailUrl,
                card: { rawHtml, rawText, title, company, location, salary },
                detail,
                telemetry: { cardExtractMs: 0, detailExtractMs: detail.fetchDurationMs || 0, totalMs: detail.fetchDurationMs || 0 },
              } as JobSnapshot;
            },
          });
        } catch (err: any) {
          ctx.logger(`Naukri card parse skipped: ${err.message}`);
        }
      }
    } catch (err: any) {
      ctx.logger(`Naukri listCards failed: ${err.message}`);
    } finally {
      await page.close().catch(() => {});
    }
    return handles;
  },
};

async function fetchDetail(ctx: PortalContext, url: string) {
  const t0 = Date.now();
  // Naukri opens detail in a new tab from the card click — but we already have
  // the absolute URL, so open it directly and close after read. This is the
  // fix for the "tab bloat" issue called out in the plan.
  const page = await ctx.browserContext.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: CONFIG.detailTimeoutMs });
    await jitter(700, 1500);
    const container = page.locator(".styles_JDC__dang-inner-html__h0K4t, .job-desc, section.job-desc, .styles_job-desc-container__txpYf").first();
    const rawHtml = await container.innerHTML().catch(() => "");
    const rawText = ((await container.textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    return { fetched: true, rawHtml, rawText, fetchDurationMs: Date.now() - t0 };
  } catch (err: any) {
    return { fetched: false, fetchError: err.message, fetchDurationMs: Date.now() - t0 };
  } finally {
    await page.close().catch(() => {});
  }
}
