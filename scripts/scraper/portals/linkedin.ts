import type { FeedCard, DetailedCard, PortalContext, PortalHandler } from "../types";
import { SNAPSHOT_SCHEMA_VERSION, SCRAPER_VERSION } from "../versions";
import { CONFIG } from "../config";
import { cardHashFor } from "../utils/hash";
import { humanize, jitter, sleep } from "../utils/jitter";
import { passesHardFilter } from "../utils/hard-filter";
import { hydrateVirtualizedList } from "../utils/scroll";
import { normalizePostingDate } from "../utils/date";
import * as cheerio from "cheerio";

const LINKEDIN_GEO_INDIA = "102713980";

/**
 * LinkedIn's search endpoint gives `geoId` precedence over the display
 * `location`. Never pair a city label with the India-wide geo ID: that makes
 * the emitted URL look city-scoped while actually searching the country.
 *
 * These NCR identifiers were resolved against LinkedIn's own public search
 * response using fully-qualified Indian place names on 04 Sep 2026. Keep the
 * mapping deliberately small and explicit; an unknown explicit location is
 * left to LinkedIn's native location resolver rather than silently widened.
 */
export const LINKEDIN_GEO_BY_LOCATION: Readonly<Record<string, string>> = {
  "gurugram": "106442238",
  "gurgaon": "106442238",
  "delhi": "106187582",
  "noida": "104869687",
  "faridabad": "100839447",
  "ghaziabad": "100497616",
};

function normalizeLinkedInLocation(location: string): string {
  return location.trim().toLowerCase().replace(/,.*$/, "");
}

/** Returns a verified portal identifier when one is known for this location. */
export function resolveLinkedInGeoId(location?: string): string | undefined {
  if (!location?.trim()) return LINKEDIN_GEO_INDIA;
  return LINKEDIN_GEO_BY_LOCATION[normalizeLinkedInLocation(location)];
}

export type LinkedInSessionState =
  | "AUTHENTICATED"
  | "AUTH_MISSING"
  | "AUTH_EXPIRED"
  | "AUTH_INVALID"
  | "RATE_LIMITED"
  | "BLOCKED"
  | "EMPTY_RESULT";

export async function checkLinkedInSessionState(ctx: PortalContext): Promise<LinkedInSessionState> {
  const cookies = await ctx.browserContext.cookies().catch(() => []);
  const liAtCookie = cookies.find((c: any) => c.name === "li_at" && c.value && c.value.trim().length > 10);

  if (!liAtCookie) {
    ctx.logger("[LinkedIn Session] li_at cookie missing -> AUTH_MISSING");
    return "AUTH_MISSING";
  }

  const page = ctx.activePage;
  const currentUrl = page ? page.url() : "";
  const title = page ? ((await page.title().catch(() => "")) || "") : "";

  if (title.includes("Access Denied") || title.includes("Just a moment") || title.includes("Security Verification")) {
    return "BLOCKED";
  }
  if (title.includes("Too Many Requests") || currentUrl.includes("/429")) {
    return "RATE_LIMITED";
  }
  if (/\/(login|authwall|checkpoint|signup)(\/|$|\?)/.test(currentUrl)) {
    return "AUTH_EXPIRED";
  }

  if (page && !/\/(feed|jobs|mynetwork|in\/|messaging)(\/|$|\?)/.test(currentUrl)) {
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: CONFIG.navTimeoutMs,
    }).catch(() => {});
    await sleep(1000);
    const postNavUrl = page.url();
    if (/\/(login|authwall|checkpoint|signup)(\/|$|\?)/.test(postNavUrl)) {
      return "AUTH_INVALID";
    }
  }

  return "AUTHENTICATED";
}

