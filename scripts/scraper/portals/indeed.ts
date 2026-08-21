import type { FeedCard, DetailedCard, PortalContext, PortalHandler } from "../types";
import { SNAPSHOT_SCHEMA_VERSION, SCRAPER_VERSION } from "../versions";
import { CONFIG } from "../config";
import { cardHashFor } from "../utils/hash";
import { humanize, jitter, sleep } from "../utils/jitter";
import { passesHardFilter } from "../utils/hard-filter";
import { normalizePostingDate } from "../utils/date";

export const indeedHandler: PortalHandler = {
  name: "Indeed",
  detailStrategy: "browser",
  buildSearchUrl(kw, page) {
    const start = (page - 1) * 10;
    return `https://in.indeed.com/jobs?q=${encodeURIComponent(kw)}&l=India&start=${start}`;
  },
  async ensureSession(ctx) {
    const page = ctx.activePage;
    let keepOpen = false;
    try {
      // Catch timeout to avoid crashing the session probe. We can still verify state via URL/DOM.
      await page.goto("https://in.indeed.com/", {
        waitUntil: "domcontentloaded",
        timeout: CONFIG.navTimeoutMs,
      }).catch((e: any) => ctx.logger(`Navigation timeout caught (non-fatal): ${e.message}`));
      
      await page.waitForLoadState("load", { timeout: 10000 }).catch(() => {});
      // Indeed doesn't strictly require login but may show CAPTCHA.
      const captcha = await page.locator('iframe[src*="captcha" i], form[action*="captcha" i]').first().count().catch(() => 0);
      if (captcha) {
        ctx.logger("Indeed CAPTCHA detected — returning 'gated'.");
        keepOpen = true;
        return "gated";
      }
      if (ctx.authSession) {
        await ctx.authSession.reportHealth("active").catch(() => {});
      }
      return "ready";
    } catch (err: any) {
      ctx.logger(`Indeed session probe failed: ${err.message}`);
      return "error";
    }
  },
  async listCards(ctx) {
    const page = ctx.activePage;
    const cardsOut: FeedCard[] = [];

    // Ordered priority list — pick the first selector that appears in the DOM.
    // Indeed A/B-tests its markup heavily; using an array is more resilient
    // than relying on a single class name.
    const CARD_SELECTORS = [
      "li[data-jk]",
      "div.job_seen_beacon",
      "[class*='job_seen_beacon']",
      ".slider_container",
      ".resultContent",
    ].join(", ");

    try {
      const startGoto = Date.now();
      await page.goto(ctx.searchUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.navTimeoutMs });
      ctx.logger(`Goto completed in ${Date.now() - startGoto}ms`);
      ctx.logger(`Post-nav URL: ${page.url()}`);
      ctx.logger(`Page title: ${await page.title().catch(() => "unknown")}`);

      await humanize(page);

      // Wait explicitly for cards instead of networkidle (which times out).

      // Explicit wait for at least one card — up to cardWaitTimeoutMs.
      ctx.logger(`Waiting for selector: ${CARD_SELECTORS}`);
      const startWait = Date.now();
      await page.waitForSelector(CARD_SELECTORS, { timeout: CONFIG.cardWaitTimeoutMs }).catch(async (e: any) => {
         ctx.logger(`Selector timeout after ${Date.now() - startWait}ms`);
         const { dumpFailureArtifacts } = await import("../utils/failure-dump");
         await dumpFailureArtifacts(ctx.runId, ctx.portal, page, e.message);
      });

      const maxCards = CONFIG.getMaxCardsPerPage("Indeed");
      const cards = await page.locator(CARD_SELECTORS).all();
      const sliced = cards.slice(0, maxCards);
      for (const card of sliced) {
        try {
          const title = ((await card.locator("h2.jobTitle, .jobTitle, [class*='jobTitle']").first().textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
          const company = ((await card.locator('[data-testid="company-name"], .companyName, [class*="companyName"]').first().textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
          const location = ((await card.locator('[data-testid="text-location"], .companyLocation, [class*="companyLocation"]').first().textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
          const salary = ((await card.locator('[data-testid="attribute_snippet_testid"], .salary-snippet, [class*="salary"]').first().textContent({ timeout: 1000 }).catch(() => "")) || "").trim();

          const urlEl = card.locator("h2.jobTitle a, a[data-jk], a[href*='/rc/clk'], a[href*='/jobs/view'], a[href*='viewjob']").first();
          const rawHref = ((await urlEl.getAttribute("href", { timeout: 1000 }).catch(() => "")) || "").trim();

          // Extract canonical Indeed Job Key (jk) to stay on in.indeed.com and avoid off-site redirects
          let jk = ((await card.getAttribute("data-jk").catch(() => "")) || "").trim();
          if (!jk) {
            jk = ((await urlEl.getAttribute("data-jk", { timeout: 500 }).catch(() => "")) || "").trim();
          }
          if (!jk && rawHref) {
            const match = rawHref.match(/[?&]jk=([a-f0-9]+)/i);
            if (match) jk = match[1];
          }

          let detailUrl = "";
          if (jk) {
            detailUrl = `https://in.indeed.com/viewjob?jk=${jk}`;
          } else if (rawHref) {
            try {
              const parsed = new URL(rawHref, "https://in.indeed.com");
              parsed.hash = "";
              detailUrl = parsed.toString();
            } catch {
              detailUrl = rawHref.startsWith("http") ? rawHref : `https://in.indeed.com${rawHref}`;
            }
          }

          if (!detailUrl || !title) continue;
          
          const rawPosted = ((await card.locator('[data-testid="myJobsStateDate"], span.date, .date').first().textContent({ timeout: 1000 }).catch(() => "")) || "").trim();

          const filterRes = passesHardFilter({ title, company, location });
          if (!filterRes.pass) {
            ctx.logger(`[HardFilter] Skipped "${title}" at ${company}: ${filterRes.reason}`);
            continue;
          }

          const cardHash = cardHashFor("Indeed", detailUrl);
          const rawHtml = await card.innerHTML().catch(() => "");
          const rawText = ((await card.textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
          const discoveredAt = new Date().toISOString();
          const { date: postedAt, precision: postedPrecision } = normalizePostingDate(rawPosted, discoveredAt);
          
          cardsOut.push({
            cardHash,
            portal: "Indeed",
            keyword: ctx.keyword,
            searchUrl: ctx.searchUrl,
            detailUrl,
            discoveredAt,
            title,
            company,
            location,
            salary,
            postedAt,
            postedPrecision,
            rawHtml,
            rawText,
          });
        } catch (err: any) {
          ctx.logger(`Indeed card parse skipped: ${err.message}`);
        }
      }
    } catch (err: any) {
      ctx.logger(`Indeed listCards failed: ${err.message}`);
    }
    return cardsOut;
  },
  
  fetchDetail,
};

import { fastFetchDetail } from "../utils/http-fetch";

async function fetchDetail(ctx: PortalContext, url: string): Promise<DetailedCard["detail"]> {
  const handler = indeedHandler;
  
  if (handler.detailStrategy === "auto" || handler.detailStrategy === "http") {
    const skipHttp = ctx.isHttpDisabled?.(url) ?? false;
    if (!skipHttp) {
      ctx.recordTelemetry?.("httpAttempted");
      const httpRes = await fastFetchDetail(
        url, 
        "h1.jobsearch-JobInfoHeader-title, .jobsearch-JobInfoHeader-title-container, h1", 
        "#jobDescriptionText, .jobsearch-jobDescriptionText, [class*='description'], [class*='job-detail'], main, article"
      );
      if (httpRes.fetched) {
        ctx.recordTelemetry?.("httpSuccessful");
        ctx.logger(`[FastPath] Extracted detail from ${url}`);
        return httpRes;
      }
      
      const reason = httpRes.fetchError?.includes("403") ? "403" : 
                    httpRes.fetchError?.includes("timeout") ? "Timeout" : "Unknown";
      ctx.recordHttpFailure?.(url, reason);
      ctx.recordTelemetry?.("httpFallbacks");
      ctx.logger(`[FastPath] Failed for ${url}: ${httpRes.fetchError} [${reason}] — falling back to Playwright`);
    } else {
      ctx.logger(`[FastPath] Bypassed for ${url} due to circuit breaker or cache`);
    }
  }

  const t0 = Date.now();
  const page = ctx.detailPage || ctx.searchPage || ctx.activePage;
  const mutex = ctx.detailMutex || ctx.searchMutex;

  const doExtract = async () => {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: CONFIG.detailTimeoutMs });
      await jitter(300, 800);
      const container = page.locator("#jobDescriptionText, .jobsearch-jobDescriptionText, [class*='description'], [class*='job-detail'], main, article").first();
      const rawHtml = await container.innerHTML().catch(() => "");
      const rawText = ((await container.textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
      return { fetched: true, rawHtml, rawText, fetchDurationMs: Date.now() - t0 };
    } catch (err: any) {
      return { fetched: false, fetchError: err.message, fetchDurationMs: Date.now() - t0 };
    }
  };

  if (ctx.pageManager) {
    return ctx.pageManager.executeTransaction("detail", () => doExtract());
  }
  return mutex ? mutex.runExclusive(() => doExtract()) : doExtract();
}
