/**
 * normalizeScrapedText.test.ts
 *
 * Regression tests for the centralized HTML normalization utility.
 * These fixtures represent real HTML patterns emitted by LinkedIn, Indeed, and Naukri.
 */
import { describe, it, expect } from "vitest";
import { normalizeScrapedText } from "../../src/lib/text/normalizeScrapedText";

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
    notExpectedLines: ["\n\n"],
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
      "What you will do",
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

describe("normalizeScrapedText Unit Tests", () => {
  for (const tc of cases) {
    it(tc.name, () => {
      const actual = normalizeScrapedText(tc.html);
      for (const expected of tc.expectedLines) {
        expect(actual).toContain(expected);
      }
      if (tc.notExpectedLines) {
        for (const notExp of tc.notExpectedLines) {
          if (notExp !== "") {
            expect(actual).not.toContain(notExp);
          }
        }
      }
    });
  }
});
