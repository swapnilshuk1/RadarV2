import fs from "fs";
import path from "path";

const reportPath = path.resolve("scripts/forensic_sparse_report.json");
const data = JSON.parse(fs.readFileSync(reportPath, "utf8"));

console.log("=== P0 SAMPLE (First 15) ===");
data.p0.slice(0, 15).forEach((r: any, idx: number) => {
  console.log(`[P0 #${idx + 1}]`);
  console.log(`  ID: ${r.oppId} | Hash: ${r.jobHash}`);
  console.log(`  Portal: ${r.portal} | Title: ${r.title} | Company: ${r.company}`);
  console.log(`  URL: ${r.sourceUrl}`);
  console.log(`  Words: ${r.wordCount} | Chars: ${r.charCount} | Resp: ${r.responsibilities} | Req: ${r.requirements} | Qual: ${r.qualifications}`);
  console.log(`  Why: ${r.whySuspicious}`);
  console.log(`  Text: "${r.textPreview}"`);
  console.log(`  FailureSignals: ${r.failureSignals}`);
  console.log("--------------------------------------------------");
});

console.log("\n=== P0 WORD COUNT DISTRIBUTION ===");
const wordDist: Record<string, number> = {};
data.p0.forEach((r: any) => {
  const bucket = r.wordCount === 0 ? "0 words" : r.wordCount < 10 ? "1-9 words" : r.wordCount < 20 ? "10-19 words" : r.wordCount < 30 ? "20-29 words" : "30-49 words";
  wordDist[bucket] = (wordDist[bucket] || 0) + 1;
});
console.log(wordDist);

console.log("\n=== P0 PORTAL BREAKDOWN ===");
const portalP0: Record<string, number> = {};
data.p0.forEach((r: any) => {
  portalP0[r.portal] = (portalP0[r.portal] || 0) + 1;
});
console.log(portalP0);

console.log("\n=== P1 SAMPLE (First 5) ===");
data.p1.slice(0, 5).forEach((r: any, idx: number) => {
  console.log(`[P1 #${idx + 1}]`);
  console.log(`  ID: ${r.oppId} | Portal: ${r.portal} | Title: ${r.title} | Company: ${r.company}`);
  console.log(`  URL: ${r.sourceUrl}`);
  console.log(`  Words: ${r.wordCount} | Chars: ${r.charCount} | Resp: ${r.responsibilities} | Req: ${r.requirements}`);
  console.log(`  Text: "${r.textPreview}"`);
});

console.log("\n=== P2 SAMPLE (First 5) ===");
data.p2.slice(0, 5).forEach((r: any, idx: number) => {
  console.log(`[P2 #${idx + 1}]`);
  console.log(`  ID: ${r.oppId} | Portal: ${r.portal} | Title: ${r.title} | Company: ${r.company}`);
  console.log(`  URL: ${r.sourceUrl}`);
  console.log(`  Words: ${r.wordCount} | Chars: ${r.charCount} | Resp: ${r.responsibilities} | Req: ${r.requirements}`);
  console.log(`  Text: "${r.textPreview}"`);
});
