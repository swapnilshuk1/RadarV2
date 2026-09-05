import type { FeedCard, DetailedCard, PortalContext, PortalHandler } from "../types";
import { SNAPSHOT_SCHEMA_VERSION, SCRAPER_VERSION } from "../versions";
import { CONFIG } from "../config";
import { cardHashFor } from "../utils/hash";
import { humanize, jitter, sleep } from "../utils/jitter";
import { passesHardFilter } from "../utils/hard-filter";
import { normalizePostingDate } from "../utils/date";

const MAX_LISTING_REDIRECT_HOPS = 5;

export const indeedHandler: PortalHandler = {
  name: "Indeed",
  detailStrategy: "browser",
  buildSearchUrl(request, legacyPage = 1) {
    const input = typeof request === "string" ? { query: request, page: legacyPage } : { ...request };
    const kw = input.query;
    const page = input.page;
    const start = (page - 1) * 10;
    const params = new URLSearchParams({
      q: kw,
      l: input.location || "India",
      start: String(start),
    });
    if (input.radiusKm !== undefined) params.set("radius", String(input.radiusKm));
    if (input.postedWithinDays !== undefined) params.set("fromage", String(input.postedWithinDays));
    if (input.sort === "date") params.set("sort", "date");
    return `https://in.indeed.com/jobs?${params.toString()}`;
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
    const seenJks = new Set<string>();
    const seenHashes = new Set<string>();

    const PRIMARY_CARD_SELECTOR = "div.cardOutline, div.job_seen_beacon, [data-jk]";
    const FALLBACK_CARD_SELECTORS = ".resultContent, .slider_container";

    try {
      const startGoto = Date.now();
      await page.goto(ctx.searchUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.navTimeoutMs });
      ctx.logger(`Goto completed in ${Date.now() - startGoto}ms`);
      ctx.logger(`Post-nav URL: ${page.url()}`);
      ctx.logger(`Page title: ${await page.title().catch(() => "unknown")}`);

      await humanize(page);

      // Explicit wait for at least one card container
      ctx.logger(`Waiting for selector: ${PRIMARY_CARD_SELECTOR}`);
      const startWait = Date.now();
      let usedSelector = PRIMARY_CARD_SELECTOR;
      let matched = await page.waitForSelector(PRIMARY_CARD_SELECTOR, { timeout: 4000 }).catch(() => null);
      if (!matched) {
        ctx.logger(`Primary selector timeout after ${Date.now() - startWait}ms, trying fallback selectors: ${FALLBACK_CARD_SELECTORS}`);
        matched = await page.waitForSelector(FALLBACK_CARD_SELECTORS, { timeout: CONFIG.cardWaitTimeoutMs }).catch(async (e: any) => {
          ctx.logger(`Fallback selector timeout after ${Date.now() - startWait}ms`);
          const { dumpFailureArtifacts } = await import("../utils/failure-dump");
          await dumpFailureArtifacts(ctx.runId, ctx.portal, page, e.message);
          return null;
        });
        if (matched) usedSelector = FALLBACK_CARD_SELECTORS;
      }

      const maxCards = ctx.maxCardsPerPage ?? CONFIG.getMaxCardsPerPage("Indeed");
      const cardElements = await page.locator(usedSelector).all();
      
      for (const card of cardElements) {
        if (cardsOut.length >= maxCards) break;
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

          if (jk && seenJks.has(jk)) continue;
          if (jk) seenJks.add(jk);

          let detailUrl = "";
          let applyRedirectUrl: string | undefined = undefined;

          if (jk) {
            detailUrl = `https://in.indeed.com/viewjob?jk=${jk}`;
            applyRedirectUrl = `https://in.indeed.com/rc/clk?jk=${jk}`;
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
          if (seenHashes.has(cardHash)) continue;
          seenHashes.add(cardHash);

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
            applyRedirectUrl,
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
      const isCancelledOrClosed = ctx.isCancelled?.() || page?.isClosed?.() ||
        err?.message?.includes("Target page, context or browser has been closed") ||
        err?.message?.includes("browser has been closed");
      if (isCancelledOrClosed) {
        ctx.logger(`Indeed listCards cancelled cleanly during run shutdown.`);
        return [];
      }
      ctx.logger(`Indeed listCards failed: ${err.message}`);
      throw err;
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
        "#jobDescriptionText, .jobsearch-jobDescriptionText, [class*='description'], [class*='job-detail'], [data-automation-id='jobPostingDescription'], main, article"
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
      const navigation = await page.goto(url, { waitUntil: "domcontentloaded", timeout: CONFIG.detailTimeoutMs });
      let redirectHops = 0;
      let request = navigation?.request();
      while (request?.redirectedFrom()) {
        redirectHops += 1;
        request = request.redirectedFrom();
      }
      if (redirectHops > MAX_LISTING_REDIRECT_HOPS) {
        return {
          fetched: false,
          fetchError: `Indeed redirect chain exceeded ${MAX_LISTING_REDIRECT_HOPS} hops`,
          fetchDurationMs: Date.now() - t0,
          finalUrl: page.url(),
        };
      }
      await jitter(400, 900);

      // Check current page URL (might have followed an external ATS redirect from /rc/clk)
      const currentUrl = page.url();

      const candidateSelectors = [
        "#jobDescriptionText",
        ".jobsearch-jobDescriptionText",
        "[data-testid='jobsearch-JobComponent-description']",
        "[data-automation-id='jobPostingDescription']", // Workday
        "#content", // Greenhouse
        ".posting-requirements", // Lever
        ".job-description",
        "#job-description",
        ".job__description",
        ".job-details",
        ".description__text",
        "[class*='JobDescription']",
        "main",
        "article",
        "[role='main']",
      ];

      let rawHtml = "";
      let rawText = "";

      for (const sel of candidateSelectors) {
        const container = page.locator(sel).first();
        const txt = ((await container.textContent({ timeout: 1000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
        if (txt.length >= 200) {
          rawText = txt;
          rawHtml = (await container.innerHTML().catch(() => "")) || "";
          break;
        }
      }

      // Fallback: If no single container >= 200 chars, try the first non-empty container or body
      if (!rawText) {
        const container = page.locator("#jobDescriptionText, .jobsearch-jobDescriptionText, [class*='description'], [class*='job-detail'], main, article").first();
        rawHtml = (await container.innerHTML().catch(() => "")) || "";
        rawText = ((await container.textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
      }

      const trimmedText = rawText.trim();
      const titleText = ((await page.locator("h1.jobsearch-JobInfoHeader-title, .jobsearch-JobInfoHeader-title-container h1, h1").first().textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
      const extractedTitle = titleText.length > 0 ? titleText : undefined;
      if (trimmedText.length === 0) {
        ctx.logger?.(`[Indeed] Empty job description for ${url}`);
        return {
          fetched: false,
          fetchError: `Empty job description`,
          rawHtml: "",
          rawText: "",
          fetchDurationMs: Date.now() - t0,
          extractedTitle,
        };
      }

      if (trimmedText.length < 200) {
        ctx.logger?.(`[Indeed] Preserving sparse description (${trimmedText.length} chars, quality=SPARSE) for ${url}`);
      }

      return {
        fetched: true,
        rawHtml,
        rawText: trimmedText,
        fetchDurationMs: Date.now() - t0,
        finalUrl: currentUrl,
        quality: trimmedText.length < 200 ? ("SPARSE" as const) : ("VALID" as const),
        extractedTitle,
      };
    } catch (err: any) {
      return { fetched: false, fetchError: err.message, fetchDurationMs: Date.now() - t0 };
    }
  };

  if (ctx.pageManager) {
    return ctx.pageManager.executeTransaction("detail", () => doExtract());
  }
  return mutex ? mutex.runExclusive(() => doExtract()) : doExtract();
}
