import type { FeedCard, DetailedCard, PortalContext, PortalHandler } from "../types";
import { SNAPSHOT_SCHEMA_VERSION, SCRAPER_VERSION } from "../versions";
import { CONFIG } from "../config";
import { cardHashFor } from "../utils/hash";
import { humanize, jitter, sleep } from "../utils/jitter";
import { normalizePostingDate } from "../utils/date";
import { resolveIndeedListingBounded } from "../../../src/lib/acquisition/indeed-listing-identity";

export const indeedHandler: PortalHandler = {
  name: "Indeed",
  detailStrategy: "browser",
  async resolveListingIdentity(ctx, url) {
    // If URL already contains a stable Indeed jk param, construct the verified viewjob URL directly
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      if ((host === "indeed.com" || host.endsWith(".indeed.com")) && parsed.searchParams.has("jk")) {
        const jk = (parsed.searchParams.get("jk") || "").trim().toLowerCase();
        if (/^[a-z0-9_-]{4,128}$/i.test(jk)) {
          return { finalUrl: `https://in.indeed.com/viewjob?jk=${jk}` };
        }
      }
    } catch {
      // Fall through to bounded resolution
    }

    const page = ctx.detailPage || ctx.searchPage || ctx.activePage;
    const resolution = await resolveIndeedListingBounded(url, async (hopUrl) => {
      const response = await page.context().request.fetch(hopUrl, {
        maxRedirects: 0,
        timeout: CONFIG.detailTimeoutMs,
      });
      try {
        return { status: response.status(), location: response.headers()["location"] };
      } finally {
        await response.dispose();
      }
    });
    return resolution.ok
      ? { finalUrl: resolution.identity.resolvedUrl }
      : { finalUrl: resolution.finalUrl, identityResolutionFailure: resolution.failure };
  },
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

      // Early challenge/block detection (Gate 6)
      const isBlocked = await page.evaluate(() => {
        const title = (document.title || "").toLowerCase();
        const bodyText = document.body ? document.body.innerText.toLowerCase() : "";
        return (
          title.includes("blocked") ||
          title.includes("just a moment") ||
          title.includes("attention required") ||
          bodyText.includes("cf-challenge") ||
          Boolean(document.querySelector('iframe[src*="captcha" i], form[action*="captcha" i], #challenge-running'))
        );
      }).catch(() => false);

      if (isBlocked === true) {
        ctx.logger("Indeed anti-bot / challenge page detected during listCards");
        throw new Error("Indeed search blocked by anti-bot verification (Cloudflare/CAPTCHA)");
      }

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
      let extractedData: any[] = [];

      if (matched) {
        extractedData = await page.evaluate((selector: string) => {
          const cards = Array.from(document.querySelectorAll(selector));
          return cards.map((card) => {
            const titleEl = card.querySelector("h2.jobTitle, .jobTitle, [class*='jobTitle']");
            const title = (titleEl?.textContent || "").trim();
            const compEl = card.querySelector('[data-testid="company-name"], .companyName, [class*="companyName"]');
            const company = (compEl?.textContent || "").trim();
            const locEl = card.querySelector('[data-testid="text-location"], .companyLocation, [class*="companyLocation"]');
            const location = (locEl?.textContent || "").trim();
            const salEl = card.querySelector('[data-testid="attribute_snippet_testid"], .salary-snippet, [class*="salary"]');
            const salary = (salEl?.textContent || "").trim();
            const urlEl = card.querySelector("h2.jobTitle a, a[data-jk], a[href*='/rc/clk'], a[href*='/jobs/view'], a[href*='viewjob']");
            const rawHref = (urlEl?.getAttribute("href") || "").trim();
            const jk = (card.getAttribute("data-jk") || urlEl?.getAttribute("data-jk") || "").trim();
            const dateEl = card.querySelector('[data-testid="myJobsStateDate"], span.date, .date');
            const rawPosted = (dateEl?.textContent || "").trim();
            const rawHtml = card.innerHTML || "";
            const rawText = (card.textContent || "").replace(/\s+/g, " ").trim();
            return { title, company, location, salary, rawHref, jk, rawPosted, rawHtml, rawText };
          });
        }, usedSelector).catch(() => []);
      }

      // If DOM yielded 0 cards, attempt structured/embedded data extraction
      if (extractedData.length === 0) {
        extractedData = await page.evaluate(() => {
          try {
            // 1. window.mosaic provider data
            const mosaic = (window as any).mosaic?.providerData?.["mosaic-provider-jobsearch-result"]?.metaData?.mosaicProviderJobCardsModel?.results;
            if (Array.isArray(mosaic) && mosaic.length > 0) {
              return mosaic.map((job: any) => ({
                title: job.title || job.normTitle || "",
                company: job.company || job.companyName || "",
                location: job.formattedLocation || job.location || "",
                salary: job.estimatedSalary?.formatted || job.salarySnippet?.text || "",
                rawHref: job.viewJobLink || "",
                jk: job.jobkey || job.jk || "",
                rawPosted: job.formattedRelativeTime || job.pubDate || "",
                rawHtml: job.snippet || "",
                rawText: job.snippet ? job.snippet.replace(/<[^>]+>/g, " ") : "",
              }));
            }

            // 2. script#mosaic-data or mosaic JSON
            const mosaicScript = document.querySelector('script#mosaic-data, script[id*="mosaic"]');
            if (mosaicScript && mosaicScript.textContent) {
              const parsed = JSON.parse(mosaicScript.textContent);
              const res = parsed?.metaData?.mosaicProviderJobCardsModel?.results || parsed?.results;
              if (Array.isArray(res) && res.length > 0) {
                return res.map((job: any) => ({
                  title: job.title || job.normTitle || "",
                  company: job.company || job.companyName || "",
                  location: job.formattedLocation || job.location || "",
                  salary: job.estimatedSalary?.formatted || job.salarySnippet?.text || "",
                  rawHref: job.viewJobLink || "",
                  jk: job.jobkey || job.jk || "",
                  rawPosted: job.formattedRelativeTime || job.pubDate || "",
                  rawHtml: job.snippet || "",
                  rawText: job.snippet ? job.snippet.replace(/<[^>]+>/g, " ") : "",
                }));
              }
            }

            // 3. JSON-LD scripts
            const jsonLdScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
            const jsonLdJobs: any[] = [];
            for (const s of jsonLdScripts) {
              try {
                const data = JSON.parse(s.textContent || "");
                if (data["@type"] === "JobPosting") jsonLdJobs.push(data);
                if (Array.isArray(data["@graph"])) {
                  for (const item of data["@graph"]) {
                    if (item["@type"] === "JobPosting") jsonLdJobs.push(item);
                  }
                }
              } catch {}
            }
            if (jsonLdJobs.length > 0) {
              return jsonLdJobs.map((job: any) => {
                let candidateJk = "";
                if (typeof job.url === "string") {
                  const m = job.url.match(/[?&]jk=([a-f0-9]{16})/i);
                  if (m) candidateJk = m[1];
                }
                if (!candidateJk && job.identifier?.value) {
                  const idName = String(job.identifier?.name || "").toLowerCase();
                  const val = String(job.identifier.value).trim();
                  if ((idName === "indeed" || idName === "indeed job id") && /^[a-f0-9]{16}$/i.test(val)) {
                    candidateJk = val;
                  }
                }
                return {
                  title: job.title || "",
                  company: job.hiringOrganization?.name || "",
                  location: typeof job.jobLocation?.address === "string" ? job.jobLocation.address : (job.jobLocation?.address?.addressLocality || ""),
                  salary: job.baseSalary?.value?.value ? String(job.baseSalary.value.value) : "",
                  rawHref: job.url || "",
                  jk: candidateJk,
                  externalRequisitionId: job.identifier?.value ? String(job.identifier.value) : undefined,
                  rawPosted: job.datePosted || "",
                  rawHtml: job.description || "",
                  rawText: job.description ? job.description.replace(/<[^>]+>/g, " ") : "",
                };
              });
            }
          } catch {}
          return [];
        }).catch(() => []);
      }

      if (!Array.isArray(extractedData)) extractedData = [];

      for (const item of extractedData) {
        if (cardsOut.length >= maxCards) break;
        try {
          const title = (item.title || "").trim();
          const company = (item.company || "").trim();
          const location = (item.location || "").trim();
          const salary = (item.salary || "").trim();
          const rawHref = (item.rawHref || "").trim();
          let candidateJk = (item.jk || "").trim();

          if (!candidateJk && rawHref) {
            const match = rawHref.match(/[?&]jk=([a-f0-9]{16})/i);
            if (match) candidateJk = match[1];
          }

          // Strict format: Indeed JKs are 16-hexadecimal character hashes. Employer requisition IDs are NOT JKs.
          const isAuthoritativeJk = Boolean(candidateJk && /^[a-f0-9]{16}$/i.test(candidateJk));
          const jk = isAuthoritativeJk ? candidateJk.toLowerCase() : "";

          if (jk && seenJks.has(jk)) continue;
          if (jk) seenJks.add(jk);

          let detailUrl = "";
          let applyRedirectUrl: string | undefined = undefined;

          const discoveryUrl = rawHref ? new URL(rawHref, "https://in.indeed.com").toString() : undefined;
          if (jk) {
            detailUrl = `https://in.indeed.com/viewjob?jk=${jk}`;
            applyRedirectUrl = discoveryUrl || `https://in.indeed.com/rc/clk?jk=${jk}`;
          } else if (discoveryUrl && /\/(?:pagead|rc)\/clk/i.test(new URL(discoveryUrl).pathname)) {
            // Sponsored links without an extracted jk are observations;
            // destination is resolved under the bounded detail contract.
            detailUrl = discoveryUrl;
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

          const cardHash = cardHashFor("Indeed", detailUrl);
          if (seenHashes.has(cardHash)) continue;
          seenHashes.add(cardHash);

          const discoveredAt = new Date().toISOString();
          const { date: postedAt, precision: postedPrecision } = normalizePostingDate(item.rawPosted || "", discoveredAt);

          cardsOut.push({
            cardHash,
            sourceJobId: jk || undefined,
            portal: "Indeed",
            keyword: ctx.keyword,
            searchUrl: ctx.searchUrl,
            discoveryUrl: discoveryUrl || detailUrl,
            detailUrl,
            applyRedirectUrl,
            discoveredAt,
            title,
            company,
            location,
            salary,
            postedAt,
            postedPrecision,
            rawHtml: item.rawHtml || "",
            rawText: item.rawText || "",
          });
        } catch (err: any) {
          ctx.logger(`Indeed card parse skipped: ${err.message}`);
        }
      }

      if (cardsOut.length === 0) {
        const title = (await page.title().catch(() => "")) || "";
        if (/just a moment|access denied|security check|cloudflare|recaptcha/i.test(title)) {
          throw new Error(`Indeed blocked by challenge/verification page (Title: ${title})`);
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
      if (httpRes.fetched && httpRes.rawText && httpRes.rawText.length >= 200) {
        ctx.recordHttpSuccess?.(url);
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
      const identity = await indeedHandler.resolveListingIdentity!(ctx, url);
      if (identity.identityResolutionFailure) {
        return {
          fetched: false,
          fetchError: `Indeed identity resolution failed: ${identity.identityResolutionFailure}`,
          fetchDurationMs: Date.now() - t0,
          finalUrl: identity.finalUrl,
          identityResolutionFailure: identity.identityResolutionFailure,
        };
      }
      await page.goto(identity.finalUrl!, { waitUntil: "domcontentloaded", timeout: CONFIG.detailTimeoutMs });
      await jitter(400, 900);

      // Check current page URL (might have followed an external ATS redirect from /rc/clk)
      const currentUrl = page.url();
      const isExternalAts = !currentUrl.includes("indeed.com");

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
          finalUrl: currentUrl,
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
        quality: trimmedText.length < 200 ? ("SPARSE" as const) : ("VALID" as const),
        extractedTitle,
        finalUrl: currentUrl,
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
