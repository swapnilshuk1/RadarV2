/**
 * normalizeScrapedText.test.ts
 *
 * Regression tests for the centralized HTML normalization utility.
 * These fixtures represent real HTML patterns emitted by LinkedIn, Indeed, and Naukri.
 */
import { normalizeScrapedText } from "../src/lib/text/normalizeScrapedText";

interface TestCase {
  name: string;
  html: string;
  expectedLines: string[]; // Each line that must appear in output
  notExpectedLines?: string[]; // Lines that must NOT appear in output
}

const cases: TestCase[] = [
  {
    name: "UL/LI list items are separated by newlines",
    html: "<ul><li>Experience with AWS</li><li>Experience with Azure</li><li>Own P&L</li></ul>",
    expectedLines: ["• Experience with AWS", "• Experience with Azure", "• Own P&L"],
    notExpectedLines: ["Experience with AWSExperience with Azure"],
  },
  {
    name: "BR tags create newlines for responsibilities",
    html: "Responsibilities<br>Lead marketing<br>Own CRM<br>Drive growth",
    expectedLines: ["Responsibilities", "Lead marketing", "Own CRM", "Drive growth"],
  },
  {
    name: "Unicode bullets are normalized to newlines",
    html: "Requirements\n• AWS\n• Azure\n• SAP",
    expectedLines: ["Requirements", "• AWS", "• Azure", "• SAP"],
  },
  {
    name: "Numbered list items are separated by newlines",
    html: "1. Drive strategy\n2. Own roadmap\n3. Lead transformation",
    expectedLines: ["1. Drive strategy", "2. Own roadmap", "3. Lead transformation"],
  },
  {
    name: "Nested lists preserve parent and child items",
    html: "<ul><li>Lead team<ul><li>Manage AWS</li><li>Manage GCP</li></ul></li></ul>",
    expectedLines: ["• Lead team", "• Manage AWS", "• Manage GCP"],
  },
  {
    name: "Paragraph tags create newlines",
    html: "<p>We are a fast growing company.</p><p>You will own P&L of $50M.</p>",
    expectedLines: ["We are a fast growing company.", "You will own P&L of $50M."],
  },
  {
    name: "DIV boundaries create newlines",
    html: "<div>Report to CEO</div><div>Drive transformation</div>",
    expectedLines: ["Report to CEO", "Drive transformation"],
  },
  {
    name: "HTML entities are decoded",
    html: "Revenue &gt; $100M &amp; P&amp;L experience required",
    expectedLines: ["Revenue > $100M & P&L experience required"],
  },
  {
    name: "Consecutive whitespace within a line is collapsed",
    html: "<li>Experience    with    Salesforce   CRM</li>",
    expectedLines: ["• Experience with Salesforce CRM"],
  },
  {
    name: "Empty lines are removed from output",
    html: "<p>Lead growth</p><p></p><p>Own CRM</p>",
    expectedLines: ["Lead growth", "Own CRM"],
    notExpectedLines: [""],
  },
  {
    name: "Table cells are separated correctly",
    html: "<tr><td>Salesforce</td><td>CRM</td></tr><tr><td>SAP</td><td>ERP</td></tr>",
    expectedLines: ["Salesforce | CRM", "SAP | ERP"],
  },
  {
    name: "Mixed HTML preserves structure across portals",
    html: `<div class="description">
      <h2>What you will do</h2>
      <ul>
        <li>Own P&amp;L of $200M</li>
        <li>Report directly to CEO</li>
        <li>Drive digital transformation</li>
      </ul>
      <p>Required: SAP, Salesforce, PowerBI</p>
    </div>`,
    expectedLines: [
      "• Own P&L of $200M",
      "• Report directly to CEO",
      "• Drive digital transformation",
      "Required: SAP, Salesforce, PowerBI",
    ],
  },
  {
    name: "Empty input returns empty string",
    html: "",
    expectedLines: [],
  },
];

let passed = 0;
let failed = 0;

console.log("\n==========================================================================");
console.log("                    NORMALIZE SCRAPED TEXT — UNIT TESTS");
console.log("==========================================================================");

for (const tc of cases) {
  const result = normalizeScrapedText(tc.html);
  const resultLines = result.split("\n");

  let ok = true;
  const failReasons: string[] = [];

  for (const expected of tc.expectedLines) {
    if (!resultLines.some(l => l.includes(expected))) {
      ok = false;
      failReasons.push(`Missing expected line: "${expected}"`);
    }
  }

  for (const notExpected of tc.notExpectedLines ?? []) {
    if (notExpected !== "" && resultLines.some(l => l.includes(notExpected))) {
      ok = false;
      failReasons.push(`Unexpected line found: "${notExpected}"`);
    }
  }

  if (ok) {
    passed++;
    console.log(`  ✓ ${tc.name}`);
  } else {
    failed++;
    console.log(`  ✗ ${tc.name}`);
    for (const r of failReasons) console.log(`      → ${r}`);
    console.log(`      Actual output:\n${result.split("\n").map(l => `        "${l}"`).join("\n")}`);
  }
}

console.log(`\n----------------------------------------------------------`);
console.log(`  Tests Passed: ${passed}/${cases.length}`);
console.log(`  Tests Failed: ${failed}/${cases.length}`);
if (failed === 0) {
  console.log(`  ✅ All normalizeScrapedText tests PASSED`);
} else {
  console.log(`  ❌ ${failed} test(s) FAILED`);
  process.exit(1);
}
console.log("==========================================================================\n");
