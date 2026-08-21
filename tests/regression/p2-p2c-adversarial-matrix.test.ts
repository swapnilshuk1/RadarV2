/**
 * P2-C Adversarial Test Matrix
 *
 * Validates that the three signals are genuinely independent by creating
 * scenarios where each signal varies independently.
 *
 * A. HIGH Career Value + LOW Shortlisting Potential + LOW Friction
 * B. LOW Career Value + HIGH Shortlisting Potential + LOW Friction
 * C. HIGH Career Value + HIGH Shortlisting Potential + HIGH Friction
 * D. LOW Career Value + LOW Shortlisting Potential + HIGH Friction
 * E. HIGH Career Value + HIGH Shortlisting Potential + LOW Friction
 */

import { describe, it, expect } from "vitest";
import { synthesizeCareerValue } from "@/lib/intelligence/editorial/CareerValueSynthesizer";
import { synthesizeShortlistingPotential } from "@/lib/intelligence/editorial/ShortlistingPotentialSynthesizer";
import { synthesizeEffort } from "@/lib/intelligence/editorial/EffortSynthesizer";
import type { RecommendationRecord } from "@/lib/intelligence/record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";

describe("P2-C Adversarial Test Matrix", () => {
  // Base template
  const createBaseRecord = (): RecommendationRecord => ({
    jobHash: "test",
    engineVersion: "4.3.0",
    recommendationVersion: "4.3.0:test",
    verb: "CONSIDER",
    rawScore: 60,
    priority: 60,
    vetoed: false,
    vetoReason: null,
    claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: [] },
    confidence: 0.75,
    factors: { pursuitFriction: 10 },
    evidenceGrounding: {},
    decisionSummary: { careerValue: 60, shortlistingPotential: 60, pursuitFriction: 10 },
    decisionDrivers: [],
    decisionRisks: [],
    confidences: { parsing: 0.8, matching: 0.75, recommendation: 0.75 },
    stability: "Medium",
    headspace: { finalVerb: "CONSIDER", downgraded: false },
    comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
    explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
    trace: {
      priority: 60,
      factors: { careerValue: 60, shortlistingPotential: 60, pursuitFriction: 10 },
      verb0: "CONSIDER",
      finalVerb: "CONSIDER",
      confidence: 0.75,
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
  });

  const baseSource: OpportunitySource = {
    jobHash: "test",
    role: "VP Marketing",
    company: "TestCorp",
    location: "Mumbai",
    postedRelative: "Posted recently",
    scrapedFrom: "LinkedIn",
    primaryConcern: null,
    dimensions: []
  };

  // Test A: HIGH CV + LOW SP + LOW Friction
  // Scenario: Reach role - great career move, but uncertain shortlisting, easy to pursue
  it("A: HIGH Career Value + LOW Shortlisting + LOW Friction (Reach role)", () => {
    const record: RecommendationRecord = {
      ...createBaseRecord(),
      // HIGH CV: Big promotion, transformation scope
      trace: {
        ...createBaseRecord().trace,
        factors: { careerValue: 85, shortlistingPotential: 45, pursuitFriction: 5, tailoringEffort: "LOW" },
        careerValueBreakdown: {
          titleProgression: { value: 0.9, reason: "Promotion to CMO", status: "KNOWN" },
          scopeExpansion: { value: 0.85, reason: "Executive scope", status: "KNOWN" },
          commercialScale: { value: 0.9, reason: "P&L ownership", status: "KNOWN" },
          brandSignal: { value: 0.8, reason: "Tier 1", status: "KNOWN" },
          futureOptionality: { value: 0.85, reason: "CEO path", status: "ESTIMATED" }
        },
        // LOW SP: Only partial evidence, aspirational
        evidenceMapping: [
          { jobCapability: "Strategy [CORE_MANDATE]", candidateCapability: "Led strategy", confidence: 0.6, reason: "Partial" }
        ]
      },
      // LOW Friction: Few gaps to bridge
      claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: [] },
      decisionSummary: { careerValue: 85, shortlistingPotential: 45, pursuitFriction: 5 }
    };

    const cv = synthesizeCareerValue(record, baseSource);
    const sp = synthesizeShortlistingPotential(record, baseSource);
    const effort = synthesizeEffort(record, baseSource);

    expect(cv.valueScore).toBeGreaterThan(75); // HIGH CV
    expect(sp.score).toBeLessThan(75); // Moderate/Low SP (not highest tier)
    expect(effort.effortLevel).toBe("low"); // LOW Friction

    console.log(`A: CV=${cv.valueScore}, SP=${sp.score}, Friction=${effort.effortLevel}`);
  });

  // Test B: LOW CV + HIGH SP + LOW Friction
  // Scenario: Lateral move - not advancing career, but strong fit, easy pursuit
  it("B: LOW Career Value + HIGH Shortlisting + LOW Friction (Easy lateral)", () => {
    const record: RecommendationRecord = {
      ...createBaseRecord(),
      // LOW CV: Lateral, similar scope
      trace: {
        ...createBaseRecord().trace,
        factors: { careerValue: 55, shortlistingPotential: 85, pursuitFriction: 5, tailoringEffort: "LOW" },
        careerValueBreakdown: {
          titleProgression: { value: 0.65, reason: "Lateral VP", status: "KNOWN" },
          scopeExpansion: { value: 0.5, reason: "Similar scope", status: "KNOWN" },
          commercialScale: { value: 0.6, reason: "Similar P&L", status: "KNOWN" },
          brandSignal: { value: 0.5, reason: "Similar tier", status: "KNOWN" },
          futureOptionality: { value: 0.55, reason: "Standard", status: "ESTIMATED" }
        },
        // HIGH SP: Strong evidence, good fit
        evidenceMapping: [
          { jobCapability: "Marketing [CORE_MANDATE]", candidateCapability: "Led marketing", confidence: 0.9, reason: "Strong" },
          { jobCapability: "Leadership [EXECUTION_CAPABILITY]", candidateCapability: "Led teams", confidence: 0.85, reason: "Strong" }
        ]
      },
      // LOW Friction: No gaps
      claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: [] },
      decisionSummary: { careerValue: 55, shortlistingPotential: 85, pursuitFriction: 5 }
    };

    const cv = synthesizeCareerValue(record, baseSource);
    const sp = synthesizeShortlistingPotential(record, baseSource);
    const effort = synthesizeEffort(record, baseSource);

    expect(cv.valueScore).toBeLessThan(65); // LOW CV
    expect(sp.score).toBeGreaterThan(75); // HIGH SP
    expect(effort.effortLevel).toBe("low"); // LOW Friction

    console.log(`B: CV=${cv.valueScore}, SP=${sp.score}, Friction=${effort.effortLevel}`);
  });

  // Test C: HIGH CV + HIGH SP + HIGH Friction
  // Scenario: Stretch role worth the effort - great move, good chance, but needs work
  it("C: HIGH Career Value + HIGH Shortlisting + HIGH Friction (Stretch worth effort)", () => {
    const record: RecommendationRecord = {
      ...createBaseRecord(),
      verb: "CONSIDER",
      // HIGH CV: Promotion with scope
      trace: {
        ...createBaseRecord().trace,
        factors: { careerValue: 82, shortlistingPotential: 78, pursuitFriction: 25, tailoringEffort: "HIGH" },
        careerValueBreakdown: {
          titleProgression: { value: 0.85, reason: "Promotion", status: "KNOWN" },
          scopeExpansion: { value: 0.8, reason: "Expanded scope", status: "KNOWN" },
          commercialScale: { value: 0.85, reason: "Greater P&L", status: "KNOWN" },
          brandSignal: { value: 0.85, reason: "Tier 1", status: "KNOWN" },
          futureOptionality: { value: 0.8, reason: "Enhanced", status: "ESTIMATED" }
        },
        // HIGH SP: Good evidence
        evidenceMapping: [
          { jobCapability: "Transformation [CORE_MANDATE]", candidateCapability: "Led transformation", confidence: 0.88, reason: "Strong" },
          { jobCapability: "Leadership [CORE_MANDATE]", candidateCapability: "Led teams", confidence: 0.85, reason: "Strong" }
        ]
      },
      // HIGH Friction: Multiple gaps to bridge
      claimPermissions: {
        allowedClaims: [],
        explicitUnknowns: [
          "Healthcare [DOMAIN_FAMILIARITY]",
          "Regulatory [DOMAIN_FAMILIARITY]"
        ],
        explicitRisks: []
      },
      decisionSummary: { careerValue: 82, shortlistingPotential: 78, pursuitFriction: 25 }
    };

    const cv = synthesizeCareerValue(record, baseSource);
    const sp = synthesizeShortlistingPotential(record, baseSource);
    const effort = synthesizeEffort(record, baseSource);

    expect(cv.valueScore).toBeGreaterThan(75); // HIGH CV
    expect(sp.score).toBeGreaterThan(70); // HIGH SP
    expect(effort.effortLevel).toBe("high"); // HIGH Friction

    console.log(`C: CV=${cv.valueScore}, SP=${sp.score}, Friction=${effort.effortLevel}`);
  });

  // Test D: LOW CV + LOW SP + HIGH Friction
  // Scenario: Poor fit all around - not advancing, hard to get shortlisted, difficult pursuit
  it("D: LOW Career Value + LOW Shortlisting + HIGH Friction (Poor fit)", () => {
    const record: RecommendationRecord = {
      ...createBaseRecord(),
      verb: "PASS",
      vetoed: true,
      vetoReason: "G-COMPATIBILITY-REGRESSION-VETO",
      // LOW CV: Regression
      trace: {
        ...createBaseRecord().trace,
        factors: { careerValue: 35, shortlistingPotential: 40, pursuitFriction: 30, tailoringEffort: "HIGH" },
        careerValueBreakdown: {
          titleProgression: { value: 0.3, reason: "Title regression", status: "KNOWN" },
          scopeExpansion: { value: 0.3, reason: "Narrower scope", status: "KNOWN" },
          commercialScale: { value: 0.35, reason: "Lesser P&L", status: "KNOWN" },
          brandSignal: { value: 0.4, reason: "Weaker brand", status: "KNOWN" },
          futureOptionality: { value: 0.3, reason: "Reduced", status: "ESTIMATED" }
        },
        // LOW SP: Weak evidence
        evidenceMapping: [
          { jobCapability: "Execution [CORE_MANDATE]", candidateCapability: "Some exposure", confidence: 0.45, reason: "Weak" }
        ]
      },
      // HIGH Friction: Many gaps
      claimPermissions: {
        allowedClaims: [],
        explicitUnknowns: [
          "Core Mandate [CORE_MANDATE]",
          "P&L [CORE_MANDATE]",
          "Industry [DOMAIN_FAMILIARITY]"
        ],
        explicitRisks: []
      },
      decisionSummary: { careerValue: 35, shortlistingPotential: 40, pursuitFriction: 30 }
    };

    const cv = synthesizeCareerValue(record, baseSource);
    const sp = synthesizeShortlistingPotential(record, baseSource);
    const effort = synthesizeEffort(record, baseSource);

    expect(cv.valueScore).toBeLessThan(50); // LOW CV
    expect(sp.score).toBeLessThan(60); // LOW SP
    expect(effort.effortLevel).toBe("high"); // HIGH Friction

    console.log(`D: CV=${cv.valueScore}, SP=${sp.score}, Friction=${effort.effortLevel}`);
  });

  // Test E: HIGH CV + HIGH SP + LOW Friction
  // Scenario: Ideal natural progression - great move, good chance, easy pursuit
  it("E: HIGH Career Value + HIGH Shortlisting + LOW Friction (Natural fit)", () => {
    const record: RecommendationRecord = {
      ...createBaseRecord(),
      verb: "PURSUE",
      // HIGH CV: Natural promotion
      trace: {
        ...createBaseRecord().trace,
        factors: { careerValue: 88, shortlistingPotential: 88, pursuitFriction: 5, tailoringEffort: "LOW" },
        careerValueBreakdown: {
          titleProgression: { value: 0.88, reason: "Promotion to CMO", status: "KNOWN" },
          scopeExpansion: { value: 0.85, reason: "Executive scope", status: "KNOWN" },
          commercialScale: { value: 0.9, reason: "P&L ownership", status: "KNOWN" },
          brandSignal: { value: 0.88, reason: "Strong brand", status: "KNOWN" },
          futureOptionality: { value: 0.88, reason: "Enhanced", status: "ESTIMATED" }
        },
        // HIGH SP: Strong evidence
        evidenceMapping: [
          { jobCapability: "Growth [CORE_MANDATE]", candidateCapability: "Led growth", confidence: 0.92, reason: "Exceptional" },
          { jobCapability: "Leadership [CORE_MANDATE]", candidateCapability: "Led teams", confidence: 0.9, reason: "Strong" },
          { jobCapability: "Strategy [CORE_MANDATE]", candidateCapability: "Led strategy", confidence: 0.88, reason: "Strong" }
        ]
      },
      // LOW Friction: No gaps
      claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: [] },
      decisionSummary: { careerValue: 88, shortlistingPotential: 88, pursuitFriction: 5 }
    };

    const cv = synthesizeCareerValue(record, baseSource);
    const sp = synthesizeShortlistingPotential(record, baseSource);
    const effort = synthesizeEffort(record, baseSource);

    expect(cv.valueScore).toBeGreaterThan(80); // HIGH CV
    expect(sp.score).toBeGreaterThan(80); // HIGH SP
    expect(effort.effortLevel).toBe("low"); // LOW Friction

    console.log(`E: CV=${cv.valueScore}, SP=${sp.score}, Friction=${effort.effortLevel}`);
  });
});
