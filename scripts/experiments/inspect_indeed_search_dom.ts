import { getPortalContext } from "../scraper/portals/base";
import * as cheerio from "cheerio";
import * as fs from "fs";

async function inspectSearchDom() {
  const ctx = await getPortalContext("Indeed");
  const page = await ctx.newPage();

  const searchUrl = "https://in.indeed.com/jobs?q=Vice+President+Marketing&l=India&start=0";
  console.log("Navigating to:", searchUrl);

  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 4000));

  console.log("Page title:", await page.title());

  const html = await page.content();
  fs.writeFileSync("indeed_search_dump.html", html);
  console.log("Saved indeed_search_dump.html (length:", html.length, ")");

  const $ = cheerio.load(html);

  // Check various potential card container selectors
  const testSelectors = [
    "li[data-jk]",
    "div[data-jk]",
    "[data-jk]",
    "div.job_seen_beacon",
    "div.cardOutline",
    "div[class*='cardOutline']",
    ".resultContent",
    ".slider_container",
    "table.jobCard_mainContent",
    "ul.jobsearch-ResultsList > li",
    "#mosaic-provider-jobcards ul > li",
    "div#mosaic-jobResults",
  ];

  for (const sel of testSelectors) {
    const count = $(sel).length;
    console.log(`Selector '${sel}': ${count} elements`);
  }

  // Inspect the top 3 cards found via [data-jk] or div.cardOutline or ul.jobsearch-ResultsList > li
  const cards = $("div.cardOutline, [data-jk], div.job_seen_beacon, ul.jobsearch-ResultsList > li").slice(0, 5);
  cards.each((i, el) => {
    const $el = $(el);
    console.log(`\n--- Card Element ${i + 1} ---`);
    console.log(`Tag: ${el.tagName}, Attributes:`, el.attribs);
    console.log(`data-jk attribute:`, $el.attr("data-jk") || $el.find("[data-jk]").attr("data-jk"));
    console.log(`Title element text:`, $el.find("h2.jobTitle, .jobTitle, [class*='jobTitle']").text().trim());
    console.log(`Company text:`, $el.find('[data-testid="company-name"], .companyName, [class*="companyName"]').text().trim());
    console.log(`Location text:`, $el.find('[data-testid="text-location"], .companyLocation, [class*="companyLocation"]').text().trim());
    console.log(`Links in card:`, $el.find("a").map((_, a) => ({ href: $(a).attr("href"), text: $(a).text().trim() })).get());
  });

  await ctx.close();
}

inspectSearchDom().catch(console.error);
