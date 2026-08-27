import { chromium } from "playwright";
import path from "path";
import fs from "fs";

async function testDirectFetch() {
  const profileDir = path.join(process.cwd(), ".scraper-artifacts", "profiles", "naukri");
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-setuid-sandbox"],
    viewport: { width: 1440, height: 900 },
  });

  const page = context.pages()[0] || (await context.newPage());

  await page.goto("https://www.naukri.com/chief-marketing-officer-jobs-in-india?k=Chief%20Marketing%20Officer", {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });

  const data = await page.evaluate(async () => {
    const apiUrl = `https://www.naukri.com/jobapi/v3/search?noOfResults=20&urlType=search_by_keyword&searchType=adv&keyword=Chief%20Marketing%20Officer&pageNo=1&k=Chief%20Marketing%20Officer&seoKey=chief-marketing-officer-jobs-in-india&src=directSearch&latLong=`;
    const res = await fetch(apiUrl, {
      headers: {
        "appid": "109",
        "systemid": "NWEB",
        "clientid": "d3skt0p",
        "accept": "application/json"
      }
    });
    if (!res.ok) return { status: res.status, error: res.statusText };
    return await res.json();
  });

  console.log("Direct API Response status/data keys:", Object.keys(data));
  if (data.jobDetails && data.jobDetails.length > 0) {
    console.log("First job fields:", Object.keys(data.jobDetails[0]));
    console.log("First job sample:", JSON.stringify(data.jobDetails[0], null, 2));
    fs.writeFileSync("naukri_api_first_job.json", JSON.stringify(data.jobDetails[0], null, 2), "utf-8");
  }

  await context.close();
}

testDirectFetch().catch(console.error);
