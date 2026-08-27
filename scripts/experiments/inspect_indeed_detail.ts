import { getPortalContext } from "../scraper/portals/base";
import * as fs from "fs";

async function inspectDetailDom() {
  const ctx = await getPortalContext("Indeed");
  const page = await ctx.newPage();

  const url = "https://in.indeed.com/viewjob?jk=377d4898b4be8a70";
  console.log("Navigating to:", url);

  page.on("response", async (res) => {
    const u = res.url();
    if (u.includes("job") || u.includes("api") || u.includes("graphql") || u.includes("viewjob")) {
      console.log("[Response Intercept]", res.status(), u.substring(0, 120));
    }
  });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 4000));

  console.log("Final Page URL:", page.url());
  console.log("Page Title:", await page.title());

  const html = await page.content();
  fs.writeFileSync("indeed_detail_dump.html", html);
  console.log("Dumped HTML to indeed_detail_dump.html (length:", html.length, ")");

  // Check selectors
  const selectors = [
    "#jobDescriptionText",
    ".jobsearch-jobDescriptionText",
    "[data-testid='jobsearch-JobComponent-description']",
    "#jobsearch-ViewjobPaneWrapper",
    ".fastpath-embedded",
    "#__NEXT_DATA__",
    "button[id*='apply' i]",
    "a[id*='apply' i]",
    "a[href*='/rc/clk']",
    "a[href*='apply']",
    "div#jobDescriptionSection",
    "div[id*='jobDescription']",
    "div[class*='jobDescription']",
  ];

  for (const s of selectors) {
    const count = await page.locator(s).count();
    const text = count > 0 ? (await page.locator(s).first().textContent().catch(() => ""))?.replace(/\s+/g, " ").trim() : "";
    console.log(`Selector '${s}': count = ${count}, textLength = ${text?.length || 0}`);
    if (text && text.length > 0) {
      console.log(`    Sample text: ${text.substring(0, 150)}...`);
    }
  }

  const nextData = await page.evaluate(() => {
    const el = document.querySelector("#__NEXT_DATA__");
    return el ? el.innerHTML : null;
  });
  if (nextData) {
    console.log("__NEXT_DATA__ length:", nextData.length);
    try {
      const parsed = JSON.parse(nextData);
      fs.writeFileSync("indeed_next_data.json", JSON.stringify(parsed, null, 2));
      console.log("Saved __NEXT_DATA__ to indeed_next_data.json");
    } catch (e) {
      console.log("Failed to parse __NEXT_DATA__");
    }
  }

  // Check all text in body
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log("Full Body InnerText Length:", bodyText.length);
  console.log("Full Body Text Sample:\n", bodyText.substring(0, 500));

  await ctx.close();
}

inspectDetailDom().catch(console.error);
