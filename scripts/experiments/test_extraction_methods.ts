import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import path from "path";

async function testExtractionMethods() {
  chromium.use(stealth());
  const profileDir = path.join(process.cwd(), ".scraper-artifacts", "profiles", "naukri");
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-setuid-sandbox"],
    viewport: { width: 1440, height: 900 },
  });

  const page = context.pages()[0] || (await context.newPage());

  // Capture search API response to get job details & job IDs
  let searchJobs: any[] = [];
  page.on("response", async (res) => {
    if (res.url().includes("jobapi/v3/search")) {
      const json = await res.json().catch(() => null);
      if (json && json.jobDetails) searchJobs = json.jobDetails;
    }
  });

  const searchUrl = "https://www.naukri.com/chief-marketing-officer-jobs-in-india?k=Chief%20Marketing%20Officer";
  console.log(`Navigating to search page: ${searchUrl}`);
  await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(3000);

  console.log(`Captured ${searchJobs.length} jobs from search API.`);

  if (searchJobs.length > 0) {
    const job = searchJobs[0];
    const jobId = job.jobId || job.tracking?.jobId;
    const staticUrl = job.staticUrl || job.jdURL;
    console.log(`\nTesting Job #1:`);
    console.log(`  Title: ${job.title}`);
    console.log(`  Company: ${job.companyName}`);
    console.log(`  JobId: ${jobId}`);
    console.log(`  StaticUrl / JD URL: ${staticUrl}`);
    console.log(`  jobDescription in search payload: ${job.jobDescription?.length} chars`);

    // METHOD 1: In-page evaluate fetch to Naukri's detail API endpoint
    console.log(`\n--- METHOD 1: Evaluate Fetch to Job Detail API ---`);
    const apiDetail = await page.evaluate(async (jid) => {
      try {
        const endpoints = [
          `https://www.naukri.com/jobapi/v3/job/${jid}`,
          `https://www.naukri.com/jobapi/v4/job/${jid}`,
          `https://www.naukri.com/jobapi/v3/job/details/${jid}`,
          `https://www.naukri.com/jobapi/v1/job/${jid}`,
          `https://www.naukri.com/cloudgateway-aurus/aurus-jobseeker-profile-wrapper/v0/jobseeker/jobs/${jid}`
        ];
        const results: any = {};
        for (const ep of endpoints) {
          try {
            const r = await fetch(ep, {
              headers: {
                "appid": "109",
                "systemid": "NWEB",
                "clientid": "d3skt0p",
                "accept": "application/json"
              }
            });
            results[ep] = { status: r.status, text: (await r.text()).slice(0, 200) };
          } catch (e: any) {
            results[ep] = { error: e.message };
          }
        }
        return results;
      } catch (e: any) {
        return { error: e.message };
      }
    }, jobId);
    console.log("Method 1 Results:", JSON.stringify(apiDetail, null, 2));

    // METHOD 2: Open in a new tab from context with proper headers
    console.log(`\n--- METHOD 2: Open detail URL in new tab ---`);
    const detailUrl = staticUrl?.startsWith("http") ? staticUrl : `https://www.naukri.com${staticUrl}`;
    const detailPage = await context.newPage();
    await detailPage.setExtraHTTPHeaders({
      "Referer": searchUrl,
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1"
    });
    const navRes = await detailPage.goto(detailUrl, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(e => {
      console.log("Nav error:", e.message);
      return null;
    });
    console.log("Method 2 Status:", navRes?.status());
    console.log("Method 2 Final URL:", detailPage.url());
    console.log("Method 2 Title:", await detailPage.title());

    const jdSel = "#jobs-desc, [class*='components_jd'], [class*='job-desc'], [class*='dang-inner-html'], [class*='styles_job-desc-container']";
    const found = await detailPage.locator(jdSel).count();
    console.log("Method 2 JD Selector matches count:", found);
    if (found > 0) {
      const txt = await detailPage.locator(jdSel).first().innerText();
      console.log(`Method 2 Extracted Text Length: ${txt.length}`);
      console.log(`Method 2 Preview: ${txt.slice(0, 150)}`);
    }
    await detailPage.close();
  }

  await context.close();
}

testExtractionMethods().catch(console.error);
