import fs from "node:fs";
import path from "node:path";

const reportPath = path.resolve(process.cwd(), "scripts/forensic_sparse_report.json");
const data = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
const all = [...data.p0, ...data.p1, ...data.p2];

const targetJobHashes = [
  "j-a8b9e9a27827", // Digital Advisory Director (Accordion)
  "j-c26379a3bc09", // 1185 chars
  "j-dca748b4c4c8", // 1352 chars
  "j-d697b001e558", // 398 chars
  "j-fec954ac04ca", // 461 chars
  "j-9bb9e2f454e0", // 394 chars
];

console.log("=== INSPECTING 6 TARGET HISTORICAL RECORDS ===");
for (const hash of targetJobHashes) {
  const item = all.find((x) => x.jobHash === hash || x.oppId === hash);
  if (!item) {
    console.log(`\nNot found: ${hash}`);
    continue;
  }
  console.log(`\n------------------------------------------------------------`);
  console.log(`Job Hash:       ${item.jobHash}`);
  console.log(`Opp ID:         ${item.oppId}`);
  console.log(`Doc ID:         ${item.docId}`);
  console.log(`Title:          ${item.title}`);
  console.log(`Company:        ${item.company}`);
  console.log(`Portal:         ${item.portal}`);
  console.log(`Source URL:     ${item.sourceUrl}`);
  console.log(`Priority:       ${item.priority}`);
  console.log(`Classification: ${item.classification}`);
  console.log(`Word Count:     ${item.wordCount}`);
  console.log(`Char Count:     ${item.charCount}`);
  console.log(`Why Suspicious: ${item.whySuspicious}`);
  console.log(`FailureSignals: ${item.failureSignals}`);
  console.log(`CaptureMethod:  ${item.captureMethod}`);
  console.log(`CaptureTime:    ${item.captureTimestamp}`);
  console.log(`Responsibilities: ${item.responsibilities}, Reqs: ${item.requirements}, Quals: ${item.qualifications}`);
  console.log(`Text Preview:`);
  console.log(item.textPreview);
  if (item.rawText) {
    console.log(`Full Raw Text (length ${item.rawText.length}):`);
    console.log(item.rawText.slice(0, 500) + (item.rawText.length > 500 ? "..." : ""));
  }
}
