import { describe, expect, it } from "vitest";
import { resumeToDocx } from "../../src/pursuit/export/docx";
import { resumeToPdf } from "../../src/pursuit/export/resume-layout";
import { resumeMetrics } from "../../src/pursuit/resume-metrics";
import type { ResumeContent } from "../../src/pursuit/types";

const resume = (): ResumeContent => ({
  fullName: "Swapnil Shukla",
  contactLine: "swapnil@example.com · Gurgaon",
  headline: "Commercial Leadership | Transformation",
  executiveSummary:
    "Executive leader whose experience spans commercial leadership and transformation. Core strengths include growth, operating model design, client leadership and digital transformation. Selected career evidence follows.",
  impactAnchors: [
    { claimId: "a", text: "Grew fee book from $8M to $12M across strategic accounts.", edited: false, provenance: "SOURCE_BACKED" },
    { claimId: "b", text: "Led a 40-member transformation centre across 13 markets.", edited: false, provenance: "SOURCE_BACKED" },
    { claimId: "c", text: "Expanded digital contribution from 3% to 32% of sales.", edited: false, provenance: "SOURCE_BACKED" },
  ],
  roles: [{
    employer: "Northwind",
    roleTitle: "Vice President",
    period: "2020–2024",
    bullets: [
      { claimId: "d", text: "Built and led a regional operating model spanning 13 markets.", edited: false, provenance: "SOURCE_BACKED" },
    ],
  }],
  capabilities: ["Commercial Growth", "Transformation", "Client Leadership"],
  metricHighlights: [
    { value: "$12M", caption: "fee book after growth", claimId: "a" },
    { value: "40", caption: "member transformation centre", claimId: "b" },
    { value: "13", caption: "markets covered", claimId: "b" },
    { value: "32%", caption: "digital contribution to sales", claimId: "c" },
  ],
});

describe("résumé export presentation", () => {
  it("uses the executive template and source-backed metric grid in PDF", () => {
    const text = new TextDecoder().decode(
      resumeToPdf(resume(), { template: "EXECUTIVE_BRIEF", metricGrid: true }),
    );
    expect(text).toContain("ABOUT ME");
    expect(text).toContain("BY THE NUMBERS");
    expect(text).toContain("$12M");
    expect(text).toContain("PROFESSIONAL EXPERIENCE");
  });

  it("uses editorial labels and can suppress metrics in PDF", () => {
    const text = new TextDecoder().decode(
      resumeToPdf(resume(), { template: "EDITORIAL", metricGrid: false }),
    );
    expect(text).toContain("PROFILE");
    expect(text).toContain("SELECTED IMPACT");
    expect(text).not.toContain("SELECTED NUMBERS");
  });

  it("carries template structure and metric table into editable Word", () => {
    const text = new TextDecoder().decode(
      resumeToDocx(resume(), { template: "EXECUTIVE_BRIEF", metricGrid: true }),
    );
    expect(text).toContain("1F365E");
    expect(text).toContain("C2541C");
    expect(text).toContain("By the numbers");
    expect(text).toContain("<w:tbl>");
    expect(text).toContain("word/header1.xml");
  });

  it("uses persisted highlights before re-extracting metrics", () => {
    expect(resumeMetrics(resume()).map((metric) => metric.value)).toEqual([
      "$12M", "40", "13", "32%",
    ]);
  });
});
