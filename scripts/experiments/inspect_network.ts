import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import path from "path";

async function inspectNetwork() {
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

  page.on("request", (req) => {
    const u = req.url();
    if (u.includes("jobapi") || u.includes("search") || u.includes("aurus") || u.includes("cloudgateway")) {
      console.log(`[Request] ${req.method()} ${u.slice(0, 120)}`);
    }
  });

  page.on("response", async (res) => {
    const u = res.url();
    if (u.includes("jobapi") || u.includes("search") || u.includes("aurus") || u.includes("cloudgateway")) {
      console.log(`[Response] ${res.status()} ${u.slice(0, 120)}`);
      try {
        const json = await res.json().catch(() => null);
        if (json) {
          console.log(`  -> JSON keys: ${Object.keys(json).join(", ")}`);
          if (json.jobDetails) console.log(`  -> jobDetails count: ${json.jobDetails.length}`);
          if (json.data) console.log(`  -> data keys: ${Object.keys(json.data).join(", ")}`);
        }
      } catch {}
    }
  });

  const searchUrl = "https://www.naukri.com/chief-marketing-officer-jobs-in-india?k=Chief%20Marketing%20Officer";
  console.log(`Navigating to: ${searchUrl}`);
  await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 30000 }).catch(e => console.log("Nav timeout/error:", e.message));

  await page.waitForTimeout(5000);
  await context.close();
}

inspectNetwork().catch(console.error);
