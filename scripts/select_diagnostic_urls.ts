import fs from "fs";
import path from "path";

const reportPath = path.resolve("scripts/forensic_sparse_report.json");
const data = JSON.parse(fs.readFileSync(reportPath, "utf8"));

console.log("=== SELECTING 10 DIVERSE DIAGNOSTIC CASES ===");

// We want:
// 1. Indeed Search Card Snippet Fallback (5 words)
// 2. Indeed Truncated /clk URL (8 words)
// 3. Indeed viewjob URL (12 words)
// 4. Naukri "Job Highlights" Only Capture (10 words)
// 5. Naukri Truncated Body (28 words)
// 6. Naukri Partial Section / TopTier SPA (45 words)
// 7. Naukri P1 High-Seniority VP/Director (65 words)
// 8. LinkedIn Authwall / Truncated TopCard (P0/P1)
// 9. Indeed P1 Mid-length missing JD body (85 words)
// 10. Naukri P1 Incomplete Requirements (95 words)

const selected: any[] = [];

// 1. Indeed snippet 5 words
const indSnippet = data.p0.find((r: any) => r.portal === "Indeed" && r.wordCount === 5 && r.sourceUrl.includes("indeed.com"));
if (indSnippet) selected.push({ tag: "Indeed Search Card Snippet Leak (<10 words)", ...indSnippet });

// 2. Indeed viewjob
const indViewJob = data.p0.find((r: any) => r.portal === "Indeed" && r.sourceUrl.includes("viewjob") && r.wordCount <= 25);
if (indViewJob) selected.push({ tag: "Indeed viewjob Unhydrated DOM (<25 words)", ...indViewJob });

// 3. Indeed other
const indOther = data.p0.find((r: any) => r.portal === "Indeed" && r.wordCount > 15 && r.wordCount < 40 && !selected.includes(r));
if (indOther) selected.push({ tag: "Indeed Truncated Content (15-40 words)", ...indOther });

// 4. Naukri Highlights Only (<15 words)
const nkHighlights = data.p0.find((r: any) => r.portal === "Naukri" && r.wordCount < 20);
if (nkHighlights) selected.push({ tag: "Naukri 'Job Highlights' Snippet-Only (<20 words)", ...nkHighlights });

// 5. Naukri Truncated (20-35 words)
const nkTrunc = data.p0.find((r: any) => r.portal === "Naukri" && r.wordCount >= 20 && r.wordCount < 40);
if (nkTrunc) selected.push({ tag: "Naukri Truncated JD Body (20-40 words)", ...nkTrunc });

// 6. Naukri Near P0/P1 boundary (40-50 words)
const nkBoundary = data.p0.find((r: any) => r.portal === "Naukri" && r.wordCount >= 40 && r.wordCount < 50);
if (nkBoundary) selected.push({ tag: "Naukri Partial Section Leak (40-50 words)", ...nkBoundary });

// 7. LinkedIn P0/P1
const liP0 = data.p0.find((r: any) => r.portal === "LinkedIn") || data.p1.find((r: any) => r.portal === "LinkedIn");
if (liP0) selected.push({ tag: "LinkedIn Guest/Authwall Truncation", ...liP0 });

// 8. LinkedIn P1
const liP1 = data.p1.find((r: any) => r.portal === "LinkedIn" && r.jobHash !== liP0?.jobHash);
if (liP1) selected.push({ tag: "LinkedIn Truncated TopCard / Collapsed JD", ...liP1 });

// 9. Naukri P1 High-Seniority Mandate (50-80 words)
const nkP1 = data.p1.find((r: any) => r.portal === "Naukri" && r.wordCount >= 50 && r.wordCount <= 75);
if (nkP1) selected.push({ tag: "Naukri P1 Truncated Requirements (50-75 words)", ...nkP1 });

// 10. Indeed P1
const indP1 = data.p1.find((r: any) => r.portal === "Indeed" && r.wordCount >= 60);
if (indP1) selected.push({ tag: "Indeed P1 Partial JD Capture (60-120 words)", ...indP1 });

console.log(`Selected ${selected.length} diagnostic URLs:`);
selected.forEach((s, i) => {
  console.log(`\n${i + 1}. [${s.tag}]`);
  console.log(`   Job: "${s.title}" at ${s.company} (${s.portal})`);
  console.log(`   Captured: ${s.wordCount} words (${s.charCount} chars)`);
  console.log(`   URL: ${s.sourceUrl}`);
  console.log(`   Why: ${s.whySuspicious}`);
  console.log(`   Text Snippet: "${s.textPreview}"`);
});
