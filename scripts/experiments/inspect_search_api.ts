import { chromium } from "playwright";
import path from "path";
import fs from "fs";

async function inspectSearchApiResponse() {
  const profileDir = path.join(process.cwd(), ".scraper-artifacts", "profiles", "naukri");
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-setuid-sandbox"],
    viewport: { width: 1440, height: 900 },
  });

  const page = context.pages()[0] || (await context.newPage());

  let capturedApiPayload: any = null;

  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("jobapi") || url.includes("cloudgateway") || url.includes("search") || url.includes("aurus")) {
      try {
        const ct = response.headers()["content-type"] || "";
        if (ct.includes("json")) {
          const json = await response.json().catch(() => null);
          if (json && (json.jobDetails || json.jobData || json.jobs || json.data)) {
            console.log(`\n[API Intercepted] URL: ${url}`);
            capturedApiPayload = json;
          }
        }
      } catch {}
    }
  });

  console.log("Navigating to search page...");
  await page.goto("https://www.naukri.com/chief-marketing-officer-jobs-in-india?k=Chief%20Marketing%20Officer", {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });

  await page.waitForTimeout(5000);

  if (capturedApiPayload) {
    fs.writeFileSync("naukri_api_sample.json", JSON.stringify(capturedApiPayload, null, 2), "utf-8");
    console.log("Saved API payload to naukri_api_sample.json");

    // Inspect first job item
    const jobs = capturedApiPayload.jobDetails || capturedApiPayload.jobData || capturedApiPayload.jobs || capturedApiPayload.data;
    if (Array.isArray(jobs) && jobs.length > 0) {
      console.log("\nKeys in first job item:", Object.keys(jobs[0]));
      console.log("\nFirst job item sample:", JSON.stringify(jobs[0], null, 2).slice(0, 1500));
    }
  } else {
    console.log("No API payload captured");
  }

  await context.close();
}

inspectSearchApiResponse().catch(console.error);
