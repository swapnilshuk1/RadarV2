import type { FeedCard, DetailedCard, PortalContext, PortalHandler } from "../types";
import { SNAPSHOT_SCHEMA_VERSION, SCRAPER_VERSION } from "../versions";
import { CONFIG } from "../config";
import { cardHashFor } from "../utils/hash";
import { humanize, jitter, sleep } from "../utils/jitter";
import { passesHardFilter } from "../utils/hard-filter";
import { hydrateVirtualizedList } from "../utils/scroll";

const LINKEDIN_GEO_INDIA = "102713980";

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
  buildSearchUrl(kw, page) {
    const start = (page - 1) * 25;
    return `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(kw)}&location=India&geoId=${LINKEDIN_GEO_INDIA}&start=${start}`;
  },
  async ensureSession(ctx) {
    try {
      const state = await checkLinkedInSessionState(ctx);
      ctx.logger(`[LinkedIn Session State] ${state}`);
      if (state === "AUTHENTICATED") {
        return "ready";
      }
      if (state === "AUTH_MISSING" || state === "AUTH_EXPIRED" || state === "AUTH_INVALID") {
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

      const targetMaxCards = CONFIG.getMaxCardsPerPage("LinkedIn");
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

      // Perform hyper-patient stabilized virtualized scrolling
      const hydration = await hydrateVirtualizedList(
        page,
        {
          cardSelector,
          containerSelectors,
          targetCards: targetMaxCards,
          maxPasses: 25,
          consecutiveStableLimit: 5,
          minPassDelayMs: 1500,
          maxPassDelayMs: 3000,
        },
        ctx.logger
      );

      ctx.logger(`[LinkedIn Hydration Summary] Discovered ${hydration.finalCount} total cards (initial: ${hydration.initialCount}, passes: ${hydration.passesCompleted}, stabilized: ${hydration.stabilized})`);

      const cards = await page.locator(cardSelector).all();
      const sliced = cards.slice(0, targetMaxCards);
      for (const card of sliced) {
        try {
          const titleEl = card.locator('a.job-card-list__title, a.job-card-container__link').first();
          const title = ((await titleEl.textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
          const company = ((await card.locator(".job-card-container__primary-description, .artdeco-entity-lockup__subtitle").first().textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
          const location = ((await card.locator(".job-card-container__metadata-item, .artdeco-entity-lockup__caption").first().textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
          const href = ((await titleEl.getAttribute("href", { timeout: 1000 }).catch(() => "")) || "").trim();
          if (!href || !title) continue;

          const filterRes = passesHardFilter({ title, company, location });
          if (!filterRes.pass) {
            ctx.logger(`[HardFilter] Skipped "${title}" at ${company}: ${filterRes.reason}`);
            continue;
          }

          const detailUrl = href.startsWith("http") ? href : `https://www.linkedin.com${href}`;
          const cardHash = cardHashFor("LinkedIn", detailUrl);
          const rawHtml = await card.innerHTML().catch(() => "");
          const rawText = ((await card.textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();

          cardsOut.push({
            cardHash,
            portal: "LinkedIn",
            keyword: ctx.keyword,
            searchUrl: ctx.searchUrl,
            detailUrl,
            discoveredAt: new Date().toISOString(),
            title,
            company,
            location,
            rawHtml,
            rawText,
          });
        } catch (err: any) {
          ctx.logger(`LinkedIn card parse skipped: ${err.message}`);
        }
      }
    } catch (err: any) {
      ctx.logger(`LinkedIn listCards failed: ${err.message}`);
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
      return httpRes;
    }
    ctx.logger(`[FastPath] Failed for ${url}: ${httpRes.fetchError} — falling back to Playwright`);
  }

  const t0 = Date.now();
  const page = await ctx.browserContext.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: CONFIG.detailTimeoutMs });
    await jitter(600, 1400);
    await page.locator('button[aria-label*="see more" i], .show-more-less-html__button').first().click({ timeout: 1500 }).catch(() => {});
    const container = page.locator(".jobs-description__content, .description__text, .show-more-less-html__markup").first();
    const rawHtml = await container.innerHTML().catch(() => "");
    const rawText = ((await container.textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    return { fetched: true, rawHtml, rawText, fetchDurationMs: Date.now() - t0 };
  } catch (err: any) {
    return { fetched: false, fetchError: err.message, fetchDurationMs: Date.now() - t0 };
  } finally {
    await page.close().catch(() => {});
  }
}


