import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import path from "path";

async function testSearchHeadlessNew() {
  chromium.use(stealth());
  const profileDir = path.join(process.cwd(), ".scraper-artifacts", "profiles", "naukri");
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
    viewport: { width: 1440, height: 900 },
  });

  const page = context.pages()[0] || (await context.newPage());

  const searchUrl = "https://www.naukri.com/chief-marketing-officer-jobs-in-india?k=Chief%20Marketing%20Officer";
  console.log(`Navigating to search page with headless: false: ${searchUrl}`);
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(4000);

  console.log("Search page URL:", page.url());
  console.log("Search page Title:", await page.title());

  const isTopTier = (await page.title()).includes("TopTier");
  console.log("Is TopTier:", isTopTier);

  // Check card locators
  const cardCount = await page.locator(".srp-jobtuple-wrapper, .cust-job-tuple, .jobTuple, [data-job-id]").count();
  console.log(`Card count: ${cardCount}`);

  await context.close();
}

testSearchHeadlessNew().catch(console.error);
