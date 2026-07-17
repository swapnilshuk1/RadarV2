import type { CardHandle, JobSnapshot, PortalContext, PortalHandler } from "../types";
import { SNAPSHOT_SCHEMA_VERSION, SCRAPER_VERSION } from "../versions";
import { CONFIG } from "../config";
import { cardHashFor } from "../utils/hash";
import { humanize, jitter, sleep } from "../utils/jitter";

export const indeedHandler: PortalHandler = {
  name: "Indeed",
  buildSearchUrl(kw, page) {
    const start = (page - 1) * 10;
    return `https://in.indeed.com/jobs?q=${encodeURIComponent(kw)}&l=India&start=${start}`;
  },
  async ensureSession(ctx) {
    const page = await ctx.browserContext.newPage();
    try {
      await page.goto("https://in.indeed.com/", { waitUntil: "domcontentloaded", timeout: CONFIG.navTimeoutMs });
      await sleep(2000);
      // Indeed doesn't strictly require login but may show CAPTCHA.
      const captcha = await page.locator('iframe[src*="captcha" i], form[action*="captcha" i]').first().count().catch(() => 0);
      if (captcha) {
        ctx.logger("Indeed CAPTCHA detected — waiting up to 2 min for manual solve.");
        const deadline = Date.now() + CONFIG.captchaGateWaitMs;
        while (Date.now() < deadline) {
          const still = await page.locator('iframe[src*="captcha" i], form[action*="captcha" i]').first().count().catch(() => 0);
          if (!still) return "ready";
          await sleep(CONFIG.captchaPollMs);
        }
        return "gated";
      }
      return "ready";
    } catch (err: any) {
      ctx.logger(`Indeed session probe failed: ${err.message}`);
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
      await sleep(2500);
      const cards = await page.locator("div.job_seen_beacon").all();
      const sliced = cards.slice(0, CONFIG.maxCardsPerPage);
      for (const card of sliced) {
        try {
          const title = ((await card.locator("h2.jobTitle, .jobTitle").first().textContent().catch(() => "")) || "").trim();
          const company = ((await card.locator('[data-testid="company-name"], .companyName').first().textContent().catch(() => "")) || "").trim();
          const location = ((await card.locator('[data-testid="text-location"], .companyLocation').first().textContent().catch(() => "")) || "").trim();
          const salary = ((await card.locator('[data-testid="attribute_snippet_testid"], .salary-snippet').first().textContent().catch(() => "")) || "").trim();
          const urlEl = card.locator("h2.jobTitle a, a[href*='/rc/clk'], a[href*='/jobs/view']").first();
          const href = ((await urlEl.getAttribute("href").catch(() => "")) || "").trim();
          if (!href || !title) continue;
          const detailUrl = href.startsWith("http") ? href : `https://in.indeed.com${href.split("&")[0]}`;
          const cardHash = cardHashFor("Indeed", detailUrl);
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
                portal: "Indeed",
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
          ctx.logger(`Indeed card parse skipped: ${err.message}`);
        }
      }
    } catch (err: any) {
      ctx.logger(`Indeed listCards failed: ${err.message}`);
    } finally {
      await page.close().catch(() => {});
    }
    return handles;
  },
};

async function fetchDetail(ctx: PortalContext, url: string) {
  const t0 = Date.now();
  const page = await ctx.browserContext.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: CONFIG.detailTimeoutMs });
    await jitter(500, 1200);
    const container = page.locator("#jobDescriptionText, .jobsearch-jobDescriptionText").first();
    const rawHtml = await container.innerHTML().catch(() => "");
    const rawText = ((await container.textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    return { fetched: true, rawHtml, rawText, fetchDurationMs: Date.now() - t0 };
  } catch (err: any) {
    return { fetched: false, fetchError: err.message, fetchDurationMs: Date.now() - t0 };
  } finally {
    await page.close().catch(() => {});
  }
}
