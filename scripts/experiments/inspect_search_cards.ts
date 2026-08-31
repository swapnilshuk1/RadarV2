import { chromium } from "playwright";
import path from "path";
import fs from "fs";

async function inspectSearchCards() {
  const profileDir = path.join(process.cwd(), ".scraper-artifacts", "profiles", "naukri");
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-setuid-sandbox"],
    viewport: { width: 1440, height: 900 },
  });

  const page = context.pages()[0] || (await context.newPage());

  console.log("Navigating to search page...");
  await page.goto("https://www.naukri.com/chief-marketing-officer-jobs-in-india?k=Chief%20Marketing%20Officer", {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });

  await page.waitForTimeout(4000);

  // Check what title/URL we are on
  console.log("Title:", await page.title());
  console.log("URL:", page.url());

  // Check card selectors
  const cardSelectors = [
    ".srp-jobtuple-wrapper",
    ".cust-job-tuple",
    ".jobTuple",
    "article.jobTuple",
    "[data-job-id]",
    "div[class*='jobTuple']",
    "div[class*='styles_job-card-container']",
    "div[class*='tuple']",
    "a.title",
    "a[class*='title']",
    "#jobs-desc",
    ".job-desc",
    "[class*='styles_details-container']"
  ];

  for (const sel of cardSelectors) {
    const count = await page.locator(sel).count();
    console.log(`Selector "${sel}": count = ${count}`);
  }

  // Dump search page HTML structure
  const html = await page.content();
  fs.writeFileSync("search_page_dump.html", html, "utf-8");
  console.log("Dumped search page to search_page_dump.html");

  await context.close();
}

inspectSearchCards().catch(console.error);
