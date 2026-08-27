import { getPortalContext } from "../scraper/portals/base";
import * as cheerio from "cheerio";
import * as fs from "fs";

async function inspectApplyButton() {
  const ctx = await getPortalContext("Indeed");
  const page = await ctx.newPage();

  const url = "https://in.indeed.com/viewjob?jk=377d4898b4be8a70";
  console.log("Navigating to:", url);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));

  const applyBtn = page.locator("button:has-text('Apply on company site'), a:has-text('Apply on company site'), #applyButtonLinkContainer a, [data-testid='apply-button']").first();
  const applyCount = await applyBtn.count();
  console.log("Apply button count:", applyCount);

  if (applyCount > 0) {
    const tagName = await applyBtn.evaluate((el) => el.tagName);
    const href = await applyBtn.getAttribute("href").catch(() => null);
    const text = await applyBtn.textContent().catch(() => "");
    const outerHtml = await applyBtn.evaluate((el) => el.outerHTML);
    console.log("Apply element tag:", tagName);
    console.log("Apply element href:", href);
    console.log("Apply element text:", text?.trim());
    console.log("Apply outer HTML:", outerHtml);
  }

  // Also check all links on the page for external redirects or /rc/clk
  const allLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("a"))
      .map((a) => ({ href: a.href, text: a.innerText.trim() }))
      .filter((l) => l.href && (l.href.includes("rc/clk") || l.href.includes("apply") || l.text.toLowerCase().includes("apply")));
  });
  console.log("Found relevant apply/redirect links:", allLinks);

  // Check the search card hrefs as well
  const searchUrl = "https://in.indeed.com/jobs?q=Vice+President+Marketing&l=India";
  console.log("\nNavigating to search page to check card outbound links:", searchUrl);
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));

  const searchLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("li[data-jk]"))
      .slice(0, 5)
      .map((li) => {
        const jk = li.getAttribute("data-jk");
        const a = li.querySelector("a");
        const titleEl = li.querySelector("h2.jobTitle, .jobTitle");
        return {
          jk,
          title: titleEl?.textContent?.trim(),
          href: a?.getAttribute("href"),
          fullHref: a?.href,
        };
      });
  });
  console.log("Search card links sample:", searchLinks);

  await ctx.close();
}

inspectApplyButton().catch(console.error);
