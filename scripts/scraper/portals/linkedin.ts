import type { FeedCard, DetailedCard, PortalContext, PortalHandler } from "../types";
import { SNAPSHOT_SCHEMA_VERSION, SCRAPER_VERSION } from "../versions";
import { CONFIG } from "../config";
import { cardHashFor } from "../utils/hash";
import { humanize, jitter, sleep } from "../utils/jitter";
import { passesHardFilter } from "../utils/hard-filter";
import { hydrateVirtualizedList } from "../utils/scroll";

const LINKEDIN_GEO_INDIA = "102713980";

export const linkedinHandler: PortalHandler = {
  name: "LinkedIn",
  detailStrategy: "auto",
  buildSearchUrl(kw, page) {
    const start = (page - 1) * 25;
    return `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(kw)}&location=India&geoId=${LINKEDIN_GEO_INDIA}&start=${start}`;
  },
  async ensureSession(ctx) {
    const page = ctx.activePage;
    let keepOpen = false;
    try {
      // We catch the timeout so we can still evaluate the URL and DOM state.
      // Often the page loads enough for us to know if we are logged in, even if 
      // some ad-tracking script hangs the 'load' event.
      await page.goto("https://www.linkedin.com/feed/", {
        waitUntil: "domcontentloaded",
        timeout: CONFIG.navTimeoutMs,
      }).catch((e: any) => ctx.logger(`Navigation timeout caught (non-fatal): ${e.message}`));

      // Wait for the page to fully settle (React hydration, redirects).
      await page.waitForLoadState("load", { timeout: 10000 }).catch(() => {});

      const checkLoggedIn = async (): Promise<boolean> => {
        const url = page.url();

        // URL-based check — far more reliable than DOM selectors across
        // LinkedIn UI redesigns. Feed/jobs/network URLs = authenticated.
        if (/\/(feed|jobs|mynetwork|in\/|messaging)(\/|$|\?)/.test(url)) {
          return true;
        }
        // Redirect to login/authwall/checkpoint = definitely logged out.
        if (/\/(login|authwall|checkpoint|signup)(\/|$|\?)/.test(url)) {
          return false;
        }

        // URL is ambiguous (e.g. stayed on linkedin.com root) — fall back to
        // DOM selectors. Broadened to survive LinkedIn's frequent nav redesigns.
        const count = await page
          .locator(
            [
              "#global-nav",
              "nav[aria-label]",
              "header[role='banner']",
              ".global-nav",
              ".search-global-typeahead__input",
              "input[placeholder*='Search' i]",
              ".authentication-outlet",
            ].join(", ")
          )
          .first()
          .count()
          .catch(() => 0);
        return count > 0;
      };

      // Fast path — already logged in.
      if (await checkLoggedIn()) return "ready";

      // Slow path — not logged in. We no longer block here.
      // We return 'gated' immediately so Phase 1 can finish and enter 'waiting_for_confirmation'.
      // The user can log in during the pause.
      ctx.logger("LinkedIn not logged in — returning 'gated'.");
      keepOpen = true;
      return "gated";
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

      // Perform stabilized virtualized scrolling
      const hydration = await hydrateVirtualizedList(
        page,
        {
          cardSelector,
          containerSelectors,
          targetCards: targetMaxCards,
          maxPasses: 15,
          consecutiveStableLimit: 3,
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


