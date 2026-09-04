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
  buildSearchUrl(request, legacyPage = 1) {
    const input = typeof request === "string" ? { query: request, page: legacyPage } : { ...request };
    const kw = input.query;
    const page = input.page;
    const slug = kw.toLowerCase().replace(/\s+/g, "-");
    const pageSuffix = page > 1 ? `-${page}` : "";
    const params = new URLSearchParams({ k: kw, pageNo: String(page) });
    if (input.location) params.set("l", input.location);
    if (input.postedWithinDays !== undefined) params.set("jobAge", String(input.postedWithinDays));
    if (input.sort === "date") params.set("sort", "r");
    if (input.industry) params.set("industry", input.industry);
    if (input.department) params.set("functionalArea", input.department);
    return `https://www.naukri.com/${slug}-jobs-in-india${pageSuffix}?${params.toString()}`;
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
    const maxCards = ctx.maxCardsPerPage ?? CONFIG.getMaxCardsPerPage("Naukri");
    const seenHrefs = new Set<string>();

    if (ctx.isCancelled?.() || page?.isClosed?.()) {
      ctx.logger(`Naukri listCards cancelled before start for "${ctx.keyword}" (Page ${ctx.page})`);
      return [];
    }

    const interceptedJobs: any[] = [];
    const onResponse = async (response: any) => {
      try {
        const url = response.url();
        if (url.includes("jobapi") && (url.includes("/search") || url.includes("v3") || url.includes("v4") || url.includes("search?"))) {
          const contentType = response.headers()["content-type"] || "";
          if (contentType.includes("application/json")) {
            // Enforce pagination identity matching: response pageNo must match ctx.page
            try {
              const urlObj = new URL(url);
              const pageParam = urlObj.searchParams.get("pageNo");
              const resPage = pageParam ? Number(pageParam) : 1;
              if (resPage !== ctx.page) {
                ctx.logger(`[API Intercept] Ignored mismatched JobAPI response (received Page ${resPage}, expected Page ${ctx.page})`);
                return;
              }
            } catch {}

            const json = await response.json().catch(() => null);
            if (json && Array.isArray(json.jobDetails)) {
              interceptedJobs.push(...json.jobDetails);
            }
          }
        }
      } catch {}
    };

    page.on("response", onResponse);

    try {
      if (ctx.isCancelled?.() || page?.isClosed?.()) {
        return [];
      }

      const startGoto = Date.now();
      await page.goto(ctx.searchUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.navTimeoutMs });
      ctx.logger(`Goto completed in ${Date.now() - startGoto}ms`);
      ctx.logger(`Post-nav URL: ${page.url()}`);
      
      if (ctx.isCancelled?.() || page?.isClosed?.()) {
        return [];
      }

      const title = (await page.title().catch(() => "")) || "";
      ctx.logger(`Page title: "${title}"`);
      const isExplicitBlock = title.includes("Just a moment") || title.includes("Access Denied") || title.includes("Attention Required");
      if (isExplicitBlock) {
        throw new Error(`Portal blocked by Cloudflare/Akamai challenge page (Title: ${title})`);
      }

      await humanize(page);
      
      // Give network API up to 3.5 seconds to deliver responses if not yet arrived
      const deadline = Date.now() + 3500;
      while (interceptedJobs.length === 0 && Date.now() < deadline) {
        if (ctx.isCancelled?.() || page?.isClosed?.()) {
          return [];
        }
        await sleep(200);
      }

      // Helper to parse a single Naukri job object into a FeedCard
      const parseNaukriJob = (job: any): FeedCard | null => {
        try {
          const jobTitle = (job.title || "").trim();
          const company = (job.companyName || "").trim();
          const placeholders = Array.isArray(job.placeholders) ? job.placeholders : [];
          const location = (placeholders.find((p: any) => p.type === "location")?.label || job.location || "India").trim();
          const salary = (placeholders.find((p: any) => p.type === "salary")?.label || (job.salaryDetail?.maximumSalary ? `${job.salaryDetail.minimumSalary ? (job.salaryDetail.minimumSalary / 100000).toFixed(1) + '-' : ''}${(job.salaryDetail.maximumSalary / 100000).toFixed(1)} Lacs` : "Not Disclosed")).trim();
          const experience = (placeholders.find((p: any) => p.type === "experience")?.label || job.experienceText || "").trim();
          
          const rawHref = (job.jdURL || job.staticUrl || "").trim();
          if (!rawHref || !jobTitle || !company) return null;

          const detailUrl = rawHref.startsWith("http")
            ? rawHref
            : `https://www.naukri.com${rawHref.startsWith("/") ? "" : "/"}${rawHref}`;
          
          if (seenHrefs.has(detailUrl)) return null;
          seenHrefs.add(detailUrl);

          const filterRes = passesHardFilter({ title: jobTitle, company, location });
          if (!filterRes.pass) {
            ctx.logger(`[HardFilter] Skipped "${jobTitle}" at ${company}: ${filterRes.reason}`);
            return null;
          }

          const rawPosted = job.footerPlaceholderLabel || (job.createdDate ? new Date(job.createdDate).toISOString() : "");
          const discoveredAt = new Date().toISOString();
          const { date: postedAt, precision: postedPrecision } = normalizePostingDate(rawPosted, discoveredAt);

          const cardHash = cardHashFor("Naukri", detailUrl);
          const rawHtml = job.jobDescription || `<h1>${jobTitle}</h1><h2>${company}</h2><p>${location} · ${experience} · ${salary}</p><p>${job.tagsAndSkills || ""}</p>`;
          const rawText = [
            jobTitle,
            company,
            location,
            experience ? `Experience: ${experience}` : "",
            salary ? `Salary: ${salary}` : "",
            job.tagsAndSkills ? `Skills: ${job.tagsAndSkills}` : "",
            job.jobDescription ? job.jobDescription.replace(/<[^>]+>/g, " ") : ""
          ].filter(Boolean).join("\n").replace(/\s+/g, " ").trim();

          return {
            cardHash,
            portal: "Naukri",
            keyword: ctx.keyword,
            searchUrl: ctx.searchUrl,
            detailUrl,
            discoveredAt,
            title: jobTitle,
            company,
            location,
            salary,
            postedAt,
            postedPrecision,
            rawHtml,
            rawText,
            applyRedirectUrl: job.applyRedirectUrl || undefined,
            jobApplyType: job.jobApplyType || undefined,
            companyApplyJob: typeof job.companyApplyJob === "boolean" ? job.companyApplyJob : undefined,
          };
        } catch (err: any) {
          ctx.logger(`Naukri API card parse skipped: ${err.message}`);
          return null;
        }
      };

      const CARD_SELECTORS = [
        "div.cust-job-tuple",
        "div[data-job-id]",
        "article.jobTuple",
        "div.srp-jobtuple-wrapper",
        "div[class*='jobTuple']",
        "div[class*='srp-jobtuple-wrapper']",
        "[class*='styles_jcard']",
      ].join(", ");

      // If we got jobs from the API response for this unit's page, parse into cards
      if (interceptedJobs.length > 0) {
        ctx.logger(`[API Intercept] Discovered ${interceptedJobs.length} structured jobs from Naukri jobapi (Page ${ctx.page})`);
        
        for (const job of interceptedJobs) {
          if (cardsOut.length >= maxCards) break;
          const card = parseNaukriJob(job);
          if (card) cardsOut.push(card);
        }
      }

      // A non-empty API response is only the first page of a lazy result
      // stream. Continue hydrating and then parse any additional responses.
      if (interceptedJobs.length > 0 && cardsOut.length < maxCards && !ctx.isCancelled?.() && !page?.isClosed?.()) {
        const hydration = await hydrateVirtualizedList(
          page,
          {
            cardSelector: CARD_SELECTORS,
            containerSelectors: ["#listContainer", ".list", ".srp-jobtuple-wrapper", ".search-result-container", "main"],
            targetCards: maxCards,
            maxPasses: 10,
            consecutiveStableLimit: 3,
            minPassDelayMs: 1200,
            maxPassDelayMs: 2500,
            isCancelled: ctx.isCancelled,
          },
          ctx.logger
        );
        ctx.logger(`[Naukri Hydration Summary] API + lazy stream discovered ${hydration.finalCount} DOM cards and ${interceptedJobs.length} API jobs`);

        // Responses captured during scrolling were appended after the first
        // parse; parse them now while the canonical URL set still deduplicates.
        for (const job of interceptedJobs) {
          if (cardsOut.length >= maxCards) break;
          const card = parseNaukriJob(job);
          if (card) cardsOut.push(card);
        }
      }

      // If API yielded 0 cards, fall back to DOM selector extraction
      if (cardsOut.length === 0) {
        if (ctx.isCancelled?.() || page?.isClosed?.()) {
          return [];
        }

        ctx.logger(`[DOM Fallback] API yielded 0 cards; falling back to DOM scraping`);
        const startWait = Date.now();
        await page.waitForSelector(CARD_SELECTORS, { timeout: CONFIG.cardWaitTimeoutMs }).catch(async (e: any) => {
          if (ctx.isCancelled?.() || page?.isClosed?.()) return;
          ctx.logger(`Selector timeout after ${Date.now() - startWait}ms`);
          const { dumpFailureArtifacts } = await import("../utils/failure-dump");
          await dumpFailureArtifacts(ctx.runId, ctx.portal, page, e.message);
        });

        if (ctx.isCancelled?.() || page?.isClosed?.()) {
          return [];
        }

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

        ctx.logger(`[Naukri Hydration Summary] Discovered ${hydration.finalCount} total DOM cards`);

        if (ctx.isCancelled?.() || page?.isClosed?.()) {
          return [];
        }

        const cards = await page.locator(CARD_SELECTORS).all();

        for (const card of cards) {
          if (cardsOut.length >= maxCards) break;
          if (ctx.isCancelled?.() || page?.isClosed?.()) break;
          try {
            const titleEl = card.locator("a.title, [class*='title'] a, a[class*='title'], [class*='row1'] a").first();
            const title = ((await titleEl.textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
            const company = ((await card.locator("a.comp-name, [class*='comp-name'], [class*='companyName'], a[class*='company'], [class*='company']").first().textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
            const location = ((await card.locator(".locWdth, span.loc, [class*='loc'], [class*='location'], [class*='loc-wrap']").first().textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
            const salary = ((await card.locator(".sal-wrap, span.sal, [class*='salary'], [class*='sal'], [class*='exp']").first().textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
            const href = ((await titleEl.getAttribute("href", { timeout: 1000 }).catch(() => "")) || "").trim();
            if (!href || !title) continue;

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
      }
    } catch (err: any) {
      const isCancelledOrClosed = ctx.isCancelled?.() || page?.isClosed?.() ||
        err?.message?.includes("Target page, context or browser has been closed") ||
        err?.message?.includes("browser has been closed");
      if (isCancelledOrClosed) {
        ctx.logger(`Naukri listCards cancelled cleanly during run shutdown.`);
        return [];
      }
      ctx.logger(`Naukri listCards failed: ${err.message}`);
      throw err;
    } finally {
      page?.off?.("response", onResponse);
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
      if (httpRes.fetched && httpRes.rawText && httpRes.rawText.length >= 300) {
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

  const browserContentSelectors = [
    "#jobs-desc",
    "[class*='components_jd']",
    "[class*='job-desc']",
    "[class*='dang-inner-html']",
    "[class*='JDSummary']",
    "[class*='key-skill']",
    "[class*='styles_job-desc-container']",
    "main",
    "article"
  ].join(", ");

  const doExtract = async (execPage?: any) => {
    const targetPage = execPage || page;
    try {
      await targetPage.setExtraHTTPHeaders({
        "Referer": ctx.searchUrl || "https://www.naukri.com/",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
      }).catch(() => {});
      await targetPage.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
      
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

      // METHOD 2: Broad DOM Selector Fallback (TopTier & Standard Naukri)
      if (!jdHtml) {
          ctx.logger(`[${ctx.portal}] Falling back to DOM selector extraction`);
          const htmlContent = await targetPage.content();
          const cheerioApi = cheerio.load(htmlContent);
          
          const primaryContainers = [
              "#jobs-desc [class*='components_jd']",
              "[class*='components_jd']",
              "#jobs-desc",
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
                  const clone = cheerio.load(elements.first().html() || "");
                  clone('br, p, div, li, h1, h2, h3, h4, h5, h6').append('\n');
                  const txt = clone.text().replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
                  if (txt.length >= 50) {
                      jdHtml = elements.first().html();
                      ctx.logger(`[${ctx.portal}] Found JD via selector fallback: ${sel} (${txt.length} chars)`);
                      break;
                  }
              }
          }
      }

      // METHOD 3: Deep innerText search Fallback
      if (!jdHtml) {
           ctx.logger(`[${ctx.portal}] Falling back to deep innerText search`);
           const contentNode = await targetPage.evaluate(() => {
               const nodes = Array.from(document.querySelectorAll('*'));
               for (let i = 0; i < nodes.length; i++) {
                   const textContent = nodes[i].textContent;
                   if (textContent && textContent.trim().toLowerCase() === 'job description') {
                       let parent = nodes[i].parentElement;
                       if (parent && parent.innerText.length > 50) {
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
        if (mainTxt.length >= 50) {
          rawText = mainTxt;
          rawHtml = (await mainLoc.innerHTML().catch(() => "")) || "";
        } else {
          const bodyTxt = ((await targetPage.locator("body").textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
          if (bodyTxt.length >= 50) {
            rawText = bodyTxt;
            rawHtml = (await targetPage.locator("body").innerHTML().catch(() => "")) || "";
          }
        }
      }

      const trimmedText = rawText.trim();
      const titleText = ((await targetPage.locator("h1, [class*='job-header'] h1, [class*='jd-header'] h1").first().textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
      const extractedTitle = titleText.length > 0 ? titleText : undefined;
      if (trimmedText.length === 0) {
        ctx.logger(`[${ctx.portal}] Empty job description for ${url}`);
        return {
          fetched: false,
          fetchError: "Empty job description",
          rawHtml: "",
          rawText: "",
          fetchDurationMs: Date.now() - t0,
          extractedTitle,
        };
      }

      const isSparse = trimmedText.length < 200;
      if (isSparse) {
        ctx.logger(`[${ctx.portal}] Preserving sparse description (${trimmedText.length} chars, quality=SPARSE) for ${url}`);
      }

      return {
        fetched: true,
        rawHtml,
        rawText: trimmedText,
        fetchDurationMs: Date.now() - t0,
        quality: isSparse ? ("SPARSE" as const) : ("VALID" as const),
        extractedTitle,
      };
    } catch (err: any) {
      return { fetched: false, fetchError: err.message, fetchDurationMs: Date.now() - t0 };
    }
  };

  if (ctx.pageManager) {
    return ctx.pageManager.executeTransaction("detail", (p: any) => doExtract(p));
  }
  return mutex ? mutex.runExclusive(() => doExtract()) : doExtract();
}

export function classifyNaukriHtml(html: string, title: string): { state: string; count?: number; marker?: string; reason?: string; title?: string } {
  if (title.includes("Just a moment") || title.includes("Access Denied") || html.includes("Cloudflare DDoS protection")) {
    return { state: "BLOCKED", title };
  }
  
  if (html.includes("zero-result") || html.includes("No matching jobs found")) {
    return { state: "ZERO_RESULTS", reason: "zero-result" };
  }
  
  if (html.includes("Naukri TopTier")) {
    return { state: "TOPTIER_SHELL", marker: "Naukri TopTier" };
  }
  
  if (html.includes("srp-jobtuple-wrapper") || html.includes("jobTuple") || html.includes("job-tuple")) {
    return { state: "RESULTS", count: 1 };
  }
  
  if (html.includes("id=\"__next\"") || html.includes("id=\"app-root\"")) {
    return { state: "UNHYDRATED_SPA" };
  }
  
  return { state: "UNKNOWN" };
}