export const linkedinHandler: PortalHandler = {
  name: "LinkedIn",
  detailStrategy: "auto",
  buildSearchUrl(request, legacyPage = 1) {
    const input = typeof request === "string" ? { query: request, page: legacyPage } : { ...request };
    const kw = input.query;
    const page = input.page;
    const start = (page - 1) * 25;
    const location = input.location?.trim() || "India";
    const params = new URLSearchParams({
      keywords: kw,
      location,
      start: String(start),
    });
    const geoId = resolveLinkedInGeoId(input.location);
    if (geoId) params.set("geoId", geoId);
    if (input.postedWithinDays !== undefined) {
      params.set("f_TPR", `r${input.postedWithinDays * 24 * 60 * 60}`);
    }
    if (input.sort === "date") params.set("sortBy", "DD");
    return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
  },
  async ensureSession(ctx) {
    try {
      const state = await checkLinkedInSessionState(ctx);
      ctx.logger(`[LinkedIn Session State] ${state}`);
      if (state === "AUTHENTICATED") {
        if (ctx.authSession) {
          await ctx.authSession.reportHealth("active").catch(() => {});
        }
        return "ready";
      }
      if (state === "AUTH_EXPIRED" || state === "AUTH_INVALID") {
        if (ctx.authSession) {
          await ctx.authSession.reportHealth("invalid", `LinkedIn session verification returned ${state}`).catch(() => {});
        }
        return "gated";
      }
      if (state === "AUTH_MISSING") {
        return "gated";
      }
      return "error";
    } catch (err: any) {
      ctx.logger(`LinkedIn session probe failed: ${err.message}`);
      return "error";
    }
  },

  async listCards(ctx) {
    const page = ctx.activePage;
    const cardsOut: FeedCard[] = [];
    try {
      await page.goto(ctx.searchUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.navTimeoutMs });
      await humanize(page);
      await sleep(1500);

      const postNavUrl = page.url();
      const pageTitle = (await page.title().catch(() => "")) || "";

      if (/\/(login|authwall|checkpoint|signup)(\/|$|\?)/.test(postNavUrl)) {
        ctx.logger(`[LinkedIn listCards] Redirected to authwall: ${postNavUrl}`);
        if (ctx.authSession) {
          await ctx.authSession.reportHealth("invalid", "LinkedIn search redirected to authwall").catch(() => {});
        }
        throw new Error("AUTH_EXPIRED: LinkedIn session invalid or redirected to authwall");
      }

      if (pageTitle.includes("Access Denied") || pageTitle.includes("Just a moment") || pageTitle.includes("Attention Required")) {
        ctx.logger(`[LinkedIn listCards] Blocked by security challenge: ${pageTitle}`);
        throw new Error("BLOCKED: LinkedIn search page blocked by security challenge");
      }

      if (pageTitle.includes("Too Many Requests") || postNavUrl.includes("/429")) {
        ctx.logger(`[LinkedIn listCards] Rate limited (429)`);
        throw new Error("RATE_LIMITED: LinkedIn rate limit exceeded");
      }

      // Fast check for explicit zero-results indicators before entering scroll hydration
      const isZeroResults = await page.evaluate(() => {
        const text = document.body ? (document.body.innerText || "") : "";
        if (text.includes("No matching jobs found") || text.includes("No matching jobs") || text.includes("No exact matches found")) {
          return true;
        }
        return !!document.querySelector(".jobs-search-no-results-banner, .jobs-search-no-results, div.jobs-search-two-pane__no-results-banner");
      }).catch(() => false);

      if (isZeroResults) {
        ctx.logger(`[LinkedIn listCards] Explicit zero-results banner detected for "${ctx.keyword}". Skipping hydration.`);
        return [];
      }

      const targetMaxCards = ctx.maxCardsPerPage ?? CONFIG.getMaxCardsPerPage("LinkedIn");
      const cardSelector = [
        "div.job-card-container",
        "li.jobs-search-results__list-item",
        "ul.jobs-search__results-list li",
        "div.base-search-card",
        "[class*='jobs-search__results-list'] li",
      ].join(", ");
      const containerSelectors = [
        ".jobs-search-results-list",
        ".scaffold-layout__list-container",
        "div.jobs-search-results__list",
        "ul.jobs-search__results-list",
        ".jobs-search-results",
        "main",
      ];

      // Perform stabilized virtualized scrolling (calibrated: max 10 passes, 2 stable passes)
      const hydration = await hydrateVirtualizedList(
        page,
        {
          cardSelector,
          containerSelectors,
          targetCards: targetMaxCards,
          maxPasses: 10,
          consecutiveStableLimit: 2,
          minPassDelayMs: 600,
          maxPassDelayMs: 1200,
          isCancelled: ctx.isCancelled,
        },
        ctx.logger
      );

      ctx.logger(`[LinkedIn Hydration Summary] Discovered ${hydration.finalCount} total cards (initial: ${hydration.initialCount}, passes: ${hydration.passesCompleted}, stabilized: ${hydration.stabilized})`);

      const cards = await page.locator(cardSelector).all();
      const sliced = cards.slice(0, targetMaxCards);
      for (const card of sliced) {
        if (ctx.isCancelled?.() || page?.isClosed?.()) break;
        try {
          const titleEl = card.locator('a.job-card-list__title, a.job-card-container__link').first();
          const title = ((await titleEl.textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
          const company = ((await card.locator(".job-card-container__primary-description, .artdeco-entity-lockup__subtitle").first().textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
          const location = ((await card.locator(".job-card-container__metadata-item, .artdeco-entity-lockup__caption").first().textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
          const href = ((await titleEl.getAttribute("href", { timeout: 1000 }).catch(() => "")) || "").trim();
          
          const timeEl = card.locator('time').first();
          const rawDatetime = await timeEl.getAttribute("datetime", { timeout: 500 }).catch(() => null);
          const rawTimeText = await timeEl.textContent({ timeout: 500 }).catch(() => null);
          const rawPosted = rawDatetime || rawTimeText || null;
          
          if (!href || !title) continue;

          const filterRes = passesHardFilter({ title, company, location }, { allowMissingCompany: true });
          if (!filterRes.pass) {
            ctx.logger(`[HardFilter] Skipped "${title}" at ${company}: ${filterRes.reason}`);
            continue;
          }
          if (!company) {
            ctx.logger(`[LinkedIn Discovery] Preserving card "${title}" without card company; deferring company resolution to detail extraction`);
          }

          const detailUrl = href.startsWith("http") ? href : `https://www.linkedin.com${href}`;
          const cardHash = cardHashFor("LinkedIn", detailUrl);
          const rawHtml = await card.innerHTML().catch(() => "");
          const rawText = ((await card.textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();

          const discoveredAt = new Date().toISOString();
          const { date: postedAt, precision: postedPrecision } = normalizePostingDate(rawPosted, discoveredAt);

          cardsOut.push({
            cardHash,
            portal: "LinkedIn",
            keyword: ctx.keyword,
            searchUrl: ctx.searchUrl,
            detailUrl,
            discoveredAt,
            title,
            company,
            location,
            postedAt,
            postedPrecision,
            rawHtml,
            rawText,
          });
        } catch (err: any) {
          ctx.logger(`LinkedIn card parse skipped: ${err.message}`);
        }
      }
    } catch (err: any) {
      const isCancelledOrClosed = ctx.isCancelled?.() || page?.isClosed?.() ||
        err?.message?.includes("Target page, context or browser has been closed") ||
        err?.message?.includes("browser has been closed");
      if (isCancelledOrClosed) {
        ctx.logger(`LinkedIn listCards cancelled cleanly during run shutdown.`);
        return [];
      }
      ctx.logger(`LinkedIn listCards failed: ${err.message}`);
      throw err;
    }
    return cardsOut;
  },
  
  fetchDetail,
};

import { fastFetchDetail } from "../utils/http-fetch";

async function fetchDetail(ctx: PortalContext, url: string): Promise<DetailedCard["detail"]> {
  const handler = linkedinHandler;
  
  if (handler.detailStrategy === "auto" || handler.detailStrategy === "http") {
    ctx.recordTelemetry?.("httpAttempted");
    const httpRes = await fastFetchDetail(
      url, 
      "h1.top-card-layout__title, h1.topcard__title, .jobs-description__content", 
      ".jobs-description__content, .description__text, .show-more-less-html__markup"
    );
    if (httpRes.fetched) {
      ctx.recordTelemetry?.("httpSuccessful");
      ctx.logger(`[FastPath] Extracted detail from ${url}`);
      
      return {
        ...httpRes,
        extractedTitle: httpRes.extractedTitle,
        extractedCompany: httpRes.extractedCompany,
      };
    }
    ctx.logger(`[FastPath] Failed for ${url}: ${httpRes.fetchError} — falling back to Playwright`);
  }

  const t0 = Date.now();
  const page = await ctx.browserContext.newPage();
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: CONFIG.detailTimeoutMs });
    const httpStatus = response?.status();
    const pageTitle = await page.title().catch(() => "");
    
    // Some 404s might return 200 with a "Not Available" title
    const isSoft404 = pageTitle.toLowerCase().includes("not available") || pageTitle.toLowerCase().includes("no longer available");
    const effectiveStatus = isSoft404 ? 404 : httpStatus;

    await jitter(600, 1400);
    await page.locator('button[aria-label*="see more" i], .show-more-less-html__button').first().click({ timeout: 1500 }).catch(() => {});
    const container = page.locator(".jobs-description__content, .description__text, .show-more-less-html__markup").first();
    const rawHtml = await container.innerHTML().catch(() => "");
    const rawText = ((await container.textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();

    // Extract company name from topcard container
    const companyLocator = page.locator(
      'a.topcard__org-name-link, a.top-card-layout__first-subline-link, .job-details-jobs-unified-top-card__company-name, .topcard__flavor:first-of-type, .topcard__org-name'
    ).first();
    const companyText = ((await companyLocator.textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    const extractedCompany = companyText.length > 0 ? companyText : undefined;
    const titleText = ((await page.locator("h1.top-card-layout__title, h1.topcard__title, .job-details-jobs-unified-top-card__job-title, h1").first().textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    const extractedTitle = titleText.length > 0 ? titleText : undefined;

    const trimmedText = rawText.trim();
    if (trimmedText.length === 0) {
      ctx.logger?.(`[LinkedIn] Empty job description for ${url}`);
      return {
        fetched: false,
        fetchError: "Empty job description",
        rawHtml: "",
        rawText: "",
        fetchDurationMs: Date.now() - t0,
        httpStatus: effectiveStatus,
        extractedTitle,
        extractedCompany,
      };
    }

    const isSparse = trimmedText.length < 200;
    if (isSparse) {
      ctx.logger?.(`[LinkedIn] Preserving sparse description (${trimmedText.length} chars, quality=SPARSE) for ${url}`);
    }

    return {
      fetched: true,
      rawHtml,
      rawText: trimmedText,
      fetchDurationMs: Date.now() - t0,
      httpStatus: effectiveStatus,
      quality: isSparse ? ("SPARSE" as const) : ("VALID" as const),
      extractedTitle,
      extractedCompany,
    };
  } catch (err: any) {
    return { fetched: false, fetchError: err.message, fetchDurationMs: Date.now() - t0 };
  } finally {
    await page.close().catch(() => {});
  }
}
