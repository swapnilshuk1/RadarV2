import fs from "fs";
import path from "path";

const reportPath = path.resolve("scripts/forensic_sparse_report.json");
const data = JSON.parse(fs.readFileSync(reportPath, "utf8"));

function escapePipe(str: string): string {
  if (!str) return "";
  return String(str).replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function generateMarkdownTable(records: any[]): string {
  const header = [
    "| Opp ID | Portal | Job Title | Company | Source URL | Words | Chars | Resp | Req | Qual | Capture Timestamp | Capture Method | Scrape Run | Failure / Warning Signals | Why Suspicious |",
    "|---|---|---|---|---|---:|---:|:---:|:---:|:---:|---|---|---|---|---|"
  ].join("\n");

  const rows = records.map(r => {
    return `| \`${escapePipe(r.oppId)}\` | ${escapePipe(r.portal)} | ${escapePipe(r.title)} | ${escapePipe(r.company)} | [${escapePipe(r.sourceUrl)}](${r.sourceUrl}) | ${r.wordCount} | ${r.charCount} | ${r.responsibilities} | ${r.requirements} | ${r.qualifications} | ${escapePipe(r.captureTimestamp)} | \`${escapePipe(r.captureMethod)}\` | \`${escapePipe(r.scrapeRun)}\` | ${escapePipe(r.failureSignals)} | ${escapePipe(r.whySuspicious)} |`;
  }).join("\n");

  return `${header}\n${rows}`;
}

const p0Table = generateMarkdownTable(data.p0);
const p1Table = generateMarkdownTable(data.p1);
const p2Table = generateMarkdownTable(data.p2);

fs.writeFileSync(path.resolve("scripts/p0_table.md"), p0Table);
fs.writeFileSync(path.resolve("scripts/p1_table.md"), p1Table);
fs.writeFileSync(path.resolve("scripts/p2_table.md"), p2Table);

console.log("Markdown tables generated successfully:");
console.log(`P0 Table rows: ${data.p0.length}`);
console.log(`P1 Table rows: ${data.p1.length}`);
console.log(`P2 Table rows: ${data.p2.length}`);
