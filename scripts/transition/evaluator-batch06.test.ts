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
import {
  resolveEvidenceQuotesToSpanIds,
  validateRoleDocument,
  validateCandidateDocument,
  ingestHoldoutTruth
} from "./ingest-batch06-human-truth";
import type { StructuredMetric } from "../../src/lib/intelligence/extraction/CandidateProofExtractorV1";

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
    const text1 = "Led commercial growth generating $50M in ARR";
    const fullText1 = "Led commercial growth generating $50M in ARR with a team of 45 engineers.";
    const text2 = "Advised founders on go-to-market strategy.";

    const start1 = rawResumeText.indexOf(text1);
    const end1Ref = start1 + text1.length;
    const end1Claim = rawResumeText.indexOf(fullText1) + fullText1.length;

    const start2 = rawResumeText.indexOf(text2);
    const end2 = start2 + text2.length;

    const refFacts: CandidateReferenceFact[] = [
      {
        id: "rf_01",
        documentId: syntheticDocId,
        exactText: text1,
        startOffset: start1,
        endOffset: end1Ref,
        metrics: [
          {
            rawText: "$50M",
            metricType: "CURRENCY",
            normalizedValue: 50000000,
            unit: "USD",
            comparator: "EXACT"
          }
        ],
        employer: "Acme Corp",
        proofTypes: ["REVENUE_GROWTH"],
        evidenceClass: "WORK_HISTORY"
      },
      {
        id: "rf_02",
        documentId: syntheticDocId,
        exactText: text2,
        startOffset: start2,
        endOffset: end2,
        spanId: "span_adv",
        metrics: [
          {
            rawText: "12",
            metricType: "COUNT",
            normalizedValue: 12,
            comparator: "EXACT"
          }
        ],
        employer: "Beta Inc",
        proofTypes: ["MANDATE"],
        evidenceClass: "WORK_HISTORY"
      }
    ];

    // Claim 1 retains $50M and binds Acme Corp
    const claim1: CandidateExtractedClaim = {
      sourceDocumentId: syntheticDocId,
      exactText: fullText1,
      startOffset: start1,
      endOffset: end1Claim,
      employer: "Acme Corp",
      metrics: [
        {
          rawText: "$50M",
          metricType: "CURRENCY",
          normalizedValue: 50000000,
          unit: "USD",
          comparator: "EXACT"
        }
      ],
      proofTypes: ["REVENUE_GROWTH"],
      evidenceClass: "WORK_HISTORY"
    };

    // Claim 2 drops metric (no number) and transposes employer to Acme Corp (wrong employer!)
    const claim2: CandidateExtractedClaim = {
      sourceDocumentId: syntheticDocId,
      spanId: "span_adv",
      exactText: text2,
      startOffset: start2,
      endOffset: end2,
      employer: "Acme Corp", // Wrong employer binding! Ref has Beta Inc
      metrics: [], // Dropped metric!
      proofTypes: ["MANDATE"],
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

  it("evaluates plural proofTypes matching and canonical StructuredMetric objects", () => {
    const metricRef: StructuredMetric = {
      exactText: "45 engineers",
      startOffset: 120,
      endOffset: 132,
      metricType: "COUNT",
      rawValue: "45",
      normalizedValue: 45,
      comparator: "EXACT",
      unit: "engineers"
    };

    const bulletText = "Led commercial growth generating $50M in ARR with a team of 45 engineers.";
    const bStart = rawResumeText.indexOf(bulletText);
    const bEnd = bStart + bulletText.length;

    const refFacts: CandidateReferenceFact[] = [
      {
        id: "rf_plural_01",
        documentId: syntheticDocId,
        exactText: bulletText,
        startOffset: bStart,
        endOffset: bEnd,
        employer: "Acme Corp",
        proofTypes: ["PEOPLE_SCOPE", "ORGANIZATION_BUILD"],
        evidenceClass: "WORK_HISTORY",
        metrics: [metricRef]
      }
    ];

    // Claim matches one of the plural proofTypes and has exact matching StructuredMetric
    const claimMatch: CandidateExtractedClaim = {
      sourceDocumentId: syntheticDocId,
      exactText: bulletText,
      startOffset: bStart,
      endOffset: bEnd,
      employer: "Acme Corp",
      proofTypes: ["PEOPLE_SCOPE"],
      evidenceClass: "WORK_HISTORY",
      metrics: [metricRef]
    };

    const result = evaluateCandidateDocument(
      syntheticDocId,
      "TEST_CAND_ARCH",
      rawResumeText,
      refFacts,
      [claimMatch]
    );

    expect(result.typedRecallCount).toBe(1);
    expect(result.metricRetentionCount).toBe(1);
    expect(result.metricRetentionRate).toBe(1.0);
  });

  it("strictly enforces canonical StructuredMetric matching and rejects loose text-number matching", () => {
    const metricRef: StructuredMetric = {
      exactText: "420 engineers",
      startOffset: 120,
      endOffset: 133,
      metricType: "COUNT",
      rawValue: "420",
      normalizedValue: 420,
      comparator: "EXACT",
      unit: "engineers"
    };

    const refFacts: CandidateReferenceFact[] = [
      {
        id: "rf_metric_strict_01",
        documentId: syntheticDocId,
        exactText: "Directed global engineering and infrastructure org of 420 engineers.",
        startOffset: 100,
        endOffset: 168,
        employer: "Acme Corp",
        proofTypes: ["PEOPLE_SCOPE"],
        evidenceClass: "WORK_HISTORY",
        metrics: [metricRef]
      }
    ];

    // Claim has metric with mismatched unit ("customers" instead of "engineers"), even though exactText contains "420"
    const mismatchedClaim: CandidateExtractedClaim = {
      sourceDocumentId: syntheticDocId,
      exactText: "Directed global engineering and infrastructure org of 420 engineers.",
      startOffset: 100,
      endOffset: 168,
      employer: "Acme Corp",
      proofTypes: ["PEOPLE_SCOPE"],
      evidenceClass: "WORK_HISTORY",
      metrics: [
        {
          exactText: "420 customers",
          metricType: "COUNT",
          rawValue: "420",
          normalizedValue: 420,
          comparator: "EXACT",
          unit: "customers" // MISMATCHED UNIT!
        }
      ]
    };

    const result = evaluateCandidateDocument(
      syntheticDocId,
      "TEST_CAND_ARCH",
      rawResumeText,
      refFacts,
      [mismatchedClaim]
    );

    // Metric retention must FAIL (0 matches, 0.0 rate) despite text containing "420"
    expect(result.metricRetentionCount).toBe(0);
    expect(result.metricRetentionRate).toBe(0.0);
  });

  it("strictly eliminates substring matching for Gate 9 chronology fields (VP vs SVP, Acme vs Acme Consulting)", () => {
    const refFacts: CandidateReferenceFact[] = [
      {
        id: "rf_chrono_strict_01",
        documentId: syntheticDocId,
        exactText: "Acme VP role",
        startOffset: 10,
        endOffset: 22,
        employer: "Acme",
        title: "VP",
        startDate: "2020",
        endDate: "2024",
        isCurrent: false,
        proofTypes: ["REVENUE_GROWTH"],
        evidenceClass: "WORK_HISTORY"
      }
    ];

    // Case 1: Substring title ("SVP" vs "VP") must NOT pass
    const svpClaim: CandidateExtractedClaim = {
      sourceDocumentId: syntheticDocId,
      exactText: "Acme VP role",
      startOffset: 10,
      endOffset: 22,
      employer: "Acme",
      title: "SVP", // Substring of/to "VP"
      startDate: "2020",
      endDate: "2024",
      isCurrent: false,
      proofTypes: ["REVENUE_GROWTH"],
      evidenceClass: "WORK_HISTORY"
    };

    const resTitle = evaluateCandidateDocument(syntheticDocId, "TEST_CAND_ARCH", rawResumeText, refFacts, [svpClaim]);
    expect(resTitle.chronologyBindingMatches).toBe(0);

    // Case 2: Substring employer ("Acme Consulting" vs "Acme") must NOT pass
    const consultingClaim: CandidateExtractedClaim = {
      sourceDocumentId: syntheticDocId,
      exactText: "Acme VP role",
      startOffset: 10,
      endOffset: 22,
      employer: "Acme Consulting", // Contains "Acme"
      title: "VP",
      startDate: "2020",
      endDate: "2024",
      isCurrent: false,
      proofTypes: ["REVENUE_GROWTH"],
      evidenceClass: "WORK_HISTORY"
    };

    const resEmp = evaluateCandidateDocument(syntheticDocId, "TEST_CAND_ARCH", rawResumeText, refFacts, [consultingClaim]);
    expect(resEmp.chronologyBindingMatches).toBe(0);

    // Case 3: Substring dates ("2020-2024" vs "2020") must NOT pass
    const dateClaim: CandidateExtractedClaim = {
      sourceDocumentId: syntheticDocId,
      exactText: "Acme VP role",
      startOffset: 10,
      endOffset: 22,
      employer: "Acme",
      title: "VP",
      startDate: "2020-2024", // Mismatched date string
      endDate: "2024",
      isCurrent: false,
      proofTypes: ["REVENUE_GROWTH"],
      evidenceClass: "WORK_HISTORY"
    };

    const resDate = evaluateCandidateDocument(syntheticDocId, "TEST_CAND_ARCH", rawResumeText, refFacts, [dateClaim]);
    expect(resDate.chronologyBindingMatches).toBe(0);
  });

  it("enforces Gate 9 Chronology Binding: employer AND title AND tenure/current-status", () => {
    const refFacts: CandidateReferenceFact[] = [
      {
        id: "rf_chrono_01",
        documentId: syntheticDocId,
        exactText: "Acme Corp VP of Growth role",
        startOffset: 0,
        endOffset: 27,
        employer: "Acme Corp",
        title: "VP of Growth",
        startDate: "2020",
        endDate: "2024",
        isCurrent: false,
        proofTypes: ["REVENUE_GROWTH"],
        evidenceClass: "WORK_HISTORY"
      },
      {
        id: "rf_chrono_02",
        documentId: syntheticDocId,
        exactText: "Beta Inc Advisor role",
        startOffset: 28,
        endOffset: 49,
        employer: "Beta Inc",
        title: "Advisor",
        startDate: "2024",
        isCurrent: true,
        proofTypes: ["MANDATE"],
        evidenceClass: "WORK_HISTORY"
      }
    ];

    // Claim 1 matches employer, title, startDate, endDate, isCurrent -> 100% chronology match
    const claim1: CandidateExtractedClaim = {
      sourceDocumentId: syntheticDocId,
      exactText: "Acme Corp VP of Growth role",
      startOffset: 0,
      endOffset: 27,
      employer: "Acme Corp",
      title: "VP of Growth",
      startDate: "2020",
      endDate: "2024",
      isCurrent: false,
      proofTypes: ["REVENUE_GROWTH"],
      evidenceClass: "WORK_HISTORY"
    };

    // Claim 2 matches employer, but has WRONG title ("Board Member" instead of "Advisor")
    const claim2: CandidateExtractedClaim = {
      sourceDocumentId: syntheticDocId,
      exactText: "Beta Inc Advisor role",
      startOffset: 28,
      endOffset: 49,
      employer: "Beta Inc",
      title: "Board Member", // Mismatched title!
      startDate: "2024",
      isCurrent: true,
      proofTypes: ["MANDATE"],
      evidenceClass: "WORK_HISTORY"
    };

    const result = evaluateCandidateDocument(
      syntheticDocId,
      "TEST_CAND_ARCH",
      rawResumeText,
      refFacts,
      [claim1, claim2]
    );

    // Both match employer (diagnostic employerBindingAccuracy = 1.0)
    expect(result.employerBindingMatches).toBe(2);
    expect(result.employerBindingAccuracy).toBe(1.0);

    // But only claim1 matches employer AND title AND dates -> chronologyBindingAccuracy = 1/2 = 0.5
    expect(result.chronologyBindingMatches).toBe(1);
    expect(result.totalWorkHistoryInReference).toBe(2);
    expect(result.chronologyBindingAccuracy).toBe(0.5);
  });

  it("enforces literal character-for-character provenance without whitespace fallback", () => {
    const textSlice = "Acme Corp";
    const start = rawResumeText.indexOf(textSlice);
    const end = start + textSlice.length;

    // Slice with 1 extra space or off-by-one must FAIL
    const badOffsetClaim: CandidateExtractedClaim = {
      sourceDocumentId: syntheticDocId,
      exactText: textSlice,
      startOffset: start,
      endOffset: end + 1 // points to "Acme Corp "
    };

    const missingOffsetClaim: CandidateExtractedClaim = {
      sourceDocumentId: syntheticDocId,
      exactText: textSlice
      // missing startOffset and endOffset
    };

    const result = evaluateCandidateDocument(
      syntheticDocId,
      "TEST_CAND_ARCH",
      rawResumeText,
      [],
      [badOffsetClaim, missingOffsetClaim]
    );

    expect(result.offsetVerificationCount).toBe(2);
    expect(result.offsetVerificationFailures).toBe(2);
    expect(result.offsetAccuracyRate).toBe(0.0);
  });
});

