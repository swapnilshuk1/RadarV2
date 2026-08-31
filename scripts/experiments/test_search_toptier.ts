import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import path from "path";

async function testSearchAndClick() {
  chromium.use(stealth());
  const profileDir = path.join(process.cwd(), ".scraper-artifacts", "profiles", "naukri");
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-setuid-sandbox"],
    viewport: { width: 1440, height: 900 },
  });

  const page = context.pages()[0] || (await context.newPage());

  const searchUrl = "https://www.naukri.com/chief-marketing-officer-jobs-in-india?k=Chief%20Marketing%20Officer";
  console.log(`Navigating to search page: ${searchUrl}`);
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(3000);

  console.log("Search page URL:", page.url());
  console.log("Search page Title:", await page.title());

  // Check if TopTier / split view is active
  const isTopTier = (await page.title()).includes("TopTier");
  console.log("Is TopTier:", isTopTier);

  // Check cards on search page
  const cardLocators = page.locator("[class*='tuple'], [class*='jobTuple'], [data-job-id], article, [class*='srp-jobtuple-wrapper']");
  const cardCount = await cardLocators.count();
  console.log(`Card locators count: ${cardCount}`);

  // Check if right pane has job description
  const jdLoc = page.locator("#jobs-desc, [class*='components_jd'], [class*='styles_job-desc-container']");
  const jdCount = await jdLoc.count();
  console.log(`JD pane count on search page: ${jdCount}`);

  if (jdCount > 0) {
    const jdText = await jdLoc.first().innerText().catch(() => "");
    console.log(`JD pane text length on search page (first selected job): ${jdText.length}`);
    console.log(`JD preview: ${jdText.slice(0, 200).replace(/\n/g, ' ')}`);
  }

  await context.close();
}

testSearchAndClick().catch(console.error);
