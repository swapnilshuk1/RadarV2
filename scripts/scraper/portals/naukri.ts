import type { FeedCard, DetailedCard, PortalContext, PortalHandler } from "../types";
import { SNAPSHOT_SCHEMA_VERSION, SCRAPER_VERSION } from "../versions";
import { CONFIG } from "../config";
import { cardHashFor } from "../utils/hash";
import { humanize, jitter, sleep } from "../utils/jitter";
import { passesHardFilter } from "../utils/hard-filter";

export const naukriHandler: PortalHandler = {
  name: "Naukri",
  detailStrategy: (process.env.NAUKRI_DETAIL_STRATEGY as "auto" | "http" | "browser") || "browser",
  buildSearchUrl(kw, page) {
    const slug = kw.toLowerCase().replace(/\s+/g, "-");
    return `https://www.naukri.com/${slug}-jobs-in-india-${page}?k=${encodeURIComponent(kw)}`;
  },
  async ensureSession(ctx) {
    const page = ctx.activePage;
    let keepOpen = false;
    try {
      await page.goto("https://www.naukri.com/", {
        waitUntil: "domcontentloaded",
        timeout: CONFIG.navTimeoutMs,
      }).catch((e: any) => ctx.logger(`Navigation timeout caught (non-fatal): ${e.message}`));
      
      await page.waitForLoadState("load", { timeout: 10000 }).catch(() => {});
      await sleep(2500);
      
      const title = await page.title().catch(() => "unknown");
      if (!title || title === "unknown" || title.includes("Just a moment") || title.includes("Access Denied")) {
        ctx.logger(`Naukri session probe failed: Blocked by bot-protection (Title: ${title})`);
        return "error";
      }
      
      return "ready";
    } catch (err: any) {
      ctx.logger(`Naukri session probe failed: ${err.message}`);
      return "error";
    }
  },
  async listCards(ctx) {
    const page = ctx.activePage;
    const cardsOut: FeedCard[] = [];

    // Naukri CSS module hashes change on every deploy — use attribute-substring
    // selectors so the scraper survives rebuilds without code changes.
    const CARD_SELECTORS = [
      "article.jobTuple",
      "[class*='jobTuple']",
      "[class*='job-tuple']",
      ".srp-jobtuple-wrapper",
      ".cust-job-tuple",
    ].join(", ");

    try {
      const startGoto = Date.now();
      await page.goto(ctx.searchUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.navTimeoutMs });
      ctx.logger(`Goto completed in ${Date.now() - startGoto}ms`);
      ctx.logger(`Post-nav URL: ${page.url()}`);
      
      const title = await page.title().catch(() => "unknown");
      ctx.logger(`Page title: ${title}`);
      if (!title || title === "unknown" || title.includes("Just a moment") || title.includes("Access Denied")) {
        throw new Error("Portal blocked by Cloudflare/Akamai or empty response");
      }

      await humanize(page);

      // Wait for at least one card to appear in the DOM.
      ctx.logger(`Waiting for selector: ${CARD_SELECTORS}`);
      const startWait = Date.now();
      await page.waitForSelector(CARD_SELECTORS, { timeout: CONFIG.cardWaitTimeoutMs }).catch(async (e: any) => {
         ctx.logger(`Selector timeout after ${Date.now() - startWait}ms`);
         const { dumpFailureArtifacts } = await import("../utils/failure-dump");
         await dumpFailureArtifacts(ctx.runId, ctx.portal, page, e.message);
      });

      const cards = await page.locator(CARD_SELECTORS).all();
      const sliced = cards.slice(0, CONFIG.maxCardsPerPage);
      for (const card of sliced) {
        try {
          const titleEl = card.locator("a.title, [class*='title'] a, a[class*='title']").first();
          const title = ((await titleEl.textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
          const company = ((await card.locator("a.comp-name, [class*='comp-name'], [class*='companyName']").first().textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
          const location = ((await card.locator(".locWdth, span.loc, [class*='loc'], [class*='location']").first().textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
          const salary = ((await card.locator(".sal-wrap, span.sal, [class*='salary'], [class*='sal']").first().textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
          const href = ((await titleEl.getAttribute("href", { timeout: 1000 }).catch(() => "")) || "").trim();
          if (!href || !title) continue;

          const filterRes = passesHardFilter({ title, company, location });
          if (!filterRes.pass) {
            ctx.logger(`[HardFilter] Skipped "${title}" at ${company}: ${filterRes.reason}`);
            continue;
          }

          // Naukri hrefs are sometimes relative — always resolve absolutely
          // (docs/scraper-quick-wins §8).
          const detailUrl = href.startsWith("http") ? href : `https://www.naukri.com${href.startsWith("/") ? "" : "/"}${href}`;
          const cardHash = cardHashFor("Naukri", detailUrl);
          const rawHtml = await card.innerHTML().catch(() => "");
          const rawText = ((await card.textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
          
          cardsOut.push({
            cardHash,
            portal: "Naukri",
            keyword: ctx.keyword,
            searchUrl: ctx.searchUrl,
            detailUrl,
            discoveredAt: new Date().toISOString(),
            title,
            company,
            location,
            salary,
            rawHtml,
            rawText,
          });
        } catch (err: any) {
          ctx.logger(`Naukri card parse skipped: ${err.message}`);
        }
      }
    } catch (err: any) {
      ctx.logger(`Naukri listCards failed: ${err.message}`);
    }
    return cardsOut;
  },
  
  fetchDetail,
};

import { fastFetchDetail } from "../utils/http-fetch";

async function fetchDetail(ctx: PortalContext, url: string): Promise<DetailedCard["detail"]> {
  const handler = naukriHandler;
  const contentSelectors = "[class*='dang-inner-html'], .job-desc, #job-description, section.job-desc, [class*='job-desc-container'], [class*='jobDescription']";
  
  if (handler.detailStrategy === "auto" || handler.detailStrategy === "http") {
    const skipHttp = ctx.isHttpDisabled?.(url) ?? false;
    if (!skipHttp) {
      ctx.recordTelemetry?.("httpAttempted");
      const httpRes = await fastFetchDetail(
        url, 
        "h1, header, .styles_job-header__container__b1Qf_", 
        contentSelectors
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
  // Naukri opens detail in a new tab from the card click — but we already have
  // the absolute URL, so open it directly and close after read. This is the
  // fix for the "tab bloat" issue called out in the plan.
  const page = await ctx.browserContext.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: CONFIG.detailTimeoutMs });
    await jitter(700, 1500);

    // Avoid CSS-module hashed selectors (they change every deploy).
    // Use attribute-substring or semantic selectors instead.
    const container = page.locator(contentSelectors).first();

    const rawHtml = await container.innerHTML().catch(() => "");
    const rawText = ((await container.textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    return { fetched: true, rawHtml, rawText, fetchDurationMs: Date.now() - t0 };
  } catch (err: any) {
    return { fetched: false, fetchError: err.message, fetchDurationMs: Date.now() - t0 };
  } finally {
    await page.close().catch(() => {});
  }
}

