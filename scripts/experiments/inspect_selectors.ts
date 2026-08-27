import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import path from "path";
import * as cheerio from "cheerio";

async function inspectCardSelectors() {
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
  console.log(`Navigating to: ${searchUrl}`);
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(4000);

  const html = await page.content();
  const $ = cheerio.load(html);

  // Look for links that point to /job-listings-
  const jobLinks = $("a[href*='job-listings']");
  console.log(`Found a[href*='job-listings'] count: ${jobLinks.length}`);

  jobLinks.slice(0, 5).each((i, el) => {
    const href = $(el).attr("href");
    const title = $(el).text().trim();
    const parentClass = $(el).parent().attr("class") || "";
    const grandParentClass = $(el).parent().parent().attr("class") || "";
    console.log(`\nJob #${i + 1}:`);
    console.log(`  Title: ${title}`);
    console.log(`  Href: ${href}`);
    console.log(`  Parent class: ${parentClass}`);
    console.log(`  GrandParent class: ${grandParentClass}`);
  });

  await context.close();
}

inspectCardSelectors().catch(console.error);
