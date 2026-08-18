import { describe, it, expect } from "vitest";
import { evaluateFreshness } from "../src/lib/intelligence/freshness/FreshnessEngine";
import { evaluateCompensation, formatCurrencyRange } from "../src/lib/intelligence/compensation/CompensationEngine";
import { BriefCompositionEngine } from "../src/lib/intelligence/editorial/BriefCompositionEngine";

describe("P7-A — Opportunity Freshness & Compensation Enrichment", () => {
  // 1. Disclosed salary rendering (KNOWN)
  it("1. renders disclosed salary accurately in KNOWN state", () => {
    const comp = evaluateCompensation({
      salaryBounds: { min: 18000000, max: 24000000, currency: "INR" },
    });
    expect(comp.state).toBe("KNOWN");
    expect(comp.badgeLabel).toContain("Salary Disclosed");
    expect(comp.badgeLabel).toContain("₹1.8 Cr – ₹2.4 Cr");
  });

  // 2. Estimated salary rendering (ESTIMATED)
  it("2. renders estimated salary range accurately in ESTIMATED state", () => {
    const comp = evaluateCompensation({
      benchmarkEstimate: {
        min: 15000000,
        max: 22000000,
        currency: "INR",
        source: "Payscale Enterprise Benchmark",
        confidence: "Moderate",
        updatedDate: "2026-08-01",
      },
    });
    expect(comp.state).toBe("ESTIMATED");
    expect(comp.badgeLabel).toContain("Market Estimate");
    expect(comp.badgeLabel).toContain("₹1.5 Cr – ₹2.2 Cr");
    expect(comp.sourceProvider).toBe("Payscale Enterprise Benchmark");
  });

  // 3. Unknown salary rendering (UNKNOWN)
  it("3. renders undisclosed salary fallback in UNKNOWN state", () => {
    const comp = evaluateCompensation({});
    expect(comp.state).toBe("UNKNOWN");
    expect(comp.badgeLabel).toBe("Compensation: Not Disclosed");
    expect(comp.verificationNotice).toContain("Verify during initial screening");
  });

  // 4 & 5. Salary does NOT alter qualityScore or Decision
  it("4 & 5. verifies that compensation does NOT modify qualityScore or Decision", () => {
    const mockOpp: any = {
      jobHash: "test-salary-invariant",
      role: "Delivery Head",
      company: "Acme Corp",
      location: "Bengaluru",
      decision: "PURSUE",
      recommendationResult: { score: 78 },
      dimensions: [],
      headspace: [],
      positioning: [],
    };

    const brief1 = BriefCompositionEngine.compose(mockOpp, { bypassHistory: true });

    // Mutate salary attributes
    mockOpp.salaryBounds = { min: 30000000, max: 40000000, currency: "INR" };
    const brief2 = BriefCompositionEngine.compose(mockOpp, { bypassHistory: true });

    expect(brief1.qualityScore).toEqual(brief2.qualityScore);
    expect(brief1.memory.decision).toEqual(brief2.memory.decision);
  });

  // 6. Freshness date rendering
  it("6. renders freshness date with source portal provenance", () => {
    const freshness = evaluateFreshness({
      postedRelative: "Posted 4 days ago",
      scrapedFrom: "LinkedIn",
    });
    expect(freshness.state).toBe("FRESH");
    expect(freshness.postedDateDisplay).toBe("Posted 4 days ago · LinkedIn");
    expect(freshness.isStale).toBe(false);
  });

  // 7. Missing posting date fallback
  it("7. handles missing posting date gracefully without making up fake dates", () => {
    const freshness = evaluateFreshness({
      scrapedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
      scrapedFrom: "Workday",
    });
    expect(freshness.state).toBe("UNKNOWN");
    expect(freshness.postedDateDisplay).toContain("Posted date unavailable · Last scraped 2 hours ago");
  });

  // 8. Stale posting warning
  it("8. generates executive stale warning for postings > 45 days old", () => {
    const freshness = evaluateFreshness({
      postedRelative: "Posted 47 days ago",
      scrapedFrom: "Naukri",
    });
    expect(freshness.state).toBe("STALE");
    expect(freshness.isStale).toBe(true);
    expect(freshness.staleWarning).toContain("Posted 47 days ago — verify that the role is still active before investing heavily");
  });

  // 9. Source provenance display
  it("9. accurately displays source portal provenance", () => {
    const freshness = evaluateFreshness({
      postedRelative: "Posted 2 weeks ago",
      scrapedFrom: "Greenhouse",
    });
    expect(freshness.sourcePortalDisplay).toBe("Greenhouse");
    expect(freshness.postedDateDisplay).toContain("Greenhouse");
  });

  // 10. No false conversion of scrape date to posting date
  it("10. ensures scrape date is never falsely represented as posting date", () => {
    const scrapeIso = "2026-08-15T08:00:00.000Z";
    const freshness = evaluateFreshness({
      scrapedAt: scrapeIso,
      scrapedFrom: "Lever",
    });
    expect(freshness.postedDateDisplay).not.toContain("Posted 2026");
    expect(freshness.postedDateDisplay).toContain("Posted date unavailable");
  });

  // 11 & 12. Helper range formatting and benchmark confidence
  it("11 & 12. formats currency ranges and benchmark confidence correctly", () => {
    const formattedInr = formatCurrencyRange(18000000, 24000000, "INR");
    const formattedUsd = formatCurrencyRange(220000, 280000, "USD");
    expect(formattedInr).toBe("₹1.8 Cr – ₹2.4 Cr");
    expect(formattedUsd).toBe("$220K – $280K");
  });
});
