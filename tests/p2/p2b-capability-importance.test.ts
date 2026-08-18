/**
 * P2-B: Capability Importance Tests
 *
 * Acceptance Contract:
 * - Identifies which capability tier matters most for the opportunity
 * - Explains what the role fundamentally requires
 * - Identifies strongest alignment
 * - Separates material gaps from peripheral gaps
 * - Uses existing capability taxonomy
 * - Does not change scoring or decision semantics
 */

import { describe, it, expect } from "vitest";
import type { RecommendationRecord } from "@/lib/intelligence/record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";
import {
  synthesizeCapabilityImportance,
  formatCapabilityImportance,
  type CapabilityImportanceProfile,
} from "@/lib/intelligence/editorial/CapabilityImportanceSynthesizer";

describe("P2-B: Capability Importance", () => {
  // Base mock record
  const baseMockRecord: RecommendationRecord = {
    jobHash: "test-cap-importance",
    engineVersion: "4.3.0",
    recommendationVersion: "4.3.0:test",
    verb: "PURSUE",
    rawScore: 80,
    priority: 80,
    vetoed: false,
    vetoReason: null,
    claimPermissions: {
      allowedClaims: [],
      explicitUnknowns: [],
      explicitRisks: []
    },
    confidence: 0.85,
    factors: { pursuitFriction: 10 },
    evidenceGrounding: {},
    decisionSummary: { careerValue: 80, shortlistingPotential: 75, pursuitFriction: 10 },
    decisionDrivers: [{ factor: "Strong Match", impact: "positive", strength: "high", evidence: "Complete alignment" }],
    decisionRisks: [],
    confidences: { parsing: 0.88, matching: 0.85, recommendation: 0.85 },
    stability: "High",
    headspace: { finalVerb: "PURSUE", downgraded: false },
    comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
    explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
    trace: {
      priority: 80,
      factors: { careerValue: 80, shortlistingPotential: 75, pursuitFriction: 10 },
      verb0: "PURSUE",
      finalVerb: "PURSUE",
      confidence: 0.85,
      stability: "High",
      pipeline: [],
      evidenceMapping: [],
      careerValueBreakdown: { brandValue: 20, learningValue: 20, trajectoryValue: 20, riskMitigation: 15 },
      headspace: { finalVerb: "PURSUE", downgraded: false },
      missing: [],
      timestamp: new Date().toISOString(),
      candidateProjectionHash: "test",
      opportunityContentHash: "test"
    },
    esi: 0.78,
    diligenceStatus: "READY"
  };

  const baseMockSource: OpportunitySource = {
    jobHash: "test-cap-importance",
    role: "VP Marketing",
    company: "GrowthCorp",
    location: "Mumbai",
    postedRelative: "Posted recently",
    scrapedFrom: "LinkedIn",
    primaryConcern: null,
    dimensions: []
  };

  // Test 1: Core-mandate dominant role identified
  it("1: Identifies core-mandate dominant opportunities", () => {
    const record: RecommendationRecord = {
      ...baseMockRecord,
      trace: {
        ...baseMockRecord.trace,
        evidenceMapping: [
          { jobCapability: "CRM Strategy [CORE_MANDATE]", candidateCapability: "Led CRM transformation", confidence: 0.9, reason: "Strong match" },
          { jobCapability: "Growth Leadership [CORE_MANDATE]", candidateCapability: "Scaled growth 3x", confidence: 0.85, reason: "Direct evidence" }
        ]
      }
    };

    const profile = synthesizeCapabilityImportance(record, baseMockSource);

    expect(profile.primaryTier).toBe("core_mandate");
    expect(profile.fundamentalRequirements.toLowerCase()).toContain("crm strategy");
    expect(profile.strongestAlignment.toLowerCase()).toContain("core mandate");
    expect(profile.confidence).toBeGreaterThan(0.8);
  });

  // Test 2: Execution-heavy role identified
  it("2: Identifies execution-heavy opportunities", () => {
    const record: RecommendationRecord = {
      ...baseMockRecord,
      trace: {
        ...baseMockRecord.trace,
        evidenceMapping: [
          { jobCapability: "CRM Strategy [CORE_MANDATE]", candidateCapability: "Led CRM", confidence: 0.6, reason: "Partial" },
          { jobCapability: "Team Management [EXECUTION_CAPABILITY]", candidateCapability: "Led 40-person team", confidence: 0.85, reason: "Strong" },
          { jobCapability: "Budget Planning [EXECUTION_CAPABILITY]", candidateCapability: "Managed budgets", confidence: 0.8, reason: "Strong" },
          { jobCapability: "Process Design [EXECUTION_CAPABILITY]", candidateCapability: "Designed processes", confidence: 0.75, reason: "Good" }
        ]
      }
    };

    const profile = synthesizeCapabilityImportance(record, baseMockSource);

    expect(profile.primaryTier).toBe("execution_capability");
    expect(profile.fundamentalRequirements.toLowerCase()).toContain("execution");
    expect(profile.statement.toLowerCase()).toContain("execution");
  });

  // Test 3: Material vs peripheral gaps separated
  it("3: Separates material gaps from peripheral gaps", () => {
    const record: RecommendationRecord = {
      ...baseMockRecord,
      claimPermissions: {
        allowedClaims: [],
        explicitUnknowns: [
          "P&L Ownership [CORE_MANDATE]",
          "Salesforce [TECHNOLOGY_STACK]",
          "Adobe Analytics [TECHNOLOGY_STACK]"
        ],
        explicitRisks: []
      }
    };

    const profile = synthesizeCapabilityImportance(record, baseMockSource);

    // CORE_MANDATE gap should be material
    expect(profile.materialGaps.some(g => g.toLowerCase().includes("p&l"))).toBe(true);

    // TECHNOLOGY_STACK gaps should be peripheral
    expect(profile.peripheralGaps.some(g => g.toLowerCase().includes("salesforce"))).toBe(true);
    expect(profile.peripheralGaps.some(g => g.toLowerCase().includes("adobe"))).toBe(true);
  });

  // Test 4: Strongest alignment identified
  it("4: Identifies strongest evidence alignment", () => {
    const record: RecommendationRecord = {
      ...baseMockRecord,
      trace: {
        ...baseMockRecord.trace,
        evidenceMapping: [
          { jobCapability: "CRM [CORE_MANDATE]", candidateCapability: "Led 13-market Salesforce migration", confidence: 0.95, reason: "Exceptional" },
          { jobCapability: "Analytics [EXECUTION_CAPABILITY]", candidateCapability: "Some exposure", confidence: 0.5, reason: "Weak" }
        ]
      }
    };

    const profile = synthesizeCapabilityImportance(record, baseMockSource);

    expect(profile.strongestAlignment.toLowerCase()).toContain("13-market");
    expect(profile.strongestAlignment.toLowerCase()).toContain("strong");
  });

  // Test 5: Explains what role fundamentally requires
  it("5: Explains fundamental role requirements", () => {
    const record: RecommendationRecord = {
      ...baseMockRecord,
      trace: {
        ...baseMockRecord.trace,
        evidenceMapping: [
          { jobCapability: "Transformation Leadership [CORE_MANDATE]", candidateCapability: "Led transformation", confidence: 0.88, reason: "Strong" }
        ]
      }
    };

    const profile = synthesizeCapabilityImportance(record, baseMockSource);

    expect(profile.fundamentalRequirements.length).toBeGreaterThan(20);
    expect(profile.fundamentalRequirements.toLowerCase()).toContain("fundamentally");
    expect(profile.statement.length).toBeGreaterThan(50);
  });

  // Test 6: Balanced requirements identified
  it("6: Identifies balanced requirement patterns", () => {
    const record: RecommendationRecord = {
      ...baseMockRecord,
      trace: {
        ...baseMockRecord.trace,
        evidenceMapping: [
          // Lower confidence CORE_MANDATE match to avoid triggering "core_mandate" tier
          { jobCapability: "Strategy [CORE_MANDATE]", candidateCapability: "Led strategy", confidence: 0.65, reason: "Partial" },
          // Multiple execution matches
          { jobCapability: "Execution [EXECUTION_CAPABILITY]", candidateCapability: "Led execution", confidence: 0.7, reason: "Good" },
          { jobCapability: "Planning [EXECUTION_CAPABILITY]", candidateCapability: "Led planning", confidence: 0.75, reason: "Good" }
        ]
      }
    };

    const profile = synthesizeCapabilityImportance(record, baseMockSource);

    // Should identify as balanced or execution_heavy
    expect(["balanced", "execution_capability"]).toContain(profile.primaryTier);
  });

  // Test 7: Evidence grounded in capability assessment
  it("7: Evidence grounded in capability matches", () => {
    const record: RecommendationRecord = {
      ...baseMockRecord,
      trace: {
        ...baseMockRecord.trace,
        evidenceMapping: [
          { jobCapability: "CRM [CORE_MANDATE]", candidateCapability: "CRM experience", confidence: 0.9, reason: "Strong" }
        ]
      }
    };

    const profile = synthesizeCapabilityImportance(record, baseMockSource);

    expect(profile.evidence.length).toBeGreaterThan(0);
    const evidenceText = profile.evidence.join(" ").toLowerCase();
    expect(evidenceText).toContain("core");
    expect(evidenceText).toContain("match");
  });

  // Test 8: Missing capabilities handled gracefully
  it("8: Handles missing capability data gracefully", () => {
    const record: RecommendationRecord = {
      ...baseMockRecord,
      claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: [] },
      trace: {
        ...baseMockRecord.trace,
        evidenceMapping: []
      }
    };

    const profile = synthesizeCapabilityImportance(record, baseMockSource);

    // Should not throw
    expect(profile).toBeDefined();
    expect(profile.statement).toBeDefined();
    // Should indicate uncertainty
    expect(profile.confidence).toBeLessThan(0.6);
  });
});

