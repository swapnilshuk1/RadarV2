import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import * as cheerio from "cheerio";
import readline from "readline";
import * as fs from "fs";
import * as path from "path";
import { ResponseValidator } from "../../src/lib/acquisition/validator";
import { passesHardFilter } from "../scraper/utils/hard-filter";
import { cardHashFor } from "../scraper/utils/hash";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function askQuestion(query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

export interface IndeedCardInfo {
  jk: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  detailUrl: string;
  rclkUrl: string;
  hasApplyButton?: boolean;
  applyButtonHref?: string;
  rawTextLength: number;
}

export async function runIndeedSupervised() {
  console.log("===============================================================");
  console.log("       RADAR v2 — Supervised Indeed Acquisition & ATS Trace     ");
  console.log("===============================================================\n");

  chromium.use(stealth());

  const profileDir = path.join(process.cwd(), ".scraper-artifacts", "profiles", "indeed");
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

  // Network API Interception (Quiet during prompt, logged when active)
  let logNetwork = false;
  const discoveredApis = new Set<string>();
  page.on("response", async (response) => {
    try {
      const url = response.url();
      if (
        (url.includes("graphql") || url.includes("jobapi") || url.includes("/viewjob")) &&
        !discoveredApis.has(url.split("?")[0])
      ) {
        discoveredApis.add(url.split("?")[0]);
        if (logNetwork) {
          console.log(`[Network Intercept] API: ${url.split("?")[0]} (Status: ${response.status()})`);
        }
      }
    } catch {}
  });

  try {
    console.log("\n---------------------------------------------------------------");
    console.log("Step 1: Session Verification & Human Clearance");
    console.log("---------------------------------------------------------------");
    console.log("Navigating to Indeed India homepage...");
    await page.goto("https://in.indeed.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2000);

    const title = await page.title();
    console.log(`Page Title: ${title}`);
    console.log(`Current URL: ${page.url()}`);

    console.log("\n***************************************************************");
    console.log("                   *** BROWSER IS NOW OPEN ***                 ");
    console.log("1. Check if Indeed shows any Cloudflare verification or CAPTCHA.");
    console.log("2. If prompted, solve the challenge in the browser.");
    console.log("3. Once the Indeed homepage is visible and ready...");
    console.log("***************************************************************\n");

    const searchKwInput = await askQuestion("Enter search query (press ENTER for 'Vice President Marketing'): ");
    const searchKeyword = searchKwInput.trim() || "Vice President Marketing";
    logNetwork = true;

    console.log(`\n---------------------------------------------------------------`);
    console.log(`Step 2: Live Discovery & Multi-Match Deduplication Audit`);
    console.log(`---------------------------------------------------------------`);
    const searchUrl = `https://in.indeed.com/jobs?q=${encodeURIComponent(searchKeyword)}&l=India&start=0`;
    console.log(`Navigating to Search URL: ${searchUrl}`);

    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);

    // Verified outer card container selectors
    const PRIMARY_CARD_SELECTOR = "div.cardOutline, div.job_seen_beacon, [data-jk]";
    const cardElements = await page.locator(PRIMARY_CARD_SELECTOR).all();
    console.log(`[Discovery] Found ${cardElements.length} raw card elements in DOM.`);

    const discoveredCards: IndeedCardInfo[] = [];
    const seenJks = new Set<string>();

    for (const cardEl of cardElements) {
      try {
        let jk = ((await cardEl.getAttribute("data-jk").catch(() => "")) || "").trim();
        const urlEl = cardEl.locator("h2.jobTitle a, a[data-jk], a[href*='/rc/clk'], a[href*='/jobs/view'], a[href*='viewjob']").first();
        const rawHref = ((await urlEl.getAttribute("href", { timeout: 1000 }).catch(() => "")) || "").trim();

        if (!jk) {
          jk = ((await urlEl.getAttribute("data-jk", { timeout: 500 }).catch(() => "")) || "").trim();
        }
        if (!jk && rawHref) {
          const match = rawHref.match(/[?&]jk=([a-f0-9]+)/i);
          if (match) jk = match[1];
        }

        if (!jk || seenJks.has(jk)) continue;
        seenJks.add(jk);

        const titleText = ((await cardEl.locator("h2.jobTitle, .jobTitle, [class*='jobTitle']").first().textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
        const companyText = ((await cardEl.locator('[data-testid="company-name"], .companyName, [class*="companyName"]').first().textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
        const locationText = ((await cardEl.locator('[data-testid="text-location"], .companyLocation, [class*="companyLocation"]').first().textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
        const salaryText = ((await cardEl.locator('[data-testid="attribute_snippet_testid"], .salary-snippet, [class*="salary"]').first().textContent({ timeout: 1000 }).catch(() => "")) || "").trim();
        const rawSnippet = ((await cardEl.textContent({ timeout: 1000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();

        if (!titleText) continue;

        const detailUrl = `https://in.indeed.com/viewjob?jk=${jk}`;
        const rclkUrl = `https://in.indeed.com/rc/clk?jk=${jk}`;

        discoveredCards.push({
          jk,
          title: titleText,
          company: companyText,
          location: locationText,
          salary: salaryText,
          detailUrl,
          rclkUrl,
          rawTextLength: rawSnippet.length,
        });
      } catch {}
    }

    console.log(`\nDiscovered ${discoveredCards.length} Unique Indeed Cards on Page 1:`);
    discoveredCards.forEach((c, idx) => {
      console.log(`  [${idx + 1}] ${c.title} @ ${c.company} (${c.location || "India"})`);
      console.log(`      JK: ${c.jk} | Detail: ${c.detailUrl}`);
    });

    if (discoveredCards.length === 0) {
      console.log("No cards discovered. Check browser window to see if layout changed.");
      return;
    }

    console.log("\n---------------------------------------------------------------");
    console.log("Step 3: Supervised Detail Acquisition Matrix");
    console.log("---------------------------------------------------------------");
    console.log("We will evaluate Native Detail Extraction vs External ATS following for top 3 cards.");

    const targetCards = discoveredCards.slice(0, 3);
    const artifactsDir = path.join(process.cwd(), "scripts", "experiments", "artifacts");
    if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });

    for (let i = 0; i < targetCards.length; i++) {
      const card = targetCards[i];
      console.log(`\n===============================================================`);
      console.log(`[Card ${i + 1}/${targetCards.length}] ${card.title} @ ${card.company}`);
      console.log(`Detail URL: ${card.detailUrl}`);
      console.log(`===============================================================`);

      const detailTab = await context.newPage();
      try {
        console.log(`  -> Navigating to Native Indeed ViewJob URL in tab...`);
        await detailTab.goto(card.detailUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await detailTab.waitForTimeout(2000);

        // Native DOM extraction
        const candidateSelectors = [
          "#jobDescriptionText",
          ".jobsearch-jobDescriptionText",
          "[data-testid='jobsearch-JobComponent-description']",
          "div#jobDescriptionSection",
          "main",
          "article",
        ];

        let nativeHtml = "";
        let nativeText = "";
        let selectorUsed = "none";

        for (const sel of candidateSelectors) {
          const count = await detailTab.locator(sel).count();
          if (count > 0) {
            const txt = ((await detailTab.locator(sel).first().textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
            if (txt.length >= 150) {
              nativeText = txt;
              nativeHtml = (await detailTab.locator(sel).first().innerHTML().catch(() => "")) || "";
              selectorUsed = sel;
              break;
            }
          }
        }

        console.log(`  [Native Indeed Extraction] Selector: '${selectorUsed}' | Length: ${nativeText.length} chars`);

        // Check for External Apply Button
        const applyBtn = detailTab.locator("button:has-text('Apply on company site'), a:has-text('Apply on company site'), [data-testid='apply-button']").first();
        const hasApplyBtn = (await applyBtn.count()) > 0;
        let applyHref = "";

        if (hasApplyBtn) {
          applyHref = ((await applyBtn.getAttribute("href").catch(() => "")) || "").trim();
          console.log(`  [External Apply Signal] Found 'Apply on company site' button (href: ${applyHref || "in-page action"})`);
        } else {
          console.log(`  [Native QuickApply Signal] Job appears to be Direct/Native Indeed Apply.`);
        }

        let atsType = "None / In-Portal";
        let finalAtsUrl = card.detailUrl;
        let atsHtml = "";
        let atsText = "";

        if (hasApplyBtn) {
          console.log(`\n  --- ATS REDIRECT TRACE ---`);
          console.log(`  Clicking 'Apply on company site' to trace outbound employer destination...`);

          const [atsTab] = await Promise.all([
            context.waitForEvent("page", { timeout: 15000 }).catch(() => null),
            applyBtn.click().catch(() => null),
          ]);

          const activeAtsPage = atsTab || detailTab;
          if (atsTab) {
            await atsTab.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => {});
            await atsTab.waitForTimeout(3000);
            finalAtsUrl = atsTab.url();
          } else {
            await detailTab.waitForTimeout(3000);
            finalAtsUrl = detailTab.url();
          }

          console.log(`  Final Outbound Destination URL: ${finalAtsUrl}`);

          if (finalAtsUrl.includes("workday.com") || finalAtsUrl.includes("myworkdayjobs.com")) atsType = "Workday";
          else if (finalAtsUrl.includes("greenhouse.io")) atsType = "Greenhouse";
          else if (finalAtsUrl.includes("lever.co")) atsType = "Lever";
          else if (finalAtsUrl.includes("smartrecruiters.com")) atsType = "SmartRecruiters";
          else if (finalAtsUrl.includes("ashbyhq.com")) atsType = "Ashby";
          else if (finalAtsUrl.includes("breezy.hr")) atsType = "Breezy";
          else if (finalAtsUrl.includes("taleo.net")) atsType = "Taleo";
          else if (finalAtsUrl.includes("successfactors.com")) atsType = "SuccessFactors";
          else if (!finalAtsUrl.includes("indeed.com")) atsType = "Direct Company Career Portal";

          console.log(`  Detected ATS Architecture: ${atsType}`);

          if (atsTab) {
            atsHtml = await atsTab.content();
            const $ats = cheerio.load(atsHtml);
            atsText = $ats("body").text().replace(/\s+/g, " ").trim();
            console.log(`  Extracted ATS Text Length: ${atsText.length} chars`);
            await atsTab.close().catch(() => {});
          }
        }

        // Validate Best Available Text
        const bestText = atsText.length >= 300 ? atsText : nativeText;
        const bestHtml = atsHtml.length >= 300 ? atsHtml : nativeHtml;
        const bestUrl = atsText.length >= 300 ? finalAtsUrl : card.detailUrl;

        const valResult = ResponseValidator.validate({
          html: bestHtml || bestText,
          url: bestUrl,
          sourcePortal: "Indeed",
          extractedTitle: card.title,
          extractedCompany: card.company,
          extractedDescription: bestText,
        });

        console.log(`\n  [Acquisition Verdict]`);
        console.log(`    Substantive Length ... ${bestText.length} chars`);
        console.log(`    Quality Classification ${valResult.quality}`);
        console.log(`    ResponseValidator .... ${valResult.isValid ? "✅ VALID" : "❌ INVALID"} (${valResult.failureClass || "None"})`);
        console.log(`    Preview .............. ${bestText.substring(0, 200)}...`);

        // Save diagnostic artifacts
        const ts = Date.now();
        const artifactReport = {
          jobKey: card.jk,
          title: card.title,
          company: card.company,
          location: card.location,
          detailUrl: card.detailUrl,
          hasApplyButton: hasApplyBtn,
          atsType,
          finalDestinationUrl: finalAtsUrl,
          nativeTextLength: nativeText.length,
          atsTextLength: atsText.length,
          chosenSource: atsText.length >= 300 ? "EXTERNAL_ATS" : "NATIVE_INDEED",
          validation: valResult,
          timestamp: new Date().toISOString(),
        };

        fs.writeFileSync(
          path.join(artifactsDir, `indeed-supervised-${card.jk}-${ts}.json`),
          JSON.stringify(artifactReport, null, 2)
        );
        if (bestHtml) {
          fs.writeFileSync(
            path.join(artifactsDir, `indeed-supervised-${card.jk}-${ts}.html`),
            bestHtml
          );
        }
      } catch (err: any) {
        console.error(`  ❌ Error processing card ${card.jk}: ${err.message}`);
      } finally {
        await detailTab.close().catch(() => {});
      }
    }

    console.log("\n===============================================================");
    console.log("            SUPERVISED INDEED EXPERIMENT COMPLETE             ");
    console.log("===============================================================");
    console.log(`All diagnostic artifacts saved to: ${artifactsDir}`);
    await askQuestion("\nPress ENTER to close browser and exit...");
  } finally {
    await context.close();
    rl.close();
  }
}

runIndeedSupervised().catch(console.error);
