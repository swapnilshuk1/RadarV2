import { describe, it, expect } from "vitest";
import { CandidateProofExtractorV1 } from "../../src/lib/intelligence/extraction/CandidateProofExtractorV1";
import * as fs from "fs";
import * as path from "path";

describe("CandidateProofExtractorV1 (13 Focused Tests)", () => {
  const extractor = new CandidateProofExtractorV1();

  const resumeMPath = path.resolve(__dirname, "../../audit-reports/phase5-100-case-corpus/Swapnil_Shukla_Resume_M.md");
  const resumeV3Path = path.resolve(__dirname, "../../audit-reports/phase5-100-case-corpus/Swapnil_Shukla_Executive_Resume_v3.md");

  const resumeMText = fs.readFileSync(resumeMPath, "utf-8");
  const resumeV3Text = fs.readFileSync(resumeV3Path, "utf-8");

  // 1. Masthead isolation
  it("1. isolates masthead above ## PROFESSIONAL EXPERIENCE from work history positions", () => {
    const resM = extractor.extract({
      sourceDocumentId: "Resume_M",
      rawText: resumeMText
    });

    expect(resM.masthead).toBeDefined();
    expect(resM.masthead?.rawText).toContain("SWAPNIL SHUKLA");
    expect(resM.masthead?.rawText).toContain("swapnilshuk@gmail.com");
    expect(resM.positions.length).toBe(7);
    expect(resM.positions[0].employer).toBe("VML (WPP Group)");
  });

  // 2. Exact bullet offsets
  it("2. enforces exact bullet offsets on 100% of bullets under PROFESSIONAL EXPERIENCE", () => {
    const resM = extractor.extract({
      sourceDocumentId: "Resume_M",
      rawText: resumeMText
    });

    expect(resM.allBullets.length).toBe(21);
    for (const b of resM.allBullets) {
      const slice = resumeMText.slice(b.startOffset, b.endOffset);
      expect(slice).toBe(b.exactText);
    }

    const resV3 = extractor.extract({
      sourceDocumentId: "Resume_v3",
      rawText: resumeV3Text
    });

    expect(resV3.allBullets.length).toBe(18);
    for (const b of resV3.allBullets) {
      const slice = resumeV3Text.slice(b.startOffset, b.endOffset);
      expect(slice).toBe(b.exactText);
    }
  });

  // 3. Bullet retention invariant
  it("3. satisfies the 100% bullet retention invariant (bulletsRetained === totalProfessionalExperienceBullets)", () => {
    const resM = extractor.extract({
      sourceDocumentId: "Resume_M",
      rawText: resumeMText
    });
    expect(resM.metadata.totalProfessionalExperienceBullets).toBe(21);
    expect(resM.metadata.bulletsRetained).toBe(21);

    const resV3 = extractor.extract({
      sourceDocumentId: "Resume_v3",
      rawText: resumeV3Text
    });
    expect(resV3.metadata.totalProfessionalExperienceBullets).toBe(18);
    expect(resV3.metadata.bulletsRetained).toBe(18);
  });

  // 4. Executive profile atomization
  it("4. sentence-atomizes Executive Profile into distinct SELF_SUMMARY atoms with exact offsets", () => {
    const resV3 = extractor.extract({
      sourceDocumentId: "Resume_v3",
      rawText: resumeV3Text
    });

    expect(resV3.selfSummaries.length).toBeGreaterThanOrEqual(1);
    for (const atom of resV3.selfSummaries) {
      const slice = resumeV3Text.slice(atom.startOffset, atom.endOffset);
      expect(slice).toBe(atom.exactText);
      expect(atom.evidenceClass).toBe("SELF_SUMMARY");
    }
  });

  // 5. Exact child-claim offsets
  it("5. enforces exact child-claim offsets on 100% of accepted claims", () => {
    const resM = extractor.extract({
      sourceDocumentId: "Resume_M",
      rawText: resumeMText
    });

    expect(resM.allClaims.length).toBeGreaterThan(0);
    for (const c of resM.allClaims) {
      const slice = resumeMText.slice(c.startOffset, c.endOffset);
      expect(slice).toBe(c.exactText);
    }
  });

  // 6. Compound bullet decomposition
  it("6. decomposes compound bullets into multiple child proof claims", () => {
    const resM = extractor.extract({
      sourceDocumentId: "Resume_M",
      rawText: resumeMText
    });

    // The VML first bullet has both $8M fee book and ₹36 Cr retainer
    const vmlBullet = resM.allBullets.find(b => b.exactText.includes("pure agency fee book"));
    expect(vmlBullet).toBeDefined();
    expect(vmlBullet!.claims.length).toBeGreaterThanOrEqual(2);

    const feeClaim = vmlBullet!.claims.find(c => c.exactText.includes("$8M"));
    expect(feeClaim).toBeDefined();

    const retainerClaim = vmlBullet!.claims.find(c => c.exactText.includes("₹36 Cr"));
    expect(retainerClaim).toBeDefined();
  });

  // 7. Structured metrics parsing
  it("7. parses metrics with comparators and deltas accurately (AT_LEAST, DECREASE, MORE_THAN, EXACT)", () => {
    const resM = extractor.extract({
      sourceDocumentId: "Resume_M",
      rawText: resumeMText
    });

    // 400,000 leads: comparator MORE_THAN (from "more than 400,000")
    const leadClaim = resM.allClaims.find(c => c.exactText.includes("400,000"));
    expect(leadClaim).toBeDefined();
    const leadMetric = leadClaim?.metrics.find(m => m.metricType === "LEAD_COUNT");
    expect(leadMetric).toBeDefined();
    expect(leadMetric?.comparator).toBe("MORE_THAN");
    expect(leadMetric?.normalizedValue).toBe(400000);

    // 4,000+ dealerships: comparator AT_LEAST (from "4,000+")
    const dealerClaim = resM.allClaims.find(c => c.exactText.includes("4,000+"));
    expect(dealerClaim).toBeDefined();
    const dealerMetric = dealerClaim?.metrics.find(m => m.metricType === "LOCATION_COUNT");
    expect(dealerMetric).toBeDefined();
    expect(dealerMetric?.comparator).toBe("AT_LEAST");
    expect(dealerMetric?.normalizedValue).toBe(4000);

    // 70% reduction in CAC: changeValue -70
    const cacClaim = resM.allClaims.find(c => c.exactText.includes("70%"));
    expect(cacClaim).toBeDefined();
    const cacMetric = cacClaim?.metrics.find(m => m.metricType === "PERCENTAGE_CHANGE");
    expect(cacMetric).toBeDefined();
    expect(cacMetric?.direction).toBe("DECREASE");
    expect(cacMetric?.changeValue).toBe(-70);

    // 3% to over 32%: baselineValue 3, endValue 32
    const revTransClaim = resM.allClaims.find(c => c.exactText.includes("from 3% to over 32%"));
    expect(revTransClaim).toBeDefined();
    const revMetric = revTransClaim?.metrics.find(m => m.metricType === "PERCENTAGE_CHANGE");
    expect(revMetric).toBeDefined();
    expect(revMetric?.baselineValue).toBe(3);
    expect(revMetric?.endValue).toBe(32);
    expect(revMetric?.comparator).toBe("MORE_THAN");
  });

  // 8. BM-01 and BM-02
  it("8. recovers BM-01 ($8M Ford fee book) and BM-02 (₹36 Cr BMW retainer)", () => {
    const resM = extractor.extract({
      sourceDocumentId: "Resume_M",
      rawText: resumeMText
    });
    const allMetricsM = resM.allClaims.flatMap(c => c.metrics);

    // BM-01: $8M Ford fee book (Resume M)
    const m1 = allMetricsM.find(m => m.currency === "USD" && m.normalizedValue === 8000000);
    expect(m1).toBeDefined();
    expect(m1?.rawValue).toContain("8M");

    // BM-02: ₹36 Cr BMW retainer (Resume M)
    const m2 = allMetricsM.find(m => m.currency === "INR" && m.normalizedValue === 360000000);
    expect(m2).toBeDefined();
    expect(m2?.rawValue).toContain("36 Cr");
  });

  // 9. BM-03 and BM-04
  it("9. recovers BM-03 (40-person/member CoE) and BM-04 (13 APAC/Middle East markets)", () => {
    const resM = extractor.extract({
      sourceDocumentId: "Resume_M",
      rawText: resumeMText
    });
    const resV3 = extractor.extract({
      sourceDocumentId: "Resume_v3",
      rawText: resumeV3Text
    });

    const allMetricsM = resM.allClaims.flatMap(c => c.metrics);
    const allMetricsV3 = resV3.allClaims.flatMap(c => c.metrics);

    // BM-03: 40-member CoE (Resume M) and 40-person CoE (Resume v3)
    const m3_M = allMetricsM.find(m => m.metricType === "PEOPLE_COUNT" && m.normalizedValue === 40);
    expect(m3_M).toBeDefined();
    const m3_V3 = allMetricsV3.find(m => m.metricType === "PEOPLE_COUNT" && m.normalizedValue === 40);
    expect(m3_V3).toBeDefined();

    // BM-04: 13 APAC/Middle East markets (Resume M)
    const m4 = allMetricsM.find(m => m.metricType === "MARKET_COUNT" && m.normalizedValue === 13);
    expect(m4).toBeDefined();
  });

  // 10. BM-05 and BM-06
  it("10. recovers BM-05 ($14M attributed revenue) and BM-06 (BMW India + 22 dealers)", () => {
    const resM = extractor.extract({
      sourceDocumentId: "Resume_M",
      rawText: resumeMText
    });
    const allMetricsM = resM.allClaims.flatMap(c => c.metrics);

    // BM-05: $14M attributed revenue (Resume M)
    const m5 = allMetricsM.find(m => m.currency === "USD" && m.normalizedValue === 14000000);
    expect(m5).toBeDefined();

    // BM-06: BMW India + 22 dealers (Resume M)
    const m6 = allMetricsM.find(m => m.metricType === "LOCATION_COUNT" && m.normalizedValue === 22);
    expect(m6).toBeDefined();
  });

  // 11. BM-07 and BM-08
  it("11. recovers BM-07 (400,000+ qualified leads) and BM-08 (4,000+ dealerships / points of sale)", () => {
    const resM = extractor.extract({
      sourceDocumentId: "Resume_M",
      rawText: resumeMText
    });
    const resV3 = extractor.extract({
      sourceDocumentId: "Resume_v3",
      rawText: resumeV3Text
    });

    const allMetricsM = resM.allClaims.flatMap(c => c.metrics);
    const allMetricsV3 = resV3.allClaims.flatMap(c => c.metrics);

    // BM-07: 400,000+ qualified leads
    const m7_M = allMetricsM.find(m => m.metricType === "LEAD_COUNT" && m.normalizedValue === 400000);
    expect(m7_M).toBeDefined();
    expect(m7_M!.comparator).toBe("MORE_THAN");
    const m7_V3 = allMetricsV3.find(m => m.metricType === "LEAD_COUNT" && m.normalizedValue === 400000);
    expect(m7_V3).toBeDefined();
    expect(m7_V3!.comparator).toBe("MORE_THAN");

    // BM-08: 4,000+ dealerships / points of sale
    const m8_M = allMetricsM.find(m => m.metricType === "LOCATION_COUNT" && m.normalizedValue === 4000);
    expect(m8_M).toBeDefined();
    const m8_V3 = allMetricsV3.find(m => m.metricType === "LOCATION_COUNT" && m.normalizedValue === 4000);
    expect(m8_V3).toBeDefined();
  });

  // 12. BM-09 through BM-13
  it("12. recovers BM-09 (Ford digital 3% -> >32%), BM-10 (70% CAC reduction), BM-11 (S$1.8M), BM-12 (INR 80M), BM-13 (26% conversion)", () => {
    const resM = extractor.extract({
      sourceDocumentId: "Resume_M",
      rawText: resumeMText
    });
    const allMetricsM = resM.allClaims.flatMap(c => c.metrics);

    // BM-09: 3% -> 32% (Resume M)
    const m9 = allMetricsM.find(m => m.baselineValue === 3 && m.endValue === 32);
    expect(m9).toBeDefined();
    expect(m9!.baselineValue).toBe(3);
    expect(m9!.endValue).toBe(32);
    expect(m9!.comparator).toBe("MORE_THAN");
    expect(m9!.direction).toBe("INCREASE");
    expect(m9!.changeValue).toBe(29);

    // BM-10: 70% CAC reduction (both)
    const m10 = allMetricsM.find(m => m.changeValue === -70);
    expect(m10).toBeDefined();

    // BM-11: S$1.8M pipeline (Resume M)
    const m11 = allMetricsM.find(m => m.currency === "SGD" && m.normalizedValue === 1800000);
    expect(m11).toBeDefined();

    // BM-12: INR 80M marketing mix (Resume M)
    const m12 = allMetricsM.find(m => m.currency === "INR" && m.normalizedValue === 80000000);
    expect(m12).toBeDefined();

    // BM-13: 26% conversion increase (Resume M)
    const m13 = allMetricsM.find(m => m.changeValue === 26);
    expect(m13).toBeDefined();
  });

  // 13. Negative provenance investigations
  it("13. negative provenance investigations: C-suite chief title UNSUPPORTED, San Francisco NOT SOURCE-RESOLVED", () => {
    const resM = extractor.extract({
      sourceDocumentId: "Resume_M",
      rawText: resumeMText
    });
    const resV3 = extractor.extract({
      sourceDocumentId: "Resume_v3",
      rawText: resumeV3Text
    });

    // A. C-Suite Chief Title Investigation
    // Verify that NO candidate position title in either resume contains a Chief title (e.g. Chief Marketing Officer, CEO)
    const hasCandidateChiefTitleM = resM.positions.some(p => /\b(?:Chief\s+[A-Za-z]+\s+Officer|C[A-Z]O|CEO|CMO|CTO|COO)\b/i.test(p.title));
    const hasCandidateChiefTitleV3 = resV3.positions.some(p => /\b(?:Chief\s+[A-Za-z]+\s+Officer|C[A-Z]O|CEO|CMO|CTO|COO)\b/i.test(p.title));
    expect(hasCandidateChiefTitleM).toBe(false);
    expect(hasCandidateChiefTitleV3).toBe(false);

    // B. San Francisco Investigation
    // Verify that "San Francisco" does not appear anywhere in either designated primary resume
    const sfRegex = /\bSan\s+Francisco\b/i;
    const hasSfM = sfRegex.test(resumeMText);
    const hasSfV3 = sfRegex.test(resumeV3Text);
    expect(hasSfM).toBe(false);
    expect(hasSfV3).toBe(false);
  });
});
