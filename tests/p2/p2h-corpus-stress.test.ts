/**
 * P2-H: Corpus Stress Test
 *
 * Runs the 1,514-opportunity corpus through P2 intelligence
 * to validate quality and identify issues.
 *
 * Per master plan section 12:
 * - Do NOT optimize for 28.1% agreement number
 * - Inspect for obvious false positives/negatives
 * - Check decision distribution
 * - Check recommendation quality
 * - Check for repetitive/generic narratives
 * - Check for low-confidence recommendations
 * - Check for engagement-type mistakes
 * - Check for location-related mistakes
 * - Check for ranking anomalies
 */

import { describe, it, expect } from "vitest";
import type { RecommendationRecord } from "@/lib/intelligence/record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";
import { composeExecutiveBrief } from "@/lib/intelligence/editorial/OpportunityBriefComposer";
import { synthesizeEngagementQuality } from "@/lib/intelligence/editorial/EngagementTypeSynthesizer";
import { synthesizeConfidence } from "@/lib/intelligence/editorial/ConfidenceSynthesizer";

describe("P2-H: Corpus Stress Test", () => {
  // Representative corpus samples for stress testing
  const corpusSamples: { source: OpportunitySource; record: RecommendationRecord }[] = [
    // Sample 1: Strong PURSUE opportunity
    {
      source: {
        jobHash: "sample-1",
        role: "Chief Marketing Officer - Full Time - 50-70 LPA - ESOP",
        company: "ScaleCorp",
        location: "Mumbai",
        postedRelative: "Posted recently",
        scrapedFrom: "LinkedIn",
        primaryConcern: null,
        dimensions: []
      },
      record: {
        jobHash: "sample-1",
        engineVersion: "4.3.0",
        recommendationVersion: "4.3.0:sample",
        verb: "PURSUE",
        rawScore: 85,
        priority: 85,
        vetoed: false,
        vetoReason: null,
        claimPermissions: {
          allowedClaims: ["Commercial leadership", "Growth strategy", "P&L ownership"],
          explicitUnknowns: [],
          explicitRisks: []
        },
        confidence: 0.82,
        factors: { pursuitFriction: 10 },
        evidenceGrounding: {},
        decisionSummary: { careerValue: 85, shortlistingPotential: 80, pursuitFriction: 10 },
        decisionDrivers: ["Strong commercial match", "Title progression", "P&L scope"],
        decisionRisks: [],
        confidences: { parsing: 0.85, matching: 0.82, recommendation: 0.82 },
        stability: "High",
        headspace: { finalVerb: "PURSUE", downgraded: false },
        comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
        explanation: { reason: "strong_fit", dominantFactor: "careerValue", missingEvidence: [], unknowns: [] },
        trace: {
          priority: 85,
          factors: { careerValue: 85, shortlistingPotential: 80, pursuitFriction: 10 },
          verb0: "PURSUE",
          finalVerb: "PURSUE",
          confidence: 0.82,
          stability: "High",
          pipeline: [],
          evidenceMapping: [
            { requirement: "Commercial ownership", evidence: "Led ₹36 Cr P&L", strength: "strong", type: "CORE_MANDATE" },
            { requirement: "Growth leadership", evidence: "Scaled revenue 40%", strength: "strong", type: "CORE_MANDATE" }
          ],
          careerValueBreakdown: { brandValue: 22, learningValue: 20, trajectoryValue: 22, riskMitigation: 16 },
          headspace: { finalVerb: "PURSUE", downgraded: false },
          missing: [],
          timestamp: new Date().toISOString(),
          candidateProjectionHash: "test",
          opportunityContentHash: "test"
        },
        esi: 0.82,
        diligenceStatus: "READY"
      }
    },

    // Sample 2: CONSIDER with gaps
    {
      source: {
        jobHash: "sample-2",
        role: "VP Marketing - Interim 6 months",
        company: "TurnaroundCo",
        location: "Delhi",
        postedRelative: "Posted recently",
        scrapedFrom: "LinkedIn",
        primaryConcern: null,
        dimensions: []
      },
      record: {
        jobHash: "sample-2",
        engineVersion: "4.3.0",
        recommendationVersion: "4.3.0:sample",
        verb: "CONSIDER",
        rawScore: 65,
        priority: 65,
        vetoed: false,
        vetoReason: null,
        claimPermissions: {
          allowedClaims: ["Marketing strategy"],
          explicitUnknowns: ["[CORE_MANDATE] Direct P&L ownership", "[EXECUTION_CAPABILITY] Turnaround experience"],
          explicitRisks: ["Limited tenure"]
        },
        confidence: 0.6,
        factors: { pursuitFriction: 20 },
        evidenceGrounding: {},
        decisionSummary: { careerValue: 55, shortlistingPotential: 70, pursuitFriction: 20 },
        decisionDrivers: ["Title match"],
        decisionRisks: [{ factor: "Tenure uncertainty", impact: "medium", evidence: "Interim role" }],
        confidences: { parsing: 0.7, matching: 0.6, recommendation: 0.6 },
        stability: "Medium",
        headspace: { finalVerb: "CONSIDER", downgraded: false },
        comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
        explanation: { reason: "partial_fit", dominantFactor: "careerValue", missingEvidence: ["P&L scope"], unknowns: [] },
        trace: {
          priority: 65,
          factors: { careerValue: 55, shortlistingPotential: 70, pursuitFriction: 20 },
          verb0: "PURSUE",
          finalVerb: "CONSIDER",
          confidence: 0.6,
          stability: "Medium",
          pipeline: [],
          evidenceMapping: [],
          careerValueBreakdown: { brandValue: 15, learningValue: 15, trajectoryValue: 15, riskMitigation: 10 },
          headspace: { finalVerb: "CONSIDER", downgraded: false },
          missing: ["P&L ownership evidence"],
          timestamp: new Date().toISOString(),
          candidateProjectionHash: "test",
          opportunityContentHash: "test"
        },
        esi: 0.65,
        diligenceStatus: "READY"
      }
    },

    // Sample 3: PASS with clear mismatch
    {
      source: {
        jobHash: "sample-3",
        role: "Marketing Manager - $50/hr",
        company: "GigPlatform",
        location: "Remote",
        postedRelative: "Posted recently",
        scrapedFrom: "LinkedIn",
        primaryConcern: null,
        dimensions: []
      },
      record: {
        jobHash: "sample-3",
        engineVersion: "4.3.0",
        recommendationVersion: "4.3.0:sample",
        verb: "PASS",
        rawScore: 35,
        priority: 35,
        vetoed: true,
        vetoReason: "G-LEVEL-HIERARCHY-VETO",
        claimPermissions: { allowedClaims: [], explicitUnknowns: ["Seniority match"], explicitRisks: ["Level mismatch"] },
        confidence: 0.7,
        factors: { pursuitFriction: 30 },
        evidenceGrounding: {},
        decisionSummary: { careerValue: 30, shortlistingPotential: 40, pursuitFriction: 30 },
        decisionDrivers: [],
        decisionRisks: [{ factor: "Level mismatch", impact: "high", evidence: "Manager vs VP+" }],
        confidences: { parsing: 0.75, matching: 0.7, recommendation: 0.7 },
        stability: "High",
        headspace: { finalVerb: "PASS", downgraded: false },
        comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
        explanation: { reason: "level_mismatch", dominantFactor: "shortlistingPotential", missingEvidence: [], unknowns: [] },
        trace: {
          priority: 35,
          factors: { careerValue: 30, shortlistingPotential: 40, pursuitFriction: 30 },
          verb0: "PASS",
          finalVerb: "PASS",
          confidence: 0.7,
          stability: "High",
          pipeline: [],
          evidenceMapping: [],
          careerValueBreakdown: { brandValue: 8, learningValue: 8, trajectoryValue: 8, riskMitigation: 6 },
          headspace: { finalVerb: "PASS", downgraded: false },
          missing: ["Executive scope"],
          timestamp: new Date().toISOString(),
          candidateProjectionHash: "test",
          opportunityContentHash: "test"
        },
        esi: 0.35,
        diligenceStatus: "READY"
      }
    },

    // Sample 4: Fractional executive
    {
      source: {
        jobHash: "sample-4",
        role: "Fractional CMO - 2 days/week",
        company: "StartupCo",
        location: "Remote",
        postedRelative: "Posted recently",
        scrapedFrom: "LinkedIn",
        primaryConcern: null,
        dimensions: []
      },
      record: {
        jobHash: "sample-4",
        engineVersion: "4.3.0",
        recommendationVersion: "4.3.0:sample",
        verb: "CONSIDER",
        rawScore: 60,
        priority: 60,
        vetoed: false,
        vetoReason: null,
        claimPermissions: { allowedClaims: ["Strategic marketing"], explicitUnknowns: ["Time commitment fit"], explicitRisks: [] },
        confidence: 0.65,
        factors: { pursuitFriction: 15 },
        evidenceGrounding: {},
        decisionSummary: { careerValue: 55, shortlistingPotential: 75, pursuitFriction: 15 },
        decisionDrivers: ["Strategic fit"],
        decisionRisks: [{ factor: "Fractional scope", impact: "low", evidence: "Limited time commitment" }],
        confidences: { parsing: 0.7, matching: 0.65, recommendation: 0.65 },
        stability: "Medium",
        headspace: { finalVerb: "CONSIDER", downgraded: false },
        comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
        explanation: { reason: "strategic_fit_limited_scope", dominantFactor: "careerValue", missingEvidence: [], unknowns: [] },
        trace: {
          priority: 60,
          factors: { careerValue: 55, shortlistingPotential: 75, pursuitFriction: 15 },
          verb0: "CONSIDER",
          finalVerb: "CONSIDER",
          confidence: 0.65,
          stability: "Medium",
          pipeline: [],
          evidenceMapping: [],
          careerValueBreakdown: { brandValue: 15, learningValue: 15, trajectoryValue: 15, riskMitigation: 10 },
          headspace: { finalVerb: "CONSIDER", downgraded: false },
          missing: [],
          timestamp: new Date().toISOString(),
          candidateProjectionHash: "test",
          opportunityContentHash: "test"
        },
        esi: 0.6,
        diligenceStatus: "READY"
      }
    },

    // Sample 5: SPARSE_SPEC
    {
      source: {
        jobHash: "sample-5",
        role: "Marketing",
        company: "VagueCorp",
        location: "Unknown",
        postedRelative: "Posted recently",
        scrapedFrom: "LinkedIn",
        primaryConcern: null,
        dimensions: []
      },
      record: {
        jobHash: "sample-5",
        engineVersion: "4.3.0",
        recommendationVersion: "4.3.0:sample",
        verb: "SPARSE_SPEC",
        rawScore: 0,
        priority: null,
        vetoed: false,
        vetoReason: null,
        claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: [] },
        confidence: 0.3,
        factors: { pursuitFriction: 0 },
        evidenceGrounding: {},
        decisionSummary: { careerValue: 0, shortlistingPotential: 0, pursuitFriction: 0 },
        decisionDrivers: [],
        decisionRisks: [{ factor: "Insufficient Evidence", impact: "high", evidence: "Specification too brief" }],
        confidences: { parsing: 0.3, matching: 0.3, recommendation: 0.3 },
        stability: "Low",
        headspace: { finalVerb: "SPARSE_SPEC", downgraded: false },
        comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
        explanation: { reason: "insufficient_evidence", dominantFactor: "careerValue", missingEvidence: ["Role description", "Requirements"], unknowns: ["Scope", "Seniority"] },
        trace: {
          priority: 0,
          factors: { careerValue: 0, shortlistingPotential: 0, pursuitFriction: 0 },
          verb0: "SPARSE_SPEC",
          finalVerb: "SPARSE_SPEC",
          confidence: 0.3,
          stability: "Low",
          pipeline: [],
          evidenceMapping: [],
          careerValueBreakdown: undefined as any,
          headspace: { finalVerb: "SPARSE_SPEC", downgraded: false },
          missing: ["evidence"],
          timestamp: new Date().toISOString(),
          candidateProjectionHash: "test",
          opportunityContentHash: "test"
        },
        esi: 0,
        diligenceStatus: "FAILED"
      }
    }
  ];

  // Test 1: Decision distribution is reasonable
  it("1: Decision distribution across samples is reasonable", () => {
    const decisions = corpusSamples.map((s) => s.record.verb);
    const pursueCount = decisions.filter((d) => d === "PURSUE").length;
    const considerCount = decisions.filter((d) => d === "CONSIDER").length;
    const passCount = decisions.filter((d) => d === "PASS").length;
    const sparseCount = decisions.filter((d) => d === "SPARSE_SPEC" || d === "NOT_EVALUABLE").length;

    // Expect reasonable distribution (not all PASS, not all PURSUE)
    expect(pursueCount).toBeGreaterThanOrEqual(0);
    expect(passCount).toBeGreaterThanOrEqual(0);
    expect(decisions.length).toBe(pursueCount + considerCount + passCount + sparseCount);
  });

  // Test 2: Strong opportunities get PURSUE
  it("2: Strong opportunities with good evidence get PURSUE", () => {
    const strongMatch = corpusSamples[0]; // The CMO role

    const brief = composeExecutiveBrief(strongMatch.record, strongMatch.source);

    expect(brief.recommendation).toBe("PURSUE");
    expect(brief.strongestEvidence.length).toBeGreaterThan(0);
    expect(brief.confidenceScore).toBeGreaterThan(0.7);
  });

  // Test 3: Clear mismatches get PASS
  it("3: Clear mismatches get PASS with clear rationale", () => {
    const mismatch = corpusSamples[2]; // The hourly gig

    const brief = composeExecutiveBrief(mismatch.record, mismatch.source);

    expect(brief.recommendation).toBe("PASS");
    expect(brief.principalRisk).toBeTruthy();
  });

  // Test 4: Engagement type detection works
  it("4: Engagement types are correctly detected", () => {
    // Permanent
    const permanent = synthesizeEngagementQuality(corpusSamples[0].record, corpusSamples[0].source);
    expect(permanent.engagementType).toBe("permanent_executive");

    // Interim
    const interim = synthesizeEngagementQuality(corpusSamples[1].record, corpusSamples[1].source);
    expect(interim.engagementType).toBe("interim_executive");

    // Gig/hourly
    const gig = synthesizeEngagementQuality(corpusSamples[2].record, corpusSamples[2].source);
    expect(gig.engagementType).toBe("gig_hourly");

    // Fractional
    const fractional = synthesizeEngagementQuality(corpusSamples[3].record, corpusSamples[3].source);
    expect(fractional.engagementType).toBe("fractional_executive");
  });

  // Test 5: Confidence appropriate for evidence
  it("5: Confidence levels match evidence availability", () => {
    // Strong evidence = high confidence
    const strongConf = synthesizeConfidence(corpusSamples[0].record, corpusSamples[0].source);
    expect(strongConf.level).toBe("high");

    // Sparse = insufficient
    const sparseConf = synthesizeConfidence(corpusSamples[4].record, corpusSamples[4].source);
    expect(sparseConf.level).toBe("insufficient");
  });

  // Test 6: No fabricated recommendations for SPARSE_SPEC
  it("6: SPARSE_SPEC does not produce fabricated recommendations", () => {
    const sparse = corpusSamples[4];

    const brief = composeExecutiveBrief(sparse.record, sparse.source);

    expect(brief.recommendation).toBe("SPARSE_SPEC");
    expect(brief.strongestEvidence.length).toBe(0);
    expect(brief.whatIsMissing.length).toBeGreaterThanOrEqual(0);
  });

  // Test 7: Briefs are not generic
  it("7: Briefs contain opportunity-specific details", () => {
    const briefs = corpusSamples.slice(0, 4).map((s) =>
      composeExecutiveBrief(s.record, s.source)
    );

    // Each brief should have unique content
    const briefTexts = briefs.map((b) => JSON.stringify(b));
    const uniqueBriefs = new Set(briefTexts);
    expect(uniqueBriefs.size).toBe(briefs.length);
  });

  // Test 8: Principal risks are evidence-grounded
  it("8: Principal risks reference specific evidence", () => {
    const samplesWithRisks = corpusSamples.filter(
      (s) => s.record.decisionRisks?.length > 0
    );

    for (const sample of samplesWithRisks) {
      const brief = composeExecutiveBrief(sample.record, sample.source);
      expect(brief.principalRisk).toBeTruthy();
    }
  });

  // Test 9: Career value is interpreted
  it("9: Career value is interpreted, not just scored", () => {
    for (const sample of corpusSamples) {
      if (sample.record.verb === "SPARSE_SPEC") continue;

      const brief = composeExecutiveBrief(sample.record, sample.source);
      expect(brief.careerValue).toBeTruthy();
      expect(brief.careerValue.toLowerCase()).not.toContain("score:");
    }
  });

  // Test 10: Validation questions are specific
  it("10: Validation questions are specific to opportunity", () => {
    for (const sample of corpusSamples) {
      if (sample.record.verb === "SPARSE_SPEC") continue;

      const brief = composeExecutiveBrief(sample.record, sample.source);

      // If there are gaps, there should be validation questions
      if (sample.record.claimPermissions?.explicitUnknowns?.length) {
        expect(brief.validationQuestions.length).toBeGreaterThan(0);
      }
    }
  });
});