// Edge cases
describe("P2-B: Capability Importance Edge Cases", () => {
  it("formatCapabilityImportance returns statement", () => {
    const profile: CapabilityImportanceProfile = {
      fundamentalRequirements: "Test requirements",
      primaryTier: "core_mandate",
      strongestAlignment: "Strong alignment",
      materialGaps: [],
      peripheralGaps: [],
      statement: "Test capability importance statement",
      evidence: [],
      confidence: 0.8
    };

    expect(formatCapabilityImportance(profile)).toBe("Test capability importance statement");
  });

  it("getCapabilityTierIndicator returns correct labels", async () => {
    const { getCapabilityTierIndicator } = await import("@/lib/intelligence/editorial/CapabilityImportanceSynthesizer");

    const core: CapabilityImportanceProfile = {
      fundamentalRequirements: "",
      primaryTier: "core_mandate",
      strongestAlignment: "",
      materialGaps: [],
      peripheralGaps: [],
      statement: "",
      evidence: [],
      confidence: 0.8
    };
    expect(getCapabilityTierIndicator(core).label).toBe("Core Mandate Focus");

    const execution: CapabilityImportanceProfile = {
      fundamentalRequirements: "",
      primaryTier: "execution_capability",
      strongestAlignment: "",
      materialGaps: [],
      peripheralGaps: [],
      statement: "",
      evidence: [],
      confidence: 0.8
    };
    expect(getCapabilityTierIndicator(execution).label).toBe("Execution Heavy");

    const balanced: CapabilityImportanceProfile = {
      fundamentalRequirements: "",
      primaryTier: "balanced",
      strongestAlignment: "",
      materialGaps: [],
      peripheralGaps: [],
      statement: "",
      evidence: [],
      confidence: 0.8
    };
    expect(getCapabilityTierIndicator(balanced).label).toBe("Balanced Requirements");
  });
});
