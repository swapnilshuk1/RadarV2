import { fastFetchDetail } from "../scraper/utils/http-fetch";
import fs from "fs";
import path from "path";

async function testExternalLinks() {
  const jsonPath = path.join(process.cwd(), ".scraper-artifacts", "partial_link_analysis_summary.json");
  const data: any[] = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

  const extJobs = data.filter((d) => d.hasApplyRedirect);

  console.log(`\n================================================================`);
  console.log(`  TESTING EXTERNAL LINK FETCHABILITY (${extJobs.length} JOBS)`);
  console.log(`================================================================\n`);

  for (const job of extJobs) {
    console.log(`[#${job.index}] Testing ${job.company} (${job.destinationDomain}):`);
    console.log(`     URL: ${job.applyRedirectUrl}`);

    try {
      const res = await fastFetchDetail(
        job.applyRedirectUrl,
        "h1, header, main, body",
        "main, article, [class*='description'], [class*='jobDescription'], [id*='jobDescription'], body"
      );

      const textLen = res.rawText?.length || 0;
      console.log(`     -> Result: Fetched=${res.fetched}, HTTP Status=${res.httpStatus}, Length=${textLen} chars`);
      if (textLen > 400) {
        console.log(`     -> Sample: "${res.rawText?.slice(0, 150).replace(/\s+/g, ' ')}..."`);
      }
    } catch (err: any) {
      console.log(`     -> Error: ${err.message}`);
    }
    console.log();
  }
}

testExternalLinks().catch(console.error);
