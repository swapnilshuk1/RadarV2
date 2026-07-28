import type { FeedCard, DetailedCard, PortalContext, PortalHandler } from "../types";
import { SNAPSHOT_SCHEMA_VERSION, SCRAPER_VERSION } from "../versions";
import { CONFIG } from "../config";
import { cardHashFor } from "../utils/hash";
import { humanize, jitter, sleep } from "../utils/jitter";
import { passesHardFilter } from "../utils/hard-filter";
import { hydrateVirtualizedList } from "../utils/scroll";

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
      
      const title = (await page.title().catch(() => "")) || "";
      const isExplicitBlock = title.includes("Just a moment") || title.includes("Access Denied") || title.includes("Attention Required");
      if (isExplicitBlock) {
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

    // Target primary job tuple cards without matching outer wrapper parents
    const CARD_SELECTORS = [
      "div.cust-job-tuple",
      "div[data-job-id]",
      "article.jobTuple",
      "div.srp-jobtuple-wrapper",
      "div[class*='jobTuple']",
      "div[class*='srp-jobtuple-wrapper']",
      "[class*='styles_jcard']",
    ].join(", ");

    try {
      const startGoto = Date.now();
      await page.goto(ctx.searchUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.navTimeoutMs });
      ctx.logger(`Goto completed in ${Date.now() - startGoto}ms`);
      ctx.logger(`Post-nav URL: ${page.url()}`);
      
      const title = (await page.title().catch(() => "")) || "";
      ctx.logger(`Page title: "${title}"`);
      const isExplicitBlock = title.includes("Just a moment") || title.includes("Access Denied") || title.includes("Attention Required");
      if (isExplicitBlock) {
        throw new Error(`Portal blocked by Cloudflare/Akamai challenge page (Title: ${title})`);
      }

      await humanize(page);
      await sleep(1000);

      // Wait for at least one card to appear in the DOM.
      ctx.logger(`Waiting for selector: ${CARD_SELECTORS}`);
      const startWait = Date.now();
      await page.waitForSelector(CARD_SELECTORS, { timeout: CONFIG.cardWaitTimeoutMs }).catch(async (e: any) => {
         ctx.logger(`Selector timeout after ${Date.now() - startWait}ms`);
         const { dumpFailureArtifacts } = await import("../utils/failure-dump");
         await dumpFailureArtifacts(ctx.runId, ctx.portal, page, e.message);
      });

      const maxCards = CONFIG.getMaxCardsPerPage("Naukri");

      // Scroll and hydrate full card list on Naukri SRP
      await hydrateVirtualizedList(
        page,
        {
          cardSelector: CARD_SELECTORS,
          containerSelectors: [
            "#listContainer",
            ".list",
            ".srp-jobtuple-wrapper",
            ".search-result-container",
            "main",
          ],
          targetCards: maxCards,
          maxPasses: 10,
          consecutiveStableLimit: 3,
          minPassDelayMs: 1000,
          maxPassDelayMs: 2000,
        },
        ctx.logger
      );

      const cards = await page.locator(CARD_SELECTORS).all();
      const seenHrefs = new Set<string>();

      for (const card of cards) {
        if (cardsOut.length >= maxCards) break;
        try {
          const titleEl = card.locator("a.title, [class*='title'] a, a[class*='title'], [class*='row1'] a").first();
          const title = ((await titleEl.textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
          const company = ((await card.locator("a.comp-name, [class*='comp-name'], [class*='companyName'], a[class*='company'], [class*='company']").first().textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
          const location = ((await card.locator(".locWdth, span.loc, [class*='loc'], [class*='location'], [class*='loc-wrap']").first().textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
          const salary = ((await card.locator(".sal-wrap, span.sal, [class*='salary'], [class*='sal'], [class*='exp']").first().textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
          const href = ((await titleEl.getAttribute("href", { timeout: 1000 }).catch(() => "")) || "").trim();
          if (!href || !title) continue;

          // Naukri hrefs are sometimes relative — resolve absolutely
          const detailUrl = href.startsWith("http") ? href : `https://www.naukri.com${href.startsWith("/") ? "" : "/"}${href}`;
          if (seenHrefs.has(detailUrl)) continue;
          seenHrefs.add(detailUrl);

          const filterRes = passesHardFilter({ title, company, location });
          if (!filterRes.pass) {
            ctx.logger(`[HardFilter] Skipped "${title}" at ${company}: ${filterRes.reason}`);
            continue;
          }

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
  const contentSelectors = "[class*='dang-inner-html'], section[class*='job-desc'], [class*='job-desc'], [class*='jobDescription'], div.styles_JDSummary, #job-description, main, article";
  
  if (handler.detailStrategy === "auto" || handler.detailStrategy === "http") {
    const skipHttp = ctx.isHttpDisabled?.(url) ?? false;
    if (!skipHttp) {
      ctx.recordTelemetry?.("httpAttempted");
      const httpRes = await fastFetchDetail(
        url, 
        "h1, header, .styles_job-header__container__b1Qf_", 
        contentSelectors
      );
      if (httpRes.fetched && httpRes.rawText && httpRes.rawText.length > 100) {
        ctx.recordTelemetry?.("httpSuccessful");
        ctx.logger(`[FastPath] Extracted detail from ${url}`);
        return httpRes;
      }
      
      const reason = httpRes.fetchError?.includes("403") ? "403" : 
                    httpRes.fetchError?.includes("timeout") ? "Timeout" : "EmptyBody";
      ctx.recordHttpFailure?.(url, reason);
      ctx.recordTelemetry?.("httpFallbacks");
      ctx.logger(`[FastPath] Insufficient detail (${httpRes.rawText?.length ?? 0} chars) for ${url} — falling back to Playwright`);
    } else {
      ctx.logger(`[FastPath] Bypassed for ${url} due to circuit breaker or cache`);
    }
  }

  const t0 = Date.now();
  const page = await ctx.browserContext.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 12000 }).catch(() => {});
    await jitter(500, 1200);

    await page.waitForSelector(contentSelectors, { timeout: 6000 }).catch(() => {});

    let rawHtml = "";
    let rawText = "";

    const candidateSelectors = [
      "[class*='dang-inner-html']",
      "section[class*='job-desc']",
      "[class*='job-desc']",
      "div[class*='JDSummary']",
      "[class*='jobDescription']",
      "#job-description",
      "main",
      "article",
      "body",
    ];

    for (const sel of candidateSelectors) {
      const loc = page.locator(sel).first();
      const txt = ((await loc.textContent({ timeout: 1000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
      if (txt.length > 100) {
        rawText = txt;
        rawHtml = (await loc.innerHTML().catch(() => "")) || "";
        break;
      }
    }

    if (!rawText) {
      rawText = ((await page.locator("body").textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
      rawHtml = await page.locator("body").innerHTML().catch(() => "");
    }

    return { fetched: true, rawHtml, rawText, fetchDurationMs: Date.now() - t0 };
  } catch (err: any) {
    return { fetched: false, fetchError: err.message, fetchDurationMs: Date.now() - t0 };
  } finally {
    await page.close().catch(() => {});
  }
}

