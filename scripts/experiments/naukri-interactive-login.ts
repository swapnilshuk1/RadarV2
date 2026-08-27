import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import * as cheerio from "cheerio";
import readline from "readline";
import * as fs from "fs";
import * as path from "path";
import { ResponseValidator } from "../../src/lib/acquisition/validator";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function askQuestion(query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function runInteractiveNaukri() {
  console.log("===============================================================");
  console.log("       RADAR v2 — Supervised Naukri Login & Extraction Trace   ");
  console.log("===============================================================\n");

  chromium.use(stealth());

  const profileDir = path.join(process.cwd(), ".scraper-artifacts", "profiles", "naukri");
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  console.log(`[Profile] Using persistent profile directory: ${profileDir}`);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1366, height: 850 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
    ],
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  // Listen to network requests to discover any internal API endpoints
  const discoveredApis = new Set<string>();
  page.on("response", async (response) => {
    try {
      const url = response.url();
      if (
        (url.includes("jobapi") || url.includes("cloudgateway") || url.includes("/job/")) &&
        !discoveredApis.has(url)
      ) {
        discoveredApis.add(url);
        console.log(`[Network Intercept] API response: ${url.split("?")[0]} (Status: ${response.status()})`);
      }
    } catch {}
  });

  try {
    console.log("\nNavigating to Naukri login page: https://www.naukri.com/nlogin/login");
    await page.goto("https://www.naukri.com/nlogin/login", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    console.log("\n***************************************************************");
    console.log("                   *** BROWSER IS NOW OPEN ***                 ");
    console.log("1. Please log into your Naukri account in the browser window.  ");
    console.log("2. Complete any OTP / CAPTCHA verification if prompted.         ");
    console.log("3. Once you see your Naukri dashboard or search bar...         ");
    console.log("***************************************************************\n");

    await askQuestion("Press ENTER in this terminal once you have successfully logged in: ");

    console.log("\n[Auth] Checking session cookies and state...");
    const cookies = await context.cookies("https://www.naukri.com");
    console.log(`[Auth] Captured ${cookies.length} session cookies in persistent profile.`);

    // Test Search
    const searchKeyword = "Chief Marketing Officer";
    const slug = searchKeyword.toLowerCase().replace(/\s+/g, "-");
    const searchUrl = `https://www.naukri.com/${slug}-jobs-in-india?k=${encodeURIComponent(searchKeyword)}`;

    console.log(`\n[Search] Navigating to search query: ${searchUrl}`);
    
    const interceptedJobs: any[] = [];
    const searchListener = async (response: any) => {
      try {
        const url = response.url();
        if (url.includes("jobapi") && url.includes("/search")) {
          const json = await response.json().catch(() => null);
          if (json && Array.isArray(json.jobDetails)) {
            interceptedJobs.push(...json.jobDetails);
          }
        }
      } catch {}
    };

    page.on("response", searchListener);

    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    page.off("response", searchListener);

    console.log(`[Search API] Intercepted ${interceptedJobs.length} jobs directly from search API.`);

    // If intercept was empty, fetch via evaluate
    if (interceptedJobs.length === 0) {
      console.log("[Search API] Attempting direct in-page evaluate fetch...");
      const evalJobs = await page
        .evaluate(async (kw: string) => {
          try {
            const slug = kw.toLowerCase().replace(/\s+/g, "-");
            const res = await fetch(
              `https://www.naukri.com/jobapi/v3/search?noOfResults=20&urlType=search_by_keyword&searchType=adv&keyword=${encodeURIComponent(kw)}&pageNo=1&k=${encodeURIComponent(kw)}&seoKey=${slug}-jobs-in-india&src=directSearch&latLong=`,
              {
                headers: {
                  appid: "109",
                  systemid: "NWEB",
                  clientid: "d3skt0p",
                  accept: "application/json",
                },
              }
            );
            if (!res.ok) return [];
            const data = await res.json();
            return data?.jobDetails || [];
          } catch {
            return [];
          }
        }, searchKeyword)
        .catch(() => []);

      if (evalJobs.length > 0) {
        interceptedJobs.push(...evalJobs);
        console.log(`[Search API] In-page evaluate fetch discovered ${evalJobs.length} jobs.`);
      }
    }

    if (interceptedJobs.length === 0) {
      console.log("❌ No jobs discovered via API. Dumping HTML for analysis...");
      const content = await page.content();
      fs.writeFileSync("naukri_search_fallback.html", content, "utf-8");
      return;
    }

    // Pick top 3 jobs to test detail acquisition
    const targetJobs = interceptedJobs.slice(0, 3);
    console.log(`\nTesting Detail Acquisition across ${targetJobs.length} sample CXO jobs:\n`);

    for (let i = 0; i < targetJobs.length; i++) {
      const job = targetJobs[i];
      const jobTitle = (job.title || "").trim();
      const company = (job.companyName || "").trim();
      const rawHref = (job.jdURL || job.staticUrl || "").trim();
      const detailUrl = rawHref.startsWith("http")
        ? rawHref
        : `https://www.naukri.com${rawHref.startsWith("/") ? "" : "/"}${rawHref}`;

      console.log(`---------------------------------------------------------------`);
      console.log(`[Job ${i + 1}/${targetJobs.length}] ${jobTitle} @ ${company}`);
      console.log(`URL: ${detailUrl}`);

      const detailPage = await context.newPage();
      try {
        console.log(`  -> Navigating to detail page in new tab...`);
        await detailPage.goto(detailUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
        await detailPage.waitForTimeout(2000);

        // Vector 1: Check Next.js State
        console.log(`  -> Testing Vector 1: __NEXT_DATA__ JSON state`);
        let extractedHtml: string | null = null;
        let extractedText: string = "";
        let methodUsed = "";

        const nextDataText = await detailPage.evaluate(() => {
          const el = document.querySelector("#__NEXT_DATA__");
          return el ? el.innerHTML : null;
        });

        if (nextDataText) {
          try {
            const nextData = JSON.parse(nextDataText);
            const jd =
              nextData?.props?.pageProps?.jobDetails?.jobDescription ||
              nextData?.props?.pageProps?.initialState?.jobDetails?.jobDescription;
            if (jd && jd.length > 200) {
              extractedHtml = jd;
              methodUsed = "__NEXT_DATA__";
              console.log(`     ✓ Found un-truncated JD in Next.js state (${jd.length} chars)`);
            }
          } catch {}
        }

        // Vector 2: Check in-page direct Job API if Next.js was missing
        if (!extractedHtml && job.jobId) {
          console.log(`  -> Testing Vector 2: Direct in-page job detail API for jobId: ${job.jobId}`);
          const apiDetail = await detailPage.evaluate(async (jobId: string) => {
            try {
              const res = await fetch(`https://www.naukri.com/jobapi/v4/job/${jobId}`, {
                headers: {
                  appid: "109",
                  systemid: "NWEB",
                  clientid: "d3skt0p",
                  accept: "application/json",
                },
              });
              if (!res.ok) return null;
              const json = await res.json();
              return json?.jobDetails?.jobDescription || json?.jobDescription || null;
            } catch {
              return null;
            }
          }, job.jobId).catch(() => null);

          if (apiDetail && apiDetail.length > 200) {
            extractedHtml = apiDetail;
            methodUsed = "IN_PAGE_JOBAPI_V4";
            console.log(`     ✓ Found full JD via direct in-page API v4 (${apiDetail.length} chars)`);
          }
        }

        // Vector 3: Rendered DOM Selectors
        if (!extractedHtml) {
          console.log(`  -> Testing Vector 3: Rendered DOM selectors`);
          const domHtml = await detailPage.content();
          const $ = cheerio.load(domHtml);

          const selectors = [
            "#jobs-desc [class*='components_jd']",
            "[class*='components_jd']",
            "#jobs-desc",
            ".styles_job-desc-container",
            "section.job-desc",
            "div.styles_JDSummary",
            ".dang-inner-html",
            "[class*='dang-inner-html']",
            "[class*='job-desc']",
            "#job-description",
            "main",
          ];

          for (const sel of selectors) {
            const el = $(sel);
            if (el.length > 0) {
              // Format properly with line breaks
              const clone = cheerio.load(el.first().html() || "");
              clone('br, p, div, li, h1, h2, h3, h4, h5, h6').append('\n');
              const txt = clone.text().replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
              if (txt.length >= 200) {
                extractedHtml = el.first().html();
                extractedText = txt;
                methodUsed = `DOM_SELECTOR (${sel})`;
                console.log(`     ✓ Found full JD via DOM selector "${sel}" (${txt.length} chars)`);
                break;
              }
            }
          }
        }

        if (extractedHtml) {
          const $ = cheerio.load(extractedHtml);
          $("br, p, div, li, h1, h2, h3, h4, h5, h6").append("\n");
          extractedText = $.text().replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n").trim();

          const validation = ResponseValidator.validate({
            html: extractedHtml,
            url: detailUrl,
            sourcePortal: "Naukri",
            extractedTitle: jobTitle,
            extractedCompany: company,
            extractedDescription: extractedText,
          });

          console.log(`  -> EXTRACTION RESULT:`);
          console.log(`     Method:     ${methodUsed}`);
          console.log(`     Length:     ${extractedText.length} chars`);
          console.log(`     Validation: ${validation.isValid ? "✅ VALID" : "❌ INVALID (" + validation.failureClass + ")"}`);
          console.log(`     Snippet:    ${extractedText.slice(0, 160)}...`);

          // Save sample artifact
          if (i === 0) {
            const samplePath = path.join(process.cwd(), ".scraper-artifacts", "naukri-sample-jd.json");
            fs.writeFileSync(
              samplePath,
              JSON.stringify(
                {
                  jobTitle,
                  company,
                  detailUrl,
                  methodUsed,
                  textLength: extractedText.length,
                  validation,
                  text: extractedText,
                },
                null,
                2
              )
            );
            console.log(`     Saved sample artifact to: ${samplePath}`);
          }
        } else {
          console.log(`  ❌ Extraction failed on all 3 vectors for: ${detailUrl}`);
          const failHtml = await detailPage.content();
          fs.writeFileSync(`naukri_fail_${i}.html`, failHtml, "utf-8");
        }
      } catch (err: any) {
        console.log(`  ❌ Error processing job: ${err.message}`);
      } finally {
        await detailPage.close().catch(() => {});
      }
    }

    console.log("\n===============================================================");
    console.log("       Calibration Completed! Profile Cookies Persisted.       ");
    console.log("===============================================================");
  } catch (err: any) {
    console.error("Fatal calibration error:", err);
  } finally {
    rl.close();
    await context.close();
  }
}

runInteractiveNaukri();
