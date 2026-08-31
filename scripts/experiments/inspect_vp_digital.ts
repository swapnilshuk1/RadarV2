import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import path from "path";

async function inspectSearchJobs() {
  chromium.use(stealth());
  const profileDir = path.join(process.cwd(), ".scraper-artifacts", "profiles", "naukri");
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = context.pages()[0] || (await context.newPage());
  let jobs: any[] = [];
  page.on("response", async (res) => {
    if (res.url().includes("jobapi/v3/search")) {
      const json = await res.json().catch(() => null);
      if (json && json.jobDetails) jobs = json.jobDetails;
    }
  });

  await page.goto("https://www.naukri.com/vice-president-digital-jobs-in-india?k=Vice%20President%20Digital", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  console.log(`Discovered ${jobs.length} jobs.`);
  for (const j of jobs) {
    console.log({
      title: j.title,
      company: j.companyName,
      descLength: j.jobDescription?.length || 0,
      jobDescriptionPreview: j.jobDescription ? j.jobDescription.slice(0, 80) : "NONE",
      staticUrl: j.staticUrl,
      jdURL: j.jdURL
    });
  }

  await context.close();
}

inspectSearchJobs().catch(console.error);
