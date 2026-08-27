import { getPortalContext } from "../scraper/portals/base";
import fs from "fs";
import path from "path";

async function inspectPartialPayloads() {
  const context = await getPortalContext("Naukri");
  const searchPage = context.pages()[0] || (await context.newPage());
  const keyword = "Vice President Digital";
  const searchUrl = `https://www.naukri.com/vice-president-digital-jobs-in-india?k=${encodeURIComponent(keyword)}`;

  let rawApiJobs: any[] = [];
  searchPage.on("response", async (res: any) => {
    if (res.url().includes("jobapi/v3/search")) {
      const json = await res.json().catch(() => null);
      if (json && json.jobDetails) {
        rawApiJobs.push(...json.jobDetails);
      }
    }
  });

  console.log("Navigating to:", searchUrl);
  await searchPage.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await searchPage.waitForTimeout(4000);

  console.log(`Captured ${rawApiJobs.length} raw jobs from search API.`);

  // Filter for partial quality jobs (100 - 500 characters)
  const partialJobs = rawApiJobs.filter((j: any) => {
    const len = (j.jobDescription || "").trim().length;
    return len > 50 && len < 500;
  });

  console.log(`Found ${partialJobs.length} partial quality jobs (50 - 500 chars).`);

  const samples = partialJobs.map((j: any) => {
    // Find all URL-like or apply-related fields
    const urlFields: Record<string, any> = {};
    for (const [k, v] of Object.entries(j)) {
      if (
        typeof v === "string" && (v.startsWith("http") || v.includes("apply") || v.includes("url") || v.includes("link") || v.includes(".com")) ||
        typeof v === "object" && v !== null && (k.toLowerCase().includes("apply") || k.toLowerCase().includes("url") || k.toLowerCase().includes("link") || k.toLowerCase().includes("external"))
      ) {
        urlFields[k] = v;
      }
    }
    return {
      jobId: j.jobId,
      title: j.title,
      companyName: j.companyName,
      descLength: (j.jobDescription || "").length,
      jobDescription: j.jobDescription,
      jdURL: j.jdURL,
      staticUrl: j.staticUrl,
      applyUrl: j.applyUrl,
      isApplyUrlPresent: j.isApplyUrlPresent,
      urlFields,
      allKeys: Object.keys(j),
      fullRaw: j
    };
  });

  const outPath = path.join(process.cwd(), ".scraper-artifacts", "partial_payload_inspection.json");
  fs.writeFileSync(outPath, JSON.stringify(samples, null, 2), "utf8");
  console.log(`Saved ${samples.length} partial payload inspections to: ${outPath}`);

  // Also let's inspect what happens inside the TopTier split view when clicking one of these partial cards
  console.log("\nTesting in-page TopTier split view interaction on a partial card...");
  // Let's see if TopTier has clickable cards on the left pane and what renders on the right pane
  const cardSelectors = "#listContainer .srp-jobtuple-wrapper, #listContainer [data-job-id], .styles_job-listing__3GZ_k, .cust-job-tuple";
  const cardCount = await searchPage.locator(cardSelectors).count();
  console.log(`Found ${cardCount} DOM card elements on left pane with selector: ${cardSelectors}`);

  await searchPage.close();
  await context.close();
}

inspectPartialPayloads().catch(console.error);
