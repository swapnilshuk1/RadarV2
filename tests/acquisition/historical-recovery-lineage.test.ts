/**
 * tests/acquisition/historical-recovery-lineage.test.ts
 *
 * RADAR V4 — Gate 1 Historical Recovery Lineage & Integrity Certification Suite.
 *
 * Covers:
 * 1. v1 Immutability
 * 2. v1 -> v2 Lineage Preservation
 * 3. Dry-Run Zero-Write Guarantee
 * 4. External ATS Redirect Provenance (Indeed /rc/clk)
 * 5. Genuine Sparsity vs Snippet Truncation Isolation
 * 6. Failed Acquisition Isolation (No decision for failures)
 * 7. Expired Job Isolation (No decision for expired)
 * 8. Distortion Metric Denominator Rule
 * 9. Distortion Transition Matrix & Severity Mapping
 * 10. Idempotent Processing & Resume
 */

import { describe, it, expect } from "vitest";
import {
  HistoricalRecoveryEngine,
  type V1Baseline,
  type ReacquisitionResult,
  type RecoveryLedgerEntry,
} from "../../src/lib/acquisition/HistoricalRecoveryEngine";

describe("RADAR V4 — Historical Recovery & Lineage Integrity Suite", () => {
  const engine = new HistoricalRecoveryEngine();

  const mockP0IndeedItem = {
    oppId: "o_5c80049f",
    docId: "doc_b043bb5d",
    jobHash: "j-a8b9e9a27827",
    portal: "Indeed",
    title: "Digital Advisory Director",
    company: "Accordion",
    location: "India",
    sourceUrl: "https://in.indeed.com/rc/clk?jk=cdfc18533516735f",
    wordCount: 3,
    charCount: 39,
    priority: "P0",
    textPreview: "Digital Advisory DirectorAccordionIndia",
    historicalDecision: "CONSIDER",
    historicalScore: 68,
  };

  const mockP1NaukriItem = {
    oppId: "o_71bc1162",
    docId: "doc_c891129f",
    jobHash: "j-71bc11620001",
    portal: "Naukri",
    title: "Head of Marketing",
    company: "Leading Global Consulting and BPM Firm",
    location: "Udaipur · India",
    sourceUrl: "https://www.naukri.com/job-listings-head-of-marketing-workoid-100826005217",
    wordCount: 50,
    charCount: 398,
    priority: "P1",
    textPreview: "Head of Marketing Leading Global Consulting and BPM Firm Udaipur 10 to 20 years",
    historicalDecision: "PASS",
    historicalScore: 52,
  };

  // ── 1. v1 Immutability ──────────────────────────────────────────
  it("1. Resolves and preserves immutable v1 baseline without mutating original raw properties", () => {
    const v1 = engine.resolveV1Baseline(mockP0IndeedItem);

    expect(v1.canonicalJobId).toBe("j-a8b9e9a27827");
    expect(v1.opportunityVersionId).toBe("ov_j-a8b9e9a27827_v1");
    expect(v1.canonicalUrl).toBe("https://in.indeed.com/rc/clk?jk=cdfc18533516735f");
    expect(v1.source).toBe("Indeed");
    expect(v1.rawWordCount).toBe(3);
    expect(v1.rawCharCount).toBe(39);
    expect(v1.acquisitionStatus).toBe("RECOVERY_PENDING");
    expect(v1.acquisitionQuality).toBe("MINIMAL");
    expect(v1.decision).toBe("CONSIDER");
    expect(v1.qualityScore).toBe(68);

    // Freeze v1 and verify immutability
    const snapshot = JSON.stringify(v1);
    const reacquisition: ReacquisitionResult = {
      outcome: "RECOVERED_RICH",
      lifecycleState: "ACTIVE",
      evidenceState: "SUFFICIENT",
      extractedText: "Digital Advisory Director at Accordion leading $10M enterprise transformations across APAC.",
      extractedWordCount: 150,
      extractedCharCount: 850,
      containerFound: true,
    };

    const v2 = engine.createV2Record(v1, reacquisition);
    expect(v2.opportunityVersionId).toBe("ov_j-a8b9e9a27827_v2");
    expect(JSON.stringify(v1)).toBe(snapshot); // v1 untouched
  });

  // ── 2. v1 -> v2 Lineage Preservation ────────────────────────────
  it("2. Explicitly binds v2 to v1 via parentVersionId and preserves canonicalJobId", () => {
    const v1 = engine.resolveV1Baseline(mockP1NaukriItem);
    const reacquisition: ReacquisitionResult = {
      outcome: "RECOVERED_RICH",
      lifecycleState: "ACTIVE",
      evidenceState: "SUFFICIENT",
      extractedText: "Head of Marketing at Leading Global Consulting. P&L ownership of ₹12 Cr marketing budget.",
      extractedWordCount: 300,
      extractedCharCount: 1800,
      containerFound: true,
    };

    const v2 = engine.createV2Record(v1, reacquisition);

    expect(v2.parentVersionId).toBe("ov_j-71bc11620001_v1");
    expect(v2.opportunityVersionId).toBe("ov_j-71bc11620001_v2");
    expect(v2.canonicalJobId).toBe(v1.canonicalJobId);
    expect(v2.acquisitionStatus).toBe("ACQUIRED");
    expect(v2.acquisitionQuality).toBe("COMPLETE");
    expect(v2.evidenceState).toBe("SUFFICIENT");
    expect(v2.lifecycleState).toBe("ACTIVE");
  });

  // ── 3. Dry-Run Zero-Write Guarantee ──────────────────────────────
  it("3. Guarantees 0 writes and does not generate persisted v2 during dry-run", async () => {
    const result = await engine.processItem(mockP0IndeedItem, {
      isDryRun: true,
      simulateFetch: async () => ({
        status: 200,
        text: "Digital Advisory Director at Accordion India. Executive leadership role leading digital transformation, enterprise cloud strategy, and commercial delivery across APAC and global clients. Requires 15+ years of proven executive experience owning $20M+ P&L, direct board and C-suite client engagement, organizational redesign, and scaling high-performance commercial and technical delivery teams across distributed global markets.",
        html: "<div id='jobDescriptionText'>Digital Advisory Director Accordion India Full Description</div>",
        hops: ["https://accordion.wd1.myworkdayjobs.com/job/123"],
      }),
    });

    expect(result.isDryRun).toBe(true);
    expect(result.writesPerformed).toBe(0);
    expect(result.v2).toBeUndefined(); // In dry-run, v2 is not persisted
    expect(result.evaluation).toBeDefined();
    expect(["CONSIDER_TO_PURSUE", "CONSIDER_TO_PASS", "SAME_VERDICT", "SPARSE_TO_PURSUE"]).toContain(result.evaluation?.decisionShiftCategory);
    expect(result.evaluation?.isComparable).toBe(true);
  });

  // ── 4. External ATS Redirect Provenance ──────────────────────────
  it("4. Accurately tracks all redirect hops, destination host, and HTTP status for Indeed /rc/clk", async () => {
    const indeedClkUrl = "https://in.indeed.com/rc/clk?jk=cdfc18533516735f";
    const workdayDestUrl = "https://accordion.wd1.myworkdayjobs.com/Accordion_Careers/job/Digital-Advisory-Director";

    const reacquisition = await engine.reacquire(indeedClkUrl, "Indeed", {
      simulateFetch: async (url) => ({
        status: 200,
        text: "Detailed Workday Job Description with responsibilities and requirements.",
        html: "<div data-automation-id='jobPostingDescription'>...</div>",
        hops: [
          "https://in.indeed.com/rc/clk?jk=cdfc18533516735f",
          "https://in.indeed.com/viewjob?jk=cdfc18533516735f",
          workdayDestUrl,
        ],
      }),
    });

    expect(reacquisition.atsProvenance).toBeDefined();
    expect(reacquisition.atsProvenance?.originalUrl).toBe(indeedClkUrl);
    expect(reacquisition.atsProvenance?.finalDestinationUrl).toBe(workdayDestUrl);
    expect(reacquisition.atsProvenance?.destinationHost).toBe("accordion.wd1.myworkdayjobs.com");
    expect(reacquisition.atsProvenance?.redirectHops.length).toBe(4);
    expect(reacquisition.atsProvenance?.httpStatus).toBe(200);
  });

  // ── 5. Genuine Sparsity vs Snippet Truncation ────────────────────
  it("5. Classifies clean short text as VERIFIED_GENUINELY_SPARSE, but unhydrated snippet as RECOVERY_FAILED", async () => {
    // Case A: Verified clean minimal posting (active, container found, short complete text)
    const genuineSparseRes = await engine.reacquire("https://example.com/sparse-job", "Indeed", {
      simulateFetch: async () => ({
        status: 200,
        text: "Independent Board Advisor. Advisory role for Series B fintech startup. 2 hours per month.",
        html: "<div id='jobDescriptionText'>Independent Board Advisor. Advisory role for Series B fintech startup. 2 hours per month.</div>",
      }),
    });

    expect(genuineSparseRes.outcome).toBe("VERIFIED_GENUINELY_SPARSE");
    expect(genuineSparseRes.evidenceState).toBe("GENUINELY_SPARSE");

    // Case B: Truncated snippet without container / failed extraction
    const truncatedSnippetRes = await engine.reacquire("https://example.com/truncated", "Indeed", {
      simulateFetch: async () => ({
        status: 200,
        text: "Director of Engineering",
        html: "<div>Just a title</div>",
      }),
    });

    expect(truncatedSnippetRes.outcome).toBe("RECOVERY_FAILED");
    expect(truncatedSnippetRes.failureReason).toBe("UNVERIFIED_TRUNCATION_SNIPPET");
  });

  // ── 6. Failed Acquisition Isolation ──────────────────────────────
  it("6. Strictly produces decision = null and ACQUISITION_FAILED when source returns 404 or bot block", () => {
    const v1 = engine.resolveV1Baseline(mockP0IndeedItem);
    const failedReacq: ReacquisitionResult = {
      outcome: "RECOVERY_FAILED",
      failureReason: "HTTP_404_NOT_FOUND",
      lifecycleState: "REMOVED_404",
      evidenceState: "UNVERIFIED",
    };

    const v2 = engine.createV2Record(v1, failedReacq);
    const evalResult = engine.evaluateV2(v1, v2, failedReacq);

    expect(evalResult.decision).toBeNull();
    expect(evalResult.qualityScore).toBeNull();
    expect(evalResult.evaluationState).toBe("ACQUISITION_FAILED");
  });

  // ── 7. Expired Job Isolation ─────────────────────────────────────
  it("7. Strictly produces decision = null and EXPIRED when job has expired banner", () => {
    const v1 = engine.resolveV1Baseline(mockP1NaukriItem);
    const expiredReacq: ReacquisitionResult = {
      outcome: "RECOVERY_FAILED",
      failureReason: "JOB_EXPIRED_BANNER",
      lifecycleState: "EXPIRED",
      evidenceState: "UNVERIFIED",
      extractedText: "This job has expired and is no longer accepting applications.",
    };

    const v2 = engine.createV2Record(v1, expiredReacq);
    const evalResult = engine.evaluateV2(v1, v2, expiredReacq);

    expect(evalResult.decision).toBeNull();
    expect(evalResult.qualityScore).toBeNull();
    expect(evalResult.evaluationState).toBe("EXPIRED");
  });

  // ── 8. Distortion Metric Denominator Rule ────────────────────────
  it("8. Excludes recovery failures and genuinely sparse records from the distortion denominator", () => {
    const mockEntries: RecoveryLedgerEntry[] = [
      // 1. Recovered rich with decision change (PASS -> PURSUE) -> Comparable & Changed
      {
        id: "1",
        canonicalJobId: "j-1",
        v1: { ...engine.resolveV1Baseline(mockP1NaukriItem), decision: "PASS", qualityScore: 50 },
        reacquisition: { outcome: "RECOVERED_RICH", lifecycleState: "ACTIVE", evidenceState: "SUFFICIENT" },
        evaluation: {
          beforeEvaluationIdentity: "ctx_1",
          afterEvaluationIdentity: "ctx_2",
          beforeDecision: "PASS",
          afterDecision: "PURSUE",
          beforeScore: 50,
          afterScore: 90,
          beforeEvaluationState: "EVALUATED",
          afterEvaluationState: "EVALUATED",
          isComparable: true,
          decisionShiftCategory: "PASS_TO_PURSUE",
          shiftSeverity: "CRITICAL",
        },
        isDryRun: false,
        writesPerformed: 2,
        timestamp: new Date().toISOString(),
      },
      // 2. Recovered rich with same decision (PURSUE -> PURSUE) -> Comparable & Unchanged
      {
        id: "2",
        canonicalJobId: "j-2",
        v1: { ...engine.resolveV1Baseline(mockP0IndeedItem), decision: "PURSUE", qualityScore: 88 },
        reacquisition: { outcome: "RECOVERED_RICH", lifecycleState: "ACTIVE", evidenceState: "SUFFICIENT" },
        evaluation: {
          beforeEvaluationIdentity: "ctx_1",
          afterEvaluationIdentity: "ctx_2",
          beforeDecision: "PURSUE",
          afterDecision: "PURSUE",
          beforeScore: 88,
          afterScore: 88,
          beforeEvaluationState: "EVALUATED",
          afterEvaluationState: "EVALUATED",
          isComparable: true,
          decisionShiftCategory: "SAME_VERDICT",
          shiftSeverity: "STABLE",
        },
        isDryRun: false,
        writesPerformed: 2,
        timestamp: new Date().toISOString(),
      },
      // 3. Verified Genuinely Sparse (decision: null) -> NOT Comparable, Excluded from denominator
      {
        id: "3",
        canonicalJobId: "j-3",
        v1: engine.resolveV1Baseline(mockP0IndeedItem),
        reacquisition: { outcome: "VERIFIED_GENUINELY_SPARSE", lifecycleState: "ACTIVE", evidenceState: "GENUINELY_SPARSE" },
        evaluation: {
          beforeEvaluationIdentity: "ctx_1",
          afterEvaluationIdentity: "ctx_2",
          beforeDecision: null,
          afterDecision: null,
          beforeScore: null,
          afterScore: null,
          beforeEvaluationState: "SPARSE_SPEC",
          afterEvaluationState: "SPARSE_SPEC",
          isComparable: false,
          decisionShiftCategory: "SPARSE_TO_SPARSE",
          shiftSeverity: "STABLE",
        },
        isDryRun: false,
        writesPerformed: 2,
        timestamp: new Date().toISOString(),
      },
      // 4. Recovery Failed (404 removed) -> NOT Comparable, Excluded from denominator
      {
        id: "4",
        canonicalJobId: "j-4",
        v1: engine.resolveV1Baseline(mockP0IndeedItem),
        reacquisition: { outcome: "RECOVERY_FAILED", lifecycleState: "REMOVED_404", evidenceState: "UNVERIFIED" },
        evaluation: {
          beforeEvaluationIdentity: "ctx_1",
          afterEvaluationIdentity: "ctx_2",
          beforeDecision: null,
          afterDecision: null,
          beforeScore: null,
          afterScore: null,
          beforeEvaluationState: "ACQUISITION_PENDING",
          afterEvaluationState: "ACQUISITION_FAILED",
          isComparable: false,
          decisionShiftCategory: "RECOVERY_FAILED",
          shiftSeverity: "NONE",
        },
        isDryRun: false,
        writesPerformed: 0,
        timestamp: new Date().toISOString(),
      },
    ];

    const report = engine.calculateDistortionReport(mockEntries);

    expect(report.totalCandidates).toBe(4);
    expect(report.recoveredCount).toBe(2);
    expect(report.genuinelySparseCount).toBe(1);
    expect(report.recoveryFailedCount).toBe(1);

    // Comparable evaluated count should be exactly 2 (entry 1 and entry 2)
    expect(report.comparableEvaluatedCount).toBe(2);
    // Changed count is 1 (entry 1: PASS -> PURSUE)
    expect(report.changedComparableDecisionCount).toBe(1);
    // Distortion rate = 1 / 2 = 50.0%
    expect(report.decisionDistortionRate).toBe(0.5);
  });

  // ── 9. Decision Transition Matrix Mapping ────────────────────────
  it("9. Correctly categorizes all authoritative transition types and severity ratings", () => {
    const v1 = engine.resolveV1Baseline(mockP0IndeedItem);
    const richReacq: ReacquisitionResult = {
      outcome: "RECOVERED_RICH",
      lifecycleState: "ACTIVE",
      evidenceState: "SUFFICIENT",
    };

    // SPARSE -> PURSUE: Critical
    const diff1 = engine.calculateEvaluationDiff(
      { ...v1, decision: null, evaluationState: "SPARSE_SPEC" },
      { decision: "PURSUE", qualityScore: 92, evaluationState: "EVALUATED", evaluationIdentity: "eval_2" },
      richReacq
    );
    expect(diff1.decisionShiftCategory).toBe("SPARSE_TO_PURSUE");
    expect(diff1.shiftSeverity).toBe("CRITICAL");

    // PASS -> PURSUE: Critical
    const diff2 = engine.calculateEvaluationDiff(
      { ...v1, decision: "PASS", evaluationState: "EVALUATED" },
      { decision: "PURSUE", qualityScore: 90, evaluationState: "EVALUATED", evaluationIdentity: "eval_2" },
      richReacq
    );
    expect(diff2.decisionShiftCategory).toBe("PASS_TO_PURSUE");
    expect(diff2.shiftSeverity).toBe("CRITICAL");

    // CONSIDER -> PURSUE: Material
    const diff3 = engine.calculateEvaluationDiff(
      { ...v1, decision: "CONSIDER", evaluationState: "EVALUATED" },
      { decision: "PURSUE", qualityScore: 89, evaluationState: "EVALUATED", evaluationIdentity: "eval_2" },
      richReacq
    );
    expect(diff3.decisionShiftCategory).toBe("CONSIDER_TO_PURSUE");
    expect(diff3.shiftSeverity).toBe("MATERIAL");

    // PURSUE -> PASS: Critical
    const diff4 = engine.calculateEvaluationDiff(
      { ...v1, decision: "PURSUE", evaluationState: "EVALUATED" },
      { decision: "PASS", qualityScore: 40, evaluationState: "EVALUATED", evaluationIdentity: "eval_2" },
      richReacq
    );
    expect(diff4.decisionShiftCategory).toBe("PURSUE_TO_PASS");
    expect(diff4.shiftSeverity).toBe("CRITICAL");

    // SAME_VERDICT: Stable
    const diff5 = engine.calculateEvaluationDiff(
      { ...v1, decision: "PURSUE", evaluationState: "EVALUATED" },
      { decision: "PURSUE", qualityScore: 88, evaluationState: "EVALUATED", evaluationIdentity: "eval_2" },
      richReacq
    );
    expect(diff5.decisionShiftCategory).toBe("SAME_VERDICT");
    expect(diff5.shiftSeverity).toBe("STABLE");
  });

  // ── 10. Idempotent Processing & Resume ───────────────────────────
  it("10. Generates deterministic v2 identity and does not create duplicate entries on repeated runs", async () => {
    const run1 = await engine.processItem(mockP0IndeedItem, {
      isDryRun: false,
      simulateFetch: async () => ({
        status: 200,
        text: "Digital Advisory Director Accordion India with executive P&L leadership.",
        html: "<div id='jobDescriptionText'>Digital Advisory Director Accordion India</div>",
      }),
    });

    const run2 = await engine.processItem(mockP0IndeedItem, {
      isDryRun: false,
      simulateFetch: async () => ({
        status: 200,
        text: "Digital Advisory Director Accordion India with executive P&L leadership.",
        html: "<div id='jobDescriptionText'>Digital Advisory Director Accordion India</div>",
      }),
    });

    expect(run1.v2?.opportunityVersionId).toBe(run2.v2?.opportunityVersionId);
    expect(run1.v2?.contentHash).toBe(run2.v2?.contentHash);
  });
});
