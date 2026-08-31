import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import path from "path";

async function testWithStealthAndReferer() {
  chromium.use(stealth());
  const profileDir = path.join(process.cwd(), ".scraper-artifacts", "profiles", "naukri");
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-setuid-sandbox"],
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: {
      "Referer": "https://www.naukri.com/",
      "Accept-Language": "en-US,en;q=0.9",
    }
  });

  const page = context.pages()[0] || (await context.newPage());

  const urls = [
    "https://www.naukri.com/job-listings-brick-bolt-chief-marketing-officer-20-30-yrs-pluckwalk-technologies-private-limited-bangalore-20-to-30-years-110726000243",
    "https://www.naukri.com/job-listings-tescra-chief-marketing-officer-saas-ai-hr-tech-12-20-yrs-tescra-software-private-limited-bengaluru-12-to-20-years-040826021816",
    "https://www.naukri.com/job-listings-navin-s-chief-marketing-officer-20-25-yrs-navin-housing-and-properties-private-limited-chennai-20-to-25-years-290526001723"
  ];

  for (const url of urls) {
    console.log(`\nTesting: ${url}`);
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(e => {
      console.log("Goto error:", e.message);
      return null;
    });

    console.log("HTTP status:", res?.status());
    console.log("Current URL:", page.url());
    console.log("Page title:", await page.title());

    // Check selectors
    const sel = "#jobs-desc [class*='components_jd'], [class*='components_jd'], [class*='styles_job-desc-container'], [class*='dang-inner-html']";
    const el = page.locator(sel).first();
    const count = await el.count();
    console.log("Found JD elements count:", count);
    if (count > 0) {
      const txt = await el.innerText().catch(() => "");
      console.log(`JD text length: ${txt.length}`);
    }
  }

  await context.close();
}

testWithStealthAndReferer().catch(console.error);