describe("Batch 06 Evaluator — Human Truth Ingestion & Span Resolution", () => {
  it("resolves literal human quotes to exact MechanicalSourceSegmenter span IDs", () => {
    const jdText =
      "CloudPoint Global Solutions is seeking a Senior Director.\nIn this role, you will manage an annual marketing program budget of $6,500,000 across digital acquisition.\nYou will report to the Chief Operating Officer.";
    const quotes = ["manage an annual marketing program budget of $6,500,000"];

    const resolution = resolveEvidenceQuotesToSpanIds(quotes, jdText);
    expect(resolution.errors.length).toBe(0);
    expect(resolution.spanIds.length).toBeGreaterThanOrEqual(1);

    // Missing quote produces error
    const missingQuoteRes = resolveEvidenceQuotesToSpanIds(["Non-existent quote in text"], jdText);
    expect(missingQuoteRes.errors.length).toBe(1);
    expect(missingQuoteRes.spanIds.length).toBe(0);
  });

  it("disambiguates duplicate quotes with explicit offsets and rejects ambiguous duplicate quotes without offsets", () => {
    const jdText =
      "Position A: Reports to the Chief Operating Officer on weekly basis.\nPosition B: Reports to the Chief Operating Officer on monthly basis.";
    const quoteText = "Reports to the Chief Operating Officer";

    // 1. Ambiguous duplicate quote as plain string -> must FAIL
    const resAmbiguous = resolveEvidenceQuotesToSpanIds([quoteText], jdText);
    expect(resAmbiguous.errors.length).toBe(1);
    expect(resAmbiguous.errors[0]).toContain("occurs 2 times in raw source text");

    // 2. Disambiguated duplicate quote with explicit valid offsets -> must PASS
    const firstStart = jdText.indexOf(quoteText);
    const firstEnd = firstStart + quoteText.length;
    const resExplicit = resolveEvidenceQuotesToSpanIds(
      [{ exactText: quoteText, startOffset: firstStart, endOffset: firstEnd }],
      jdText
    );
    expect(resExplicit.errors.length).toBe(0);
    expect(resExplicit.spanIds.length).toBeGreaterThanOrEqual(1);

    // 3. Duplicate quote with invalid/mismatched offsets -> must FAIL
    const resBadOffset = resolveEvidenceQuotesToSpanIds(
      [{ exactText: quoteText, startOffset: firstStart, endOffset: firstEnd + 5 }],
      jdText
    );
    expect(resBadOffset.errors.length).toBe(1);
    expect(resBadOffset.errors[0]).toContain("Literal offset mismatch");
  });

  it("rejects role documents with missing materiality, invalid families, or single reviewer", () => {
    const jdText = "Role overview text here for testing.";

    // Missing materiality
    const missingMat = {
      opaqueId: "ROLE_01",
      reviewer1Id: "REV1",
      reviewer2Id: "REV2",
      facts: [
        {
          id: "f1",
          propositionText: "Some fact",
          sourceEvidence: ["Role overview"],
          canonicalTypes: ["ROLE_PURPOSE"],
          appliesTo: "ROLE",
          polarity: "AFFIRMED"
          // materiality omitted!
        }
      ]
    };
    const res1 = validateRoleDocument(missingMat, jdText, "test.json");
    expect(res1.valid).toBe(false);
    expect(res1.errors.some(e => e.includes("Missing or invalid materiality"))).toBe(true);

    // Invalid high risk family (COMMERCIAL_ACCOUNTABILITY)
    const invalidFam = {
      opaqueId: "ROLE_02",
      reviewer1Id: "REV1",
      reviewer2Id: "REV2",
      facts: [
        {
          id: "f1",
          propositionText: "Some fact",
          sourceEvidence: ["Role overview"],
          canonicalTypes: ["REVENUE_ACCOUNTABILITY"],
          appliesTo: "ROLE",
          polarity: "AFFIRMED",
          materiality: "MATERIAL_SELECTED",
          highRiskFamily: "COMMERCIAL_ACCOUNTABILITY" // INVALID!
        }
      ]
    };
    const res2 = validateRoleDocument(invalidFam, jdText, "test.json");
    expect(res2.valid).toBe(false);
    expect(res2.errors.some(e => e.includes("Invalid highRiskFamily"))).toBe(true);

    // Single reviewer (reviewer1Id === reviewer2Id)
    const singleRev = {
      opaqueId: "ROLE_03",
      reviewer1Id: "REV1",
      reviewer2Id: "REV1", // NOT INDEPENDENT!
      facts: [
        {
          id: "f1",
          propositionText: "Some fact",
          sourceEvidence: ["Role overview"],
          canonicalTypes: ["ROLE_PURPOSE"],
          appliesTo: "ROLE",
          polarity: "AFFIRMED",
          materiality: "MATERIAL_SELECTED"
        }
      ]
    };
    const res3 = validateRoleDocument(singleRev, jdText, "test.json");
    expect(res3.valid).toBe(false);
    expect(res3.errors.some(e => e.includes("distinct independent reviewers"))).toBe(true);
  });

  it("enforces reconciliation fact resolution and distinct reviewers", () => {
    const jdText = "Role overview text here for testing.";

    // Missing resolution in reconciliation role document
    const missingResDoc = {
      opaqueId: "ROLE_REC_01",
      reviewer1Id: "REV1",
      reviewer2Id: "REV2",
      adjudicatorId: "ADJ1",
      facts: [
        {
          id: "f1",
          propositionText: "Some fact",
          sourceEvidence: ["Role overview"],
          canonicalTypes: ["ROLE_PURPOSE"],
          appliesTo: "ROLE",
          polarity: "AFFIRMED",
          materiality: "MATERIAL_SELECTED"
          // resolution omitted!
        }
      ]
    };
    const res = validateRoleDocument(missingResDoc, jdText, "ROLE_REC_01_RECONCILIATION.json");
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes("Missing or invalid reconciliation resolution"))).toBe(true);

    // Valid reconciliation role document
    const validResDoc = {
      opaqueId: "ROLE_REC_01",
      reviewer1Id: "REV1",
      reviewer2Id: "REV2",
      adjudicatorId: "ADJ1",
      dualReviewVerified: true,
      facts: [
        {
          id: "f1",
          rev1FactIds: ["r1_f1"],
          rev2FactIds: ["r2_f1"],
          resolution: "AGREED",
          propositionText: "Some fact",
          sourceEvidence: ["Role overview"],
          canonicalTypes: ["ROLE_PURPOSE"],
          appliesTo: "ROLE",
          polarity: "AFFIRMED",
          materiality: "MATERIAL_SELECTED"
        }
      ]
    };
    const resValid = validateRoleDocument(validResDoc, jdText, "ROLE_REC_01_RECONCILIATION.json");
    expect(resValid.valid).toBe(true);
  });

  it("enforces adjudicatorId when resolution is ADJUDICATED in role and candidate documents", () => {
    const jdText = "Role overview text here for testing.";
    const noAdjDoc = {
      opaqueId: "ROLE_REC_01",
      reviewer1Id: "REV1",
      reviewer2Id: "REV2",
      facts: [
        {
          id: "f1",
          rev1FactIds: ["r1_f1"],
          rev2FactIds: ["r2_f1"],
          resolution: "ADJUDICATED",
          propositionText: "Some fact",
          sourceEvidence: ["Role overview"],
          canonicalTypes: ["ROLE_PURPOSE"],
          appliesTo: "ROLE",
          polarity: "AFFIRMED",
          materiality: "MATERIAL_SELECTED"
        }
      ]
    };
    const res = validateRoleDocument(noAdjDoc, jdText, "ROLE_REC_01_RECONCILIATION.json");
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes("lacks mandatory adjudicatorId"))).toBe(true);

    const resumeText = "Acme Corp (2020-2024)\nJohn Doe worked here.";
    const noAdjCandDoc = {
      opaqueId: "CAND_REC_01",
      reviewer1Id: "REV1",
      reviewer2Id: "REV2",
      facts: [
        {
          id: "cf1",
          rev1FactIds: ["r1_cf1"],
          rev2FactIds: ["r2_cf1"],
          resolution: "ADJUDICATED",
          employer: "Acme Corp",
          proofTypes: ["OUTCOME"],
          evidenceClass: "WORK_HISTORY",
          exactText: "John Doe worked here.",
          startOffset: resumeText.indexOf("John Doe worked here."),
          endOffset: resumeText.indexOf("John Doe worked here.") + "John Doe worked here.".length
        }
      ]
    };
    const candRes = validateCandidateDocument(noAdjCandDoc, resumeText, "CAND_REC_01_RECONCILIATION.json");
    expect(candRes.valid).toBe(false);
    expect(candRes.errors.some(e => e.includes("lacks mandatory adjudicatorId"))).toBe(true);
  });

  it("enforces non-empty rev1FactIds and rev2FactIds in reconciliation facts", () => {
    const jdText = "Role overview text here for testing.";
    const missingRevIdsDoc = {
      opaqueId: "ROLE_REC_01",
      reviewer1Id: "REV1",
      reviewer2Id: "REV2",
      facts: [
        {
          id: "f1",
          resolution: "AGREED",
          propositionText: "Some fact",
          sourceEvidence: ["Role overview"],
          canonicalTypes: ["ROLE_PURPOSE"],
          appliesTo: "ROLE",
          polarity: "AFFIRMED",
          materiality: "MATERIAL_SELECTED"
        }
      ]
    };
    const res = validateRoleDocument(missingRevIdsDoc, jdText, "ROLE_REC_01_RECONCILIATION.json");
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes("rev1FactIds"))).toBe(true);
    expect(res.errors.some(e => e.includes("rev2FactIds"))).toBe(true);
  });

  it("enforces document opaqueId matches filename opaqueId for reconciliation artifacts", () => {
    const jdText = "Role overview text here for testing.";
    const mismatchedDoc = {
      opaqueId: "ROLE_DIFF_99",
      reviewer1Id: "REV1",
      reviewer2Id: "REV2",
      facts: [
        {
          id: "f1",
          rev1FactIds: ["r1_f1"],
          rev2FactIds: ["r2_f1"],
          resolution: "AGREED",
          propositionText: "Some fact",
          sourceEvidence: ["Role overview"],
          canonicalTypes: ["ROLE_PURPOSE"],
          appliesTo: "ROLE",
          polarity: "AFFIRMED",
          materiality: "MATERIAL_SELECTED"
        }
      ]
    };
    const res = validateRoleDocument(mismatchedDoc, jdText, "ROLE_REC_01_RECONCILIATION.json");
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes("does not match filename opaqueId"))).toBe(true);
  });

  it("rejects incomplete holdout truth when triplets are missing from population manifest", () => {
    const res = ingestHoldoutTruth("primary");
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.errors.some(e => e.includes("Missing role reconciliation for population member"))).toBe(true);
  });

  it("rejects candidate documents with non-canonical proof types or invalid offsets", () => {
    const resumeText = "Acme Corp (2020-2024)\nJohn Doe worked here.";

    // Non-canonical proof type
    const badProofType = {
      opaqueId: "CAND_01",
      reviewerId: "REV1",
      reviewer2Id: "REV2",
      facts: [
        {
          id: "cf1",
          employer: "Acme Corp",
          title: "Lead",
          startDate: "2020",
          isCurrent: false,
          proofTypes: ["REVENUE_EXPANSION"], // NON-CANONICAL!
          evidenceClass: "WORK_HISTORY",
          exactText: "John Doe worked here.",
          startOffset: resumeText.indexOf("John Doe worked here."),
          endOffset: resumeText.indexOf("John Doe worked here.") + "John Doe worked here.".length
        }
      ]
    };
    const res1 = validateCandidateDocument(badProofType, resumeText, "test.json");
    expect(res1.valid).toBe(false);
    expect(res1.errors.some(e => e.includes("Invalid candidate proof type"))).toBe(true);

    // Mismatched offset slice
    const badOffset = {
      opaqueId: "CAND_02",
      reviewerId: "REV1",
      reviewer2Id: "REV2",
      facts: [
        {
          id: "cf1",
          employer: "Acme Corp",
          title: "Lead",
          startDate: "2020",
          isCurrent: false,
          proofTypes: ["OUTCOME"],
          evidenceClass: "WORK_HISTORY",
          exactText: "John Doe worked here.",
          startOffset: 0,
          endOffset: 5 // slice(0, 5) !== "John Doe worked here."
        }
      ]
    };
    const res2 = validateCandidateDocument(badOffset, resumeText, "test.json");
    expect(res2.valid).toBe(false);
    expect(res2.errors.some(e => e.includes("Literal provenance mismatch"))).toBe(true);
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
        costUsd: 0.02,
        silentDimensionsCount: 10,
        silentDimensionsCapturedCount: 10
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

    const summary = scoreBatch06CertificationRun(roleResults, candidateResults);

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

  it("evaluates Gate 7 silent dimension abstention vs affirmative breach", () => {
    // Passes when silent dimensions are preserved with zero affirmative assertions
    const rolePass = [
      {
        documentId: "doc_pass",
        partition: "test",
        architecture: "ARCH_TEST",
        rawDocLength: 1000,
        totalReferenceFacts: 1,
        selectionMatches: 1,
        typedMatches: 1,
        selectionRecall: 1.0,
        typedRecall: 1.0,
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
        totalAssertionsEmitted: 1,
        unmappedConcepts: [],
        silentDimensionsCount: 5,
        silentDimensionsCapturedCount: 5
      }
    ];
    const summaryPass = scoreBatch06CertificationRun(rolePass, []);
    const gate7Pass = summaryPass.gateDetails.find(g => g.metricName === "Insufficient-Evidence Capture Rate");
    expect(gate7Pass?.passed).toBe(true);
    expect(gate7Pass?.observedValue).toBe("100.0%");

    // Fails when affirmative assertions are emitted on silent dimensions
    const roleFail = [
      {
        ...rolePass[0],
        documentId: "doc_fail",
        silentDimensionsCount: 5,
        silentDimensionsCapturedCount: 3 // 60% < 90%
      }
    ];
    const summaryFail = scoreBatch06CertificationRun(roleFail, []);
    const gate7Fail = summaryFail.gateDetails.find(g => g.metricName === "Insufficient-Evidence Capture Rate");
    expect(gate7Fail?.passed).toBe(false);
    expect(gate7Fail?.observedValue).toBe("60.0%");
  });
});
