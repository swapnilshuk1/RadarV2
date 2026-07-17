import { describe, it, expect, beforeEach } from "vitest";
import { CapabilityRecommendationScorer, type RecommendationPolicyConfig } from "../src/lib/recommendation/CapabilityRecommendationScorer";
import { type EvaluatedCapability } from "../src/lib/capability/CapabilityEngine";

describe("CapabilityRecommendationScorer Invariant Tests", () => {
  let scorer: CapabilityRecommendationScorer;

  const mockCapabilities: EvaluatedCapability[] = [
    {
      id: "cap_crm_strategy",
      name: "CRM & Customer Retention Strategy",
      strength: "Strong",
      confidence: 0.95,
      supportingEvidence: [
        {
          dimension: "technologyStack",
          quote: "Expert knowledge of Salesforce is required.",
          matchedValue: "Salesforce",
          confidence: 0.95,
        },
      ],
      sourceDimensions: ["technologyStack"],
      score: 0.8,
    },
    {
      id: "cap_executive_growth_scale",
      name: "Executive Growth & Scale Mandate",
      strength: "Moderate",
      confidence: 0.90,
      supportingEvidence: [
        {
          dimension: "mandate",
          quote: "Tasked with scaling operations 10x.",
          matchedValue: "SCALE",
          confidence: 0.90,
        },
      ],
      sourceDimensions: ["mandate"],
      score: 0.6,
    },
  ];

  beforeEach(() => {
    scorer = new CapabilityRecommendationScorer();
  });

  // ============================================================================
  // 1. Policy Regression Invariant
  // ============================================================================
  it("should enforce that changing a capability weight only affects assessments involving that capability", () => {
    const originalPolicy = scorer.getPolicy();

    // CRM Strategy is in mockCapabilities, Business Turnaround is absent
    const results1 = scorer.score(mockCapabilities);

    // Create a modified policy changing ONLY cap_business_turnaround weight (unused/absent in inputs)
    const modifiedPolicy1: RecommendationPolicyConfig = {
      ...originalPolicy,
      weights: {
        ...originalPolicy.weights,
        cap_business_turnaround: 50, // Changed from 30
      },
    };

    const results2 = scorer.score(mockCapabilities, modifiedPolicy1);

    // Business Turnaround is absent (score 0), so changing its weight should ONLY affect normalized total score
    // because total sum(weights) changed, but individual capability results (CRM, Scale) should have identical scores and metadata!
    const crmResult1 = results1.capabilityResults.find(c => c.capabilityId === "cap_crm_strategy")!;
    const crmResult2 = results2.capabilityResults.find(c => c.capabilityId === "cap_crm_strategy")!;

    expect(crmResult1.score).toBe(crmResult2.score);
    expect(crmResult1.weightedContribution).toBe(crmResult2.weightedContribution);

    const scaleResult1 = results1.capabilityResults.find(c => c.capabilityId === "cap_executive_growth_scale")!;
    const scaleResult2 = results2.capabilityResults.find(c => c.capabilityId === "cap_executive_growth_scale")!;

    expect(scaleResult1.score).toBe(scaleResult2.score);
    expect(scaleResult1.weightedContribution).toBe(scaleResult2.weightedContribution);
  });

  // ============================================================================
  // 2. Monotonicity Invariant
  // ============================================================================
  it("should enforce that improving a capability score never decreases the overall recommendation score", () => {
    const resultsBaseline = scorer.score(mockCapabilities);

    // Construct upgraded capabilities (CRM strategy score moves from 0.8 to 1.0)
    const upgradedCapabilities: EvaluatedCapability[] = mockCapabilities.map(c => {
      if (c.id === "cap_crm_strategy") {
        return { ...c, score: 1.0, strength: "Strong" };
      }
      return c;
    });

    const resultsUpgraded = scorer.score(upgradedCapabilities);

    expect(resultsUpgraded.score).toBeGreaterThanOrEqual(resultsBaseline.score);
  });

  // ============================================================================
  // 3. Policy Compatibility Invariant
  // ============================================================================
  it("should succeed in evaluating older recommendation policies against current capability profiles if identifiers are unchanged", () => {
    // Construct old policy from v0.9 (different weights/threshold structures)
    const oldPolicy: RecommendationPolicyConfig = {
      id: "policy_executive_legacy_v0.9",
      version: "0.9.0",
      description: "Legacy beta weights.",
      author: "RADAR Founders",
      created: "2026-01-01T00:00:00Z",
      weights: {
        cap_crm_strategy: 10,
        cap_executive_growth_scale: 10,
      },
      decisionThresholds: {
        Excellent: [90, 101],
        Good: [70, 90],
        Average: [50, 70],
        "Weak Fit": [20, 50],
        "Needs More Evidence": [0, 20],
      },
    };

    const results = scorer.score(mockCapabilities, oldPolicy);

    expect(results.policyId).toBe("policy_executive_legacy_v0.9");
    expect(results.score).toBe(70); // ((0.8 * 10) + (0.6 * 10)) / 20 * 100 = 70%
    expect(results.decision).toBe("Good"); // 70 is inside Good range [70, 90)
  });

  // ============================================================================
  // 4. Absolute Determinism Invariant
  // ============================================================================
  it("should produce 100% identical scores, decision labels, ordered lists, and explanations across repeated runs", () => {
    const run1 = scorer.score(mockCapabilities);
    const run2 = scorer.score(mockCapabilities);

    expect(run1.score).toBe(run2.score);
    expect(run1.decision).toBe(run2.decision);
    expect(run1.explanation).toBe(run2.explanation);
    expect(run1.policyId).toBe(run2.policyId);
    expect(run1.policyVersion).toBe(run2.policyVersion);

    expect(run1.capabilityResults.length).toBe(run2.capabilityResults.length);
    for (let i = 0; i < run1.capabilityResults.length; i++) {
      const cr1 = run1.capabilityResults[i];
      const cr2 = run2.capabilityResults[i];

      expect(cr1.capabilityId).toBe(cr2.capabilityId);
      expect(cr1.capabilityName).toBe(cr2.capabilityName);
      expect(cr1.score).toBe(cr2.score);
      expect(cr1.strength).toBe(cr2.strength);
      expect(cr1.weight).toBe(cr2.weight);
      expect(cr1.weightedContribution).toBe(cr2.weightedContribution);
    }
  });
});
