/**
 * scripts/transition/evaluator-batch06.test.ts
 *
 * Focused unit tests for Batch 06 evaluator using purely synthetic, non-blind fixtures.
 * Verifies:
 * 1. Distinction between representation absence and semantic false assertions.
 * 2. Separate scoring of applicability domain and polarity status.
 * 3. High-risk false affirmative detection (over negated facts, disclaimers, highRiskNegatives).
 * 4. Candidate metric token fidelity and employer binding accuracy.
 * 5. Mechanical offset verification for candidate source text (hallucination detection).
 * 6. Aggregate gate scoring and pre-registered failure classifications.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateRoleDocument,
  evaluateCandidateDocument,
  scoreBatch06CertificationRun,
  type NormalizedReferenceFact,
  type CommonAssertion,
  type CandidateReferenceFact,
  type CandidateExtractedClaim
} from "./evaluator-batch06";

describe("Batch 06 Evaluator — Role Evaluation", () => {
  const syntheticDocId = "SYNTHETIC_ROLE_001";

  it("distinguishes representation absence from semantic false assertions", () => {
    const refFacts: NormalizedReferenceFact[] = [
      {
        id: "ref_pnl_neg",
        documentId: syntheticDocId,
        sourceEvidence: ["span_01"],
        canonicalTypes: ["PNL_OWNERSHIP"],
        appliesTo: "ROLE",
        polarity: "NEGATED",
        highRiskFamily: "PNL_OWNERSHIP",
        propositionText: "The role does not have direct P&L accountability."
      }
    ];

    // Architecture without polarity channel (REPRESENTATION_UNAVAILABLE)
    const assertionsUnavail: CommonAssertion[] = [
      {
        documentId: syntheticDocId,
        architecture: "TEST_ARCH_NO_POL",
        sourceEvidence: ["span_01"],
        canonicalTypes: ["PNL_OWNERSHIP"],
        appliesTo: "ROLE",
        polarity: "REPRESENTATION_UNAVAILABLE",
        exactText: "P&L accountability"
      }
    ];

    const resultUnavail = evaluateRoleDocument(
      syntheticDocId,
      "test",
      "TEST_ARCH_NO_POL",
      5000,
      refFacts,
      [],
      [],
      assertionsUnavail
    );

    expect(resultUnavail.factBreakdowns[0].status).toBe("RECOVERED_TYPED");
    expect(resultUnavail.factBreakdowns[0].polarityStatus).toBe("POLARITY_UNREPRESENTABLE");
    expect(resultUnavail.highRiskBreakdown.observedFalseAffirmatives).toBe(0);
    expect(resultUnavail.highRiskBreakdown.emittedOnNegatedReferenceWithoutPolarity).toBe(1);

    // Architecture that affirmatively emits AFFIRMED on a negated span (semantic false assertion)
    const assertionsAffirmed: CommonAssertion[] = [
      {
        documentId: syntheticDocId,
        architecture: "TEST_ARCH_AFF",
        sourceEvidence: ["span_01"],
        canonicalTypes: ["PNL_OWNERSHIP"],
        appliesTo: "ROLE",
        polarity: "AFFIRMED",
        exactText: "The role has direct P&L accountability"
      }
    ];

    const resultAffirmed = evaluateRoleDocument(
      syntheticDocId,
      "test",
      "TEST_ARCH_AFF",
      5000,
      refFacts,
      [],
      [],
      assertionsAffirmed
    );

    expect(resultAffirmed.factBreakdowns[0].status).toBe("RECOVERED_TYPED");
    expect(resultAffirmed.factBreakdowns[0].polarityStatus).toBe("WRONG_POLARITY");
    expect(resultAffirmed.highRiskBreakdown.observedFalseAffirmatives).toBe(1);
  });

  it("scores applicability and polarity separately", () => {
    const refFacts: NormalizedReferenceFact[] = [
      {
        id: "ref_req_01",
        documentId: syntheticDocId,
        sourceEvidence: ["span_02"],
        canonicalTypes: ["PEOPLE_LEADERSHIP"],
        appliesTo: "CANDIDATE_REQUIREMENT",
        polarity: "AFFIRMED",
        highRiskFamily: "PEOPLE_LEADERSHIP",
        propositionText: "Candidate must have 10+ years people leadership experience."
      }
    ];

    // Assertion correctly matches polarity but violates applicability boundary (asserted as ROLE authority)
    const assertionsBoundaryLeak: CommonAssertion[] = [
      {
        documentId: syntheticDocId,
        architecture: "TEST_ARCH_LEAK",
        sourceEvidence: ["span_02"],
        canonicalTypes: ["PEOPLE_LEADERSHIP"],
        appliesTo: "ROLE",
        polarity: "AFFIRMED",
        exactText: "Leads people"
      }
    ];

    const result = evaluateRoleDocument(
      syntheticDocId,
      "test",
      "TEST_ARCH_LEAK",
      5000,
      refFacts,
      [],
      [],
      assertionsBoundaryLeak
    );

    expect(result.factBreakdowns[0].polarityStatus).toBe("POLARITY_MATCH");
    expect(result.factBreakdowns[0].applicabilityStatus).toBe("WRONG_APPLICABILITY");
    expect(result.highRiskBreakdown.subjectApplicabilityErrors).toBe(1);
  });

  it("detects high-risk false affirmatives over forbidden negatives and disclaimers", () => {
    const refFacts: NormalizedReferenceFact[] = [];
    const highRiskNegatives = ["BOARD_EXPOSURE"];
    const disclaimerSpans = ["span_disclaimer_01"];

    const assertions: CommonAssertion[] = [
      {
        documentId: syntheticDocId,
        architecture: "TEST_ARCH_HR",
        sourceEvidence: ["span_disclaimer_01"],
        canonicalTypes: ["BOARD_EXPOSURE"],
        appliesTo: "ROLE",
        polarity: "AFFIRMED",
        exactText: "Regular board presentations"
      }
    ];

    const result = evaluateRoleDocument(
      syntheticDocId,
      "test",
      "TEST_ARCH_HR",
      5000,
      refFacts,
      highRiskNegatives,
      disclaimerSpans,
      assertions
    );

    // Asserted forbidden negative and disclaimer span -> both trigger observedFalseAffirmatives
    expect(result.highRiskBreakdown.observedFalseAffirmatives).toBeGreaterThanOrEqual(1);
  });
});

describe("Batch 06 Evaluator — Candidate Evaluation", () => {
  const syntheticDocId = "SYNTHETIC_CAND_001";
  const rawResumeText =
    "John Doe\nVP of Growth at Acme Corp (2020 - 2024)\n- Led commercial growth generating $50M in ARR with a team of 45 engineers.\nAdvisor at Beta Inc (2024 - Present)\n- Advised founders on go-to-market strategy.";

  it("mechanically verifies candidate source offsets and detects span hallucinations", () => {
    const refFacts: CandidateReferenceFact[] = [];
    const validText = "Led commercial growth generating $50M in ARR with a team of 45 engineers.";
    const validStart = rawResumeText.indexOf(validText);
    const validEnd = validStart + validText.length;

    // Valid claim matching exact source text slice
    const validClaim: CandidateExtractedClaim = {
      sourceDocumentId: syntheticDocId,
      exactText: validText,
      startOffset: validStart,
      endOffset: validEnd,
      metrics: ["$50M", "45"]
    };

    // Hallucinated claim where offsets point to wrong text or invalid range
    const invalidClaim: CandidateExtractedClaim = {
      sourceDocumentId: syntheticDocId,
      exactText: "Generated $200M in revenue",
      startOffset: validStart,
      endOffset: validEnd, // Text at validStart..validEnd is NOT "$200M"
      metrics: ["$200M"]
    };

    const result = evaluateCandidateDocument(
      syntheticDocId,
      "TEST_CAND_ARCH",
      rawResumeText,
      refFacts,
      [validClaim, invalidClaim]
    );

    expect(result.offsetVerificationCount).toBe(2);
    expect(result.offsetVerificationFailures).toBe(1);
    expect(result.offsetAccuracyRate).toBe(0.5);
  });

  it("evaluates metric token fidelity and employer binding accuracy", () => {
    const refFacts: CandidateReferenceFact[] = [
      {
        id: "rf_01",
        documentId: syntheticDocId,
        exactText: "Led commercial growth generating $50M in ARR",
        metric: "$50M",
        employer: "Acme Corp",
        proofType: "REVENUE_EXPANSION",
        evidenceClass: "WORK_HISTORY"
      },
      {
        id: "rf_02",
        documentId: syntheticDocId,
        exactText: "Advised founders on go-to-market strategy with 12 enterprise accounts",
        spanId: "span_adv",
        metric: "12",
        employer: "Beta Inc",
        proofType: "STRATEGIC_ADVISORY",
        evidenceClass: "WORK_HISTORY"
      }
    ];

    // Claim 1 retains $50M and binds Acme Corp
    const claim1: CandidateExtractedClaim = {
      sourceDocumentId: syntheticDocId,
      exactText: "Led commercial growth generating $50M in ARR with a team of 45 engineers.",
      employer: "Acme Corp",
      metrics: ["$50M"],
      proofTypes: ["REVENUE_EXPANSION"],
      evidenceClass: "WORK_HISTORY"
    };

    // Claim 2 drops metric (no number) and transposes employer to Acme Corp (wrong employer!)
    const claim2: CandidateExtractedClaim = {
      sourceDocumentId: syntheticDocId,
      spanId: "span_adv",
      exactText: "Advised founders on go-to-market strategy with enterprise accounts",
      employer: "Acme Corp", // Wrong employer binding! Ref has Beta Inc
      metrics: [], // Dropped metric!
      proofTypes: ["STRATEGIC_ADVISORY"],
      evidenceClass: "WORK_HISTORY"
    };

    const result = evaluateCandidateDocument(
      syntheticDocId,
      "TEST_CAND_ARCH",
      rawResumeText,
      refFacts,
      [claim1, claim2]
    );

    expect(result.referenceRecall).toBe(1.0);
    expect(result.metricRetentionCount).toBe(1);
    expect(result.employerBindingMatches).toBe(1);
    expect(result.totalMetricsInReference).toBe(2);
    expect(result.totalEmployersInReference).toBe(2);
    expect(result.metricRetentionRate).toBe(0.5);
    expect(result.employerBindingAccuracy).toBe(0.5);
    expect(result.crossPositionContaminationCount).toBe(1);
  });
});

describe("Batch 06 Evaluator — Aggregate Certification Gates & Classification", () => {
  it("passes when all pre-registered thresholds are met", () => {
    const roleResults = [
      {
        documentId: "doc_01",
        partition: "test",
        architecture: "ARCH_TEST",
        rawDocLength: 10000,
        totalReferenceFacts: 10,
        selectionMatches: 8,
        typedMatches: 6, // 60% typed recall (>=50%)
        selectionRecall: 0.8,
        typedRecall: 0.6,
        factBreakdowns: [],
        highRiskBreakdown: {
          observedFalseAffirmatives: 0,
          emittedOnNegatedReferenceWithoutPolarity: 0,
          subjectApplicabilityErrors: 0,
          unconditionalFromConditional: 0,
          recoveredHighRiskFacts: 2,
          missedHighRiskFacts: 0,
          couldNotRepresentPolarityHighRiskFacts: 0
        },
        totalAssertionsEmitted: 10,
        unmappedConcepts: [],
        latencyMs: 8000,
        costUsd: 0.02
      }
    ];

    const candidateResults = [
      {
        documentId: "cand_01",
        architecture: "ARCH_TEST",
        referenceFactCount: 5,
        referenceRecallCount: 5,
        referenceRecall: 1.0,
        typedRecallCount: 5,
        typedRecall: 1.0,
        evidenceClassMatches: 5,
        evidenceClassAccuracy: 1.0,
        metricRetentionCount: 5,
        totalMetricsInReference: 5,
        metricRetentionRate: 1.0, // 100% (>=90%)
        employerBindingMatches: 5,
        totalEmployersInReference: 5,
        employerBindingAccuracy: 1.0, // 100% (>=90%)
        offsetVerificationCount: 10,
        offsetVerificationFailures: 0,
        offsetAccuracyRate: 1.0, // 100% (=100%)
        selfSummaryPromotionCount: 0,
        crossPositionContaminationCount: 0,
        crossDocumentContaminationCount: 0,
        totalClaimsEmitted: 10,
        proofPrecision: 0.5
      }
    ];

    const summary = scoreBatch06CertificationRun(roleResults, candidateResults, {
      totalSilentHighRiskDimensions: 10,
      silentDimensionsEmittedAsUnknownOrBlocked: 10 // 100% (>=90%)
    });

    expect(summary.verdict).toBe("PASS");
    expect(summary.fatalFailuresCount).toBe(0);
    expect(summary.deficitFailuresCount).toBe(0);
    expect(summary.tunableFailuresCount).toBe(0);
  });

  it("classifies high-risk false affirmative as FATAL_SAFETY_FAILURE", () => {
    const roleResults = [
      {
        documentId: "doc_01",
        partition: "test",
        architecture: "ARCH_TEST",
        rawDocLength: 10000,
        totalReferenceFacts: 10,
        selectionMatches: 8,
        typedMatches: 6,
        selectionRecall: 0.8,
        typedRecall: 0.6,
        factBreakdowns: [],
        highRiskBreakdown: {
          observedFalseAffirmatives: 1, // BREACH OF ZERO-TOLERANCE GATE
          emittedOnNegatedReferenceWithoutPolarity: 0,
          subjectApplicabilityErrors: 0,
          unconditionalFromConditional: 0,
          recoveredHighRiskFacts: 2,
          missedHighRiskFacts: 0,
          couldNotRepresentPolarityHighRiskFacts: 0
        },
        totalAssertionsEmitted: 10,
        unmappedConcepts: []
      }
    ];

    const summary = scoreBatch06CertificationRun(roleResults, []);

    expect(summary.verdict).toBe("FATAL_FAILURE");
    expect(summary.fatalFailuresCount).toBe(1);
    const detail = summary.gateDetails.find(g => g.metricName === "High-Risk False Affirmatives");
    expect(detail?.passed).toBe(false);
    expect(detail?.classification).toBe("FATAL_SAFETY_FAILURE");
  });

  it("classifies marginal recall as IMPLEMENTATION_TUNABLE", () => {
    const roleResults = [
      {
        documentId: "doc_01",
        partition: "test",
        architecture: "ARCH_TEST",
        rawDocLength: 10000,
        totalReferenceFacts: 10,
        selectionMatches: 6,
        typedMatches: 4, // 40% typed recall -> below 50% target, but >= 40% floor
        selectionRecall: 0.6,
        typedRecall: 0.4,
        factBreakdowns: [],
        highRiskBreakdown: {
          observedFalseAffirmatives: 0,
          emittedOnNegatedReferenceWithoutPolarity: 0,
          subjectApplicabilityErrors: 0,
          unconditionalFromConditional: 0,
          recoveredHighRiskFacts: 1,
          missedHighRiskFacts: 0,
          couldNotRepresentPolarityHighRiskFacts: 0
        },
        totalAssertionsEmitted: 6,
        unmappedConcepts: []
      }
    ];

    const summary = scoreBatch06CertificationRun(roleResults, []);

    expect(summary.verdict).toBe("REMEDIATION_REQUIRED");
    expect(summary.fatalFailuresCount).toBe(0);
    expect(summary.deficitFailuresCount).toBe(0);
    expect(summary.tunableFailuresCount).toBe(1);
    const detail = summary.gateDetails.find(g => g.metricName === "Overall Typed Recall");
    expect(detail?.passed).toBe(false);
    expect(detail?.classification).toBe("IMPLEMENTATION_TUNABLE");
  });
});
