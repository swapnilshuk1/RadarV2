import fs from "fs";
import * as cheerio from "cheerio";

const html = fs.readFileSync("docs/artifacts/naukri_j-dca748b4c4c8.html", "utf8");
const $ = cheerio.load(html);

console.log("=== NAUKRI TOPTIER DOM HIERARCHY ===");
$("*").each((i, el) => {
  const cls = $(el).attr("class") || "";
  const id = $(el).attr("id") || "";
  const txt = $(el).text().replace(/\s+/g, " ").trim();
  if (txt.includes("BUSINESS &MARKETING STRATEGY") && txt.length < 2500) {
    console.log(`Tag: <${el.tagName}> id="${id}" class="${cls}" | Len: ${txt.length} | Children: ${$(el).children().length}`);
  }
});
