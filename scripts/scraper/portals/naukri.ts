import type { FeedCard, DetailedCard, PortalContext, PortalHandler } from "../types";
import { SNAPSHOT_SCHEMA_VERSION, SCRAPER_VERSION } from "../versions";
import { CONFIG } from "../config";
import { cardHashFor } from "../utils/hash";
import { humanize, jitter, sleep } from "../utils/jitter";
import { passesHardFilter } from "../utils/hard-filter";
import { hydrateVirtualizedList } from "../utils/scroll";
import { normalizePostingDate } from "../utils/date";

export const naukriHandler: PortalHandler = {
  name: "Naukri",
  detailStrategy: "auto",
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
      
      if (ctx.authSession) {
        await ctx.authSession.reportHealth("active").catch(() => {});
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
      const hydration = await hydrateVirtualizedList(
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
          minPassDelayMs: 1200,
          maxPassDelayMs: 2500,
          isCancelled: ctx.isCancelled,
        },
        ctx.logger
      );

      ctx.logger(`[Naukri Hydration Summary] Discovered ${hydration.finalCount} total cards (initial: ${hydration.initialCount}, passes: ${hydration.passesCompleted}, stabilized: ${hydration.stabilized})`);

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
          
          const rawPosted = ((await card.locator('.job-post-day, span.stat, span.date').first().textContent({ timeout: 1000 }).catch(() => "")) || "").trim();

          const filterRes = passesHardFilter({ title, company, location });
          if (!filterRes.pass) {
            ctx.logger(`[HardFilter] Skipped "${title}" at ${company}: ${filterRes.reason}`);
            continue;
          }

          const cardHash = cardHashFor("Naukri", detailUrl);
          const rawHtml = await card.innerHTML().catch(() => "");
          const rawText = ((await card.textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
          
          const discoveredAt = new Date().toISOString();
          const { date: postedAt, precision: postedPrecision } = normalizePostingDate(rawPosted, discoveredAt);

          cardsOut.push({
            cardHash,
            portal: "Naukri",
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
        "h1, header, .styles_job-header__container__b1Qf_, [class*='jd-header'], body", 
        contentSelectors,
        { "appid": "109", "systemid": "NWEB", "Referer": "https://www.naukri.com/" }
      );
      if (httpRes.fetched && httpRes.rawText && httpRes.rawText.length > 100) {
        ctx.recordTelemetry?.("httpSuccessful");
        ctx.logger(`[FastPath] Extracted detail from ${url}`);
        return {
          ...httpRes,
          method: "HTTP_FASTPATH",
        } as any;
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
  const page = ctx.detailPage || ctx.searchPage || ctx.activePage;
  const mutex = ctx.detailMutex || ctx.searchMutex;

  const browserContentSelectors = "[class*='job-desc'], [class*='dang-inner-html'], [class*='JDSummary'], [class*='key-skill'], [class*='styles_job-desc-container'], main";

  const doExtract = async () => {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
      
      // Handle Naukri opening jobs in new tabs when logged in
      let targetPage = page;
      const allPages = page.context().pages();
      if (allPages.length > 1) {
          targetPage = allPages[allPages.length - 1];
          await targetPage.bringToFront();
      }

      await jitter(400, 900);
      await targetPage.waitForSelector(browserContentSelectors, { timeout: 6000 }).catch(() => {});

      const parts: { name: string; text: string; html: string }[] = [];

      // 1. Check Primary Job Description Containers
      let jdHtml = null;
      let fullJdText = "";
      const cheerio = require("cheerio");

      // METHOD 1: Clean Next.js State Extraction
      ctx.logger(`[${ctx.portal}] Attempting extraction via __NEXT_DATA__ JSON payload`);
      const nextDataText = await targetPage.evaluate(() => {
          const el = document.querySelector('#__NEXT_DATA__');
          return el ? el.innerHTML : null;
      });

      if (nextDataText) {
           try {
              const nextData = JSON.parse(nextDataText);
              if (nextData?.props?.pageProps?.jobDetails?.jobDescription) {
                  jdHtml = nextData.props.pageProps.jobDetails.jobDescription;
                  ctx.logger(`[${ctx.portal}] Successfully extracted full JD from Next.js state`);
              }
           } catch(e) {
               ctx.logger(`[${ctx.portal}] Failed to parse __NEXT_DATA__ JSON`);
           }
      }

      // METHOD 2: Broad DOM Selector Fallback
      if (!jdHtml) {
          ctx.logger(`[${ctx.portal}] Falling back to DOM selector extraction`);
          const htmlContent = await targetPage.content();
          const cheerioApi = cheerio.load(htmlContent);
          
          const primaryContainers = [
              "[class*='styles_job-desc-container']",
              "section[class*='job-desc']",
              "div.styles_JDSummary",
              "[class*='jobDescription']",
              "#job-description",
              ".dang-inner-html",
              "[class*='dang-inner-html']",
              ".job-description",          
              "div[class*='job-description']",
              ".styles_JDContainer__",
              "[class*='JDContainer']"
          ];
          
          for (const sel of primaryContainers) {
              const elements = cheerioApi(sel);
              if (elements.length > 0) {
                  const txt = elements.first().text().trim();
                  if (txt.length >= 150) {
                      jdHtml = elements.first().html();
                      ctx.logger(`[${ctx.portal}] Found JD via selector fallback: ${sel}`);
                      break;
                  }
              }
          }
      }

      // METHOD 3: Desperate Text Search Fallback
      if (!jdHtml) {
           ctx.logger(`[${ctx.portal}] Falling back to deep innerText search`);
           const contentNode = await targetPage.evaluate(() => {
               const nodes = Array.from(document.querySelectorAll('*'));
               for (let i = 0; i < nodes.length; i++) {
                   const textContent = nodes[i].textContent;
                   if (textContent && textContent.trim().toLowerCase() === 'job description') {
                       let parent = nodes[i].parentElement;
                       if (parent && parent.innerText.length > 200) {
                           return parent.innerHTML;
                       }
                   }
               }
               return null;
           });
           if (contentNode) {
               jdHtml = contentNode;
               ctx.logger(`[${ctx.portal}] Found JD via deep innerText search`);
           }
      }

      if (jdHtml) {
          const jdDom = cheerio.load(jdHtml);
          jdDom('br, p, div, li, h1, h2, h3, h4, h5, h6').append('\n');
          
          let rawText = jdDom.text();
          fullJdText = rawText.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
          ctx.logger(`[${ctx.portal}] Extracted JD text length: ${fullJdText.length}`);
          parts.push({ name: "description", text: fullJdText, html: jdHtml });
      }

      // 2. Check Highlights / Dang Inner HTML if primary was missing or short
      if (parts.length === 0 || parts[0].text.length < 300) {
        const highlightLoc = targetPage.locator("[class*='dang-inner-html']").first();
        const highlightTxt = ((await highlightLoc.textContent({ timeout: 1000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
        if (highlightTxt.length > 50 && (!parts[0] || !parts[0].text.includes(highlightTxt.slice(0, 50)))) {
          const highlightHtml = (await highlightLoc.innerHTML().catch(() => "")) || "";
          parts.push({ name: "highlights", text: highlightTxt, html: highlightHtml });
        }
      }

      // 3. Check Key Skills Section
      const skillsLoc = targetPage.locator("[class*='styles_key-skill'], [class*='key-skill']").first();
      const skillsTxt = ((await skillsLoc.textContent({ timeout: 1000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
      if (skillsTxt.length > 30 && (!parts[0] || !parts[0].text.includes(skillsTxt.slice(0, 30)))) {
        const skillsHtml = (await skillsLoc.innerHTML().catch(() => "")) || "";
        parts.push({ name: "skills", text: `Key Skills: ${skillsTxt}`, html: skillsHtml });
      }

      let rawText = "";
      let rawHtml = "";

      if (parts.length > 0) {
        rawText = parts.map((p) => p.text).join("\n\n");
        rawHtml = parts.map((p) => p.html).join("<hr/>");
      } else {
        // Fallback to main or body
        const mainLoc = targetPage.locator("main, article, [role='main']").first();
        const mainTxt = ((await mainLoc.textContent({ timeout: 1000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
        if (mainTxt.length >= 100) {
          rawText = mainTxt;
          rawHtml = (await mainLoc.innerHTML().catch(() => "")) || "";
        } else {
          rawText = ((await targetPage.locator("body").textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
          rawHtml = (await targetPage.locator("body").innerHTML().catch(() => "")) || "";
        }
      }

      return { fetched: rawText.length > 0, rawHtml, rawText, fetchDurationMs: Date.now() - t0 };
    } catch (err: any) {
      return { fetched: false, fetchError: err.message, fetchDurationMs: Date.now() - t0 };
    }
  };

  if (ctx.pageManager) {
    return ctx.pageManager.executeTransaction("detail", () => doExtract());
  }
  return mutex ? mutex.runExclusive(() => doExtract()) : doExtract();
}

