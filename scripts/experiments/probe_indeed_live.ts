import { getPortalContext } from "../scraper/portals/base";
import { indeedHandler } from "../scraper/portals/indeed";
import { ResponseValidator } from "../../src/lib/acquisition/validator";

async function testIndeedLive() {
  console.log("===============================================================");
  console.log("            RADAR v2 — Indeed Live Diagnostic Probe           ");
  console.log("===============================================================");

  const ctx = await getPortalContext("Indeed");
  const page = await ctx.newPage();

  const searchUrl = indeedHandler.buildSearchUrl("Vice President Marketing", 1);
  console.log("Navigating to Search URL:", searchUrl);

  const cards = await indeedHandler.listCards({
    runId: "test-indeed",
    portal: "Indeed",
    keyword: "Vice President Marketing",
    page: 1,
    searchUrl,
    browserContext: ctx,
    activePage: page,
    logger: console.log,
  } as any);

  console.log(`\nDiscovered Indeed Cards: ${cards.length}`);
  for (let i = 0; i < Math.min(10, cards.length); i++) {
    const c = cards[i];
    console.log(`[${i + 1}] Title: ${c.title} | Company: ${c.company} | Location: ${c.location}`);
    console.log(`    Detail URL: ${c.detailUrl}`);
    console.log(`    RawText Length: ${c.rawText?.length || 0}`);
  }

  if (cards.length > 0) {
    console.log("\n---------------------------------------------------------------");
    console.log("Testing Detail Extraction for first 3 cards:");
    console.log("---------------------------------------------------------------");

    for (let i = 0; i < Math.min(3, cards.length); i++) {
      const card = cards[i];
      console.log(`\n--> Card ${i + 1}: ${card.title} (${card.detailUrl})`);
      
      const detail = await indeedHandler.fetchDetail({
        runId: "test-indeed",
        portal: "Indeed",
        keyword: "Vice President Marketing",
        page: 1,
        searchUrl,
        browserContext: ctx,
        activePage: page,
        logger: console.log,
      } as any, card.detailUrl);

      console.log(`    Detail Fetched: ${detail.fetched}`);
      console.log(`    Fetch Error: ${detail.fetchError || "None"}`);
      console.log(`    Duration: ${detail.fetchDurationMs}ms`);
      console.log(`    Raw Text Length: ${detail.rawText?.length || 0}`);
      if (detail.rawText) {
        console.log(`    Preview: ${detail.rawText.substring(0, 250)}...`);
      }

      const val = ResponseValidator.validate({
        html: detail.rawHtml || "",
        url: card.detailUrl,
        sourcePortal: "Indeed",
        extractedTitle: card.title,
        extractedCompany: card.company,
        extractedDescription: detail.rawText || "",
      });
      console.log(`    Validation Result: isValid=${val.isValid}, quality=${val.quality}, failureClass=${val.failureClass || "None"}`);
    }
  }

  await ctx.close();
}

testIndeedLive().catch(console.error);
