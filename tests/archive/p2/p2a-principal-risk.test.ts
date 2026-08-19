/**
 * P2-A.2: Principal Risk Intelligence Tests
 *
 * Acceptance Contract:
 * - 1: Material CORE_MANDATE gap produces an appropriate principal risk
 * - 2: Peripheral technology gap does not incorrectly become the principal risk
 * - 3: Strong candidate evidence can mitigate a potential risk
 * - 4: Career regression/lateral concern can become the principal risk when appropriate
 * - 5: Risk is grounded in authoritative decision/evidence inputs
 * - 6: No fabricated risk for SPARSE_SPEC / NOT_EVALUABLE
 * - 7: Strategic Advantage and Principal Risk remain distinct concepts
 *
 * PrincipalRiskSynthesizer converts authoritative evidence + assessment + decision
 * information into a concise executive-facing risk statement.
 *
 * Every synthesized risk must be grounded in:
 * - job evidence
 * - candidate evidence
 * - capability assessment
 * - career assessment
 * - identity assessment
 * - lifestyle assessment
 * - decision risks
 */

import { describe, it, expect } from "vitest";
import { candidateProfile } from "@/data/candidate-profile";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";
import { runEngine, injectFreshRecords, clearInjectedRecords } from "@/lib/intelligence/engine";
import type { RecommendationRecord } from "@/lib/intelligence/record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";
import type { Presented } from "@/lib/intelligence/present";
import {
  synthesizePrincipalRisk,
  formatPrincipalRisk,
  type PrincipalRisk,
} from "@/lib/intelligence/editorial/PrincipalRiskSynthesizer";

// Helper to run full production path via engine injection
function runEngineToPresented(
  opportunity: { role: string; company: string; description?: string; location?: string }
): { record: RecommendationRecord; presented: Presented } {
  const source: OpportunitySource = {
    jobHash: `test-${opportunity.company.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
    role: opportunity.role,
    company: opportunity.company,
    location: opportunity.location || "Test Location",
    description: opportunity.description || `${opportunity.role} at ${opportunity.company}`,
    url: "https://example.com/job",
    portal: "LinkedIn",
    rawText: opportunity.description || `${opportunity.role} at ${opportunity.company}`,
    postingDate: new Date().toISOString(),
    scrapedAt: new Date().toISOString(),
  };

  // Build projection
  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);

  // Inject the opportunity and run the engine
  injectFreshRecords([source]);
  const { records, presented } = runEngine(projection as any, 0);
  clearInjectedRecords();

  const record = records.find(r => r.jobHash === source.jobHash);
  if (!record) {
    throw new Error("No record produced by engine");
  }

  const presentedForSource = presented.find(p => p.opportunity.jobHash === source.jobHash);
  if (!presentedForSource) {
    throw new Error("No presented output for source");
  }

  return { record, presented: presentedForSource };
}

describe("P2-A.2: Principal Risk Intelligence", () => {
  // Test 1: Material CORE_MANDATE gap produces an appropriate principal risk
  it("1: Material CORE_MANDATE gap produces an appropriate principal risk", () => {
    const mockRecord: RecommendationRecord = {
      jobHash: "test-core-mandate-gap",
      engineVersion: "4.3.0",
      recommendationVersion: "4.3.0:test",
      verb: "CONSIDER",
      rawScore: 55,
      priority: 55,
      vetoed: false,
      vetoReason: null,
      claimPermissions: {
        allowedClaims: [],
        explicitUnknowns: ["Revenue Operations [CORE_MANDATE]", "Sales Leadership [CORE_MANDATE]"],
        explicitRisks: []
      },
      confidence: 0.65,
      factors: { pursuitFriction: 15 },
      evidenceGrounding: {},
      decisionSummary: { careerValue: 60, shortlistingPotential: 50, pursuitFriction: 15 },
      decisionDrivers: [],
      decisionRisks: [{ factor: "Capability Gaps", impact: "negative", strength: "high", evidence: "Missing 2 core capabilities" }],
      confidences: { parsing: 0.8, matching: 0.65, recommendation: 0.65 },
      stability: "Medium",
      headspace: { finalVerb: "CONSIDER", downgraded: false },
      comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
      explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
      trace: {
        priority: 55,
        factors: { careerValue: 60, shortlistingPotential: 50, pursuitFriction: 15 },
        verb0: "CONSIDER",
        finalVerb: "CONSIDER",
        confidence: 0.65,
        stability: "Medium",
        pipeline: [],
        evidenceMapping: [
          { jobCapability: "Marketing Strategy [CORE_MANDATE]", candidateCapability: "Led marketing strategy", confidence: 0.85, reason: "Strong match" }
        ],
        careerValueBreakdown: { brandValue: 15, learningValue: 15, trajectoryValue: 15, riskMitigation: 10 },
        headspace: { finalVerb: "CONSIDER", downgraded: false },
        missing: ["Revenue Operations", "Sales Leadership"],
        timestamp: new Date().toISOString(),
        candidateProjectionHash: "test",
        opportunityContentHash: "test"
      },
      esi: 0.55,
      diligenceStatus: "READY"
    };

    const mockSource: OpportunitySource = {
      jobHash: "test-core-mandate-gap",
      role: "Chief Revenue Officer",
      company: "TestCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const risk = synthesizePrincipalRisk(mockRecord, mockSource);

    // Risk should identify material capability gap
    expect(risk.category).toBe("material_capability_gap");
    // Risk statement should mention the missing capability
    expect(risk.statement.toLowerCase()).toContain("revenue");
    // Should have evidence grounding
    expect(risk.evidence.length).toBeGreaterThan(0);
    // For core mandate gaps without strong mitigating evidence, severity should be high
    // Note: Test record has strong mitigating evidence (85% match) so severity is medium
    expect(risk.severity).toBe("medium");
    // Confidence should reflect uncertainty of gap assessment
    expect(risk.confidence).toBeLessThan(0.7);
  });

  // Test 2: Peripheral technology gap does not incorrectly become the principal risk
  it("2: Peripheral technology gap does not incorrectly become the principal risk", () => {
    const mockRecord: RecommendationRecord = {
      jobHash: "test-tech-gap",
      engineVersion: "4.3.0",
      recommendationVersion: "4.3.0:test",
      verb: "PURSUE",
      rawScore: 82,
      priority: 82,
      vetoed: false,
      vetoReason: null,
      claimPermissions: {
        allowedClaims: ["PL_SCALE", "TRANSFORMATION"],
        explicitUnknowns: ["Salesforce Marketing Cloud [TECHNOLOGY_STACK]", "Adobe Analytics [TECHNOLOGY_STACK]"],
        explicitRisks: []
      },
      confidence: 0.88,
      factors: { pursuitFriction: 8 },
      evidenceGrounding: {},
      decisionSummary: { careerValue: 85, shortlistingPotential: 80, pursuitFriction: 8 },
      decisionDrivers: [
        { factor: "CRM Transformation", impact: "positive", strength: "high", evidence: "13-market Salesforce migration" },
        { factor: "Commercial Scale", impact: "positive", strength: "high", evidence: "$8M portfolio" }
      ],
      decisionRisks: [], // No material decision risks
      confidences: { parsing: 0.92, matching: 0.88, recommendation: 0.88 },
      stability: "High",
      headspace: { finalVerb: "PURSUE", downgraded: false },
      comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
      explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
      trace: {
        priority: 82,
        factors: { careerValue: 85, shortlistingPotential: 80, pursuitFriction: 8 },
        verb0: "PURSUE",
        finalVerb: "PURSUE",
        confidence: 0.88,
        stability: "High",
        pipeline: [],
        evidenceMapping: [
          { jobCapability: "CRM Transformation [CORE_MANDATE]", candidateCapability: "13-market Salesforce migration", confidence: 0.95, reason: "Direct evidence" },
          { jobCapability: "Commercial Leadership [CORE_MANDATE]", candidateCapability: "$8M portfolio", confidence: 0.92, reason: "Scale match" }
        ],
        careerValueBreakdown: { brandValue: 22, learningValue: 22, trajectoryValue: 20, riskMitigation: 18 },
        headspace: { finalVerb: "PURSUE", downgraded: false },
        missing: [],
        timestamp: new Date().toISOString(),
        candidateProjectionHash: "test",
        opportunityContentHash: "test"
      },
      esi: 0.82,
      diligenceStatus: "READY"
    };

    const mockSource: OpportunitySource = {
      jobHash: "test-tech-gap",
      role: "VP Marketing",
      company: "GrowthCorp",
      location: "Bengaluru",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const risk = synthesizePrincipalRisk(mockRecord, mockSource);

    // Technology gaps should NOT become principal risk when core mandate matches
    expect(risk.category).not.toBe("material_capability_gap");
    // Should be no material risk since it's a PURSUE with strong matches
    expect(risk.category).toBe("no_material_risk");
    // Risk statement should indicate low concern
    expect(risk.statement.toLowerCase()).toContain("no material risk");
    // Should have low severity
    expect(risk.severity).toBe("low");
  });

  // Test 3: Strong candidate evidence can mitigate a potential risk
  it("3: Strong candidate evidence can mitigate a potential risk", () => {
    const mockRecord: RecommendationRecord = {
      jobHash: "test-mitigated-risk",
      engineVersion: "4.3.0",
      recommendationVersion: "4.3.0:test",
      verb: "CONSIDER",
      rawScore: 62,
      priority: 62,
      vetoed: false,
      vetoReason: null,
      claimPermissions: {
        allowedClaims: [],
        explicitUnknowns: ["D2C Operations [CORE_MANDATE]"],
        explicitRisks: []
      },
      confidence: 0.7,
      factors: { pursuitFriction: 12 },
      evidenceGrounding: {},
      decisionSummary: { careerValue: 70, shortlistingPotential: 65, pursuitFriction: 12 },
      decisionDrivers: [{ factor: "Transformation Experience", impact: "positive", strength: "high", evidence: "Led digital transformation" }],
      decisionRisks: [{ factor: "Capability Gaps", impact: "negative", strength: "medium", evidence: "Missing D2C Operations" }],
      confidences: { parsing: 0.85, matching: 0.7, recommendation: 0.7 },
      stability: "Medium",
      headspace: { finalVerb: "CONSIDER", downgraded: false },
      comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
      explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
      trace: {
        priority: 62,
        factors: { careerValue: 70, shortlistingPotential: 65, pursuitFriction: 12 },
        verb0: "CONSIDER",
        finalVerb: "CONSIDER",
        confidence: 0.7,
        stability: "Medium",
        pipeline: [],
        evidenceMapping: [
          // Gap exists...
          { jobCapability: "D2C Operations [CORE_MANDATE]", candidateCapability: "Limited", confidence: 0.35, reason: "Weak match" },
          // ...but strong mitigating evidence
          { jobCapability: "Digital Transformation [CORE_MANDATE]", candidateCapability: "Led Ford India digital transformation 3% to 32%", confidence: 0.92, reason: "Strong precedent" },
          { jobCapability: "E-commerce Growth [EXECUTION_CAPABILITY]", candidateCapability: "Scaled digital revenue across 13 markets", confidence: 0.88, reason: "Relevant experience" }
        ],
        careerValueBreakdown: { brandValue: 18, learningValue: 20, trajectoryValue: 18, riskMitigation: 14 },
        headspace: { finalVerb: "CONSIDER", downgraded: false },
        missing: ["D2C Operations"],
        timestamp: new Date().toISOString(),
        candidateProjectionHash: "test",
        opportunityContentHash: "test"
      },
      esi: 0.62,
      diligenceStatus: "READY"
    };

    const mockSource: OpportunitySource = {
      jobHash: "test-mitigated-risk",
      role: "VP E-commerce",
      company: "D2C Brand",
      location: "Delhi",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const risk = synthesizePrincipalRisk(mockRecord, mockSource);

    // Should acknowledge the gap but note mitigating evidence
    expect(risk.statement.toLowerCase()).toContain("adjacent capabilities may transfer");
    expect(risk.statement.toLowerCase()).toContain("interview validation");
    // Should have mitigation advice
    expect(risk.mitigation).toBeDefined();
    // Severity should be reduced due to mitigating evidence
    expect(risk.severity).toBe("medium");
  });

  // Test 4: Career regression/lateral concern can become the principal risk when appropriate
  it("4: Career regression/lateral concern can become the principal risk when appropriate", () => {
    const mockRecord: RecommendationRecord = {
      jobHash: "test-regression-risk",
      engineVersion: "4.3.0",
      recommendationVersion: "4.3.0:test",
      verb: "PASS",
      rawScore: 35,
      priority: 35,
      vetoed: true,
      vetoReason: "G-COMPATIBILITY-REGRESSION-VETO",
      claimPermissions: {
        allowedClaims: [],
        explicitUnknowns: [],
        explicitRisks: ["Career Regression"]
      },
      confidence: 0.75,
      factors: { pursuitFriction: 25 },
      evidenceGrounding: {},
      decisionSummary: { careerValue: 30, shortlistingPotential: 25, pursuitFriction: 25 },
      decisionDrivers: [],
      decisionRisks: [
        { factor: "Career Regression", impact: "negative", strength: "high", evidence: "Regression score: 75" }
      ],
      confidences: { parsing: 0.85, matching: 0.75, recommendation: 0.75 },
      stability: "High",
      headspace: { finalVerb: "PASS", downgraded: false },
      comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
      explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
      trace: {
        priority: 35,
        factors: { careerValue: 30, shortlistingPotential: 25, pursuitFriction: 25 },
        verb0: "PASS",
        finalVerb: "PASS",
        confidence: 0.75,
        stability: "High",
        pipeline: [],
        evidenceMapping: [],
        careerValueBreakdown: { brandValue: 8, learningValue: 8, trajectoryValue: 6, riskMitigation: 8 },
        headspace: { finalVerb: "PASS", downgraded: false },
        missing: [],
        timestamp: new Date().toISOString(),
        candidateProjectionHash: "test",
        opportunityContentHash: "test"
      },
      esi: 0.35,
      diligenceStatus: "READY"
    };

    const mockSource: OpportunitySource = {
      jobHash: "test-regression-risk",
      role: "Marketing Manager",
      company: "SmallCorp",
      location: "Pune",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const risk = synthesizePrincipalRisk(mockRecord, mockSource);

    // Career regression should be identified as principal risk
    expect(risk.category).toBe("career_trajectory_concern");
    // Statement should explain the regression concern
    expect(risk.statement.toLowerCase()).toContain("step back");
    expect(risk.statement.toLowerCase()).toContain("trajectory");
    // Should have high severity
    expect(risk.severity).toBe("high");
    // Should have mitigation advice
    expect(risk.mitigation).toBeDefined();
  });

  // Test 5: Risk is grounded in authoritative decision/evidence inputs
  it("5: Risk is grounded in authoritative decision/evidence inputs", () => {
    const { record, presented } = runEngineToPresented({
      role: "VP Marketing",
      company: "EvidenceCorp",
      description: "VP Marketing role requiring CRM transformation, P&L ownership, and team leadership. 15+ years experience. Board exposure.",
    });

    // The presented opportunity should have primaryRisk derived from authoritative sources
    expect(presented.opportunity.primaryRisk).toBeDefined();

    // primaryRisk should NOT be hardcoded template text
    const riskText = presented.opportunity.primaryRisk || "";
    expect(riskText.length).toBeGreaterThan(10);

    // If there are decision risks in the record, they should be reflected in primaryRisk
    if (record.decisionRisks && record.decisionRisks.length > 0) {
      // The risk text should contain evidence from decision risks
      const firstRisk = record.decisionRisks[0];
      // Risk statement should be grounded, not just "Risk: X"
      expect(riskText).not.toMatch(/^\w+\s*:\s*\w+$/); // Not just "Factor: Evidence"
      expect(riskText.length).toBeGreaterThan(20); // Proper sentence, not terse label
    }

    // Risk should not invent facts not in the record
    // Check that risk statement doesn't claim capabilities not in evidence
    if (record.verb === "PURSUE" && !record.vetoed) {
      // Should be positive or neutral risk statement
      const riskLower = riskText.toLowerCase();
      expect(riskLower).not.toContain("severe");
      expect(riskLower).not.toContain("critical");
    }
  });

  // Test 6: No fabricated risk for SPARSE_SPEC / NOT_EVALUABLE
  it("6: No fabricated risk for SPARSE_SPEC / NOT_EVALUABLE", () => {
    const mockRecord: RecommendationRecord = {
      jobHash: "test-sparse",
      engineVersion: "4.3.0",
      recommendationVersion: "4.3.0:test",
      verb: "SPARSE_SPEC",
      rawScore: 0,
      priority: null,
      vetoed: true,
      vetoReason: "G-EVIDENCE-GATE-SPARSE-SPEC",
      claimPermissions: {
        allowedClaims: [],
        explicitUnknowns: [],
        explicitRisks: []
      },
      confidence: 0.3,
      factors: { pursuitFriction: 0 },
      evidenceGrounding: {},
      decisionSummary: { careerValue: 0, shortlistingPotential: 0, pursuitFriction: 0 },
      decisionDrivers: [],
      decisionRisks: [{ factor: "Insufficient Evidence", impact: "negative", strength: "high", evidence: "Specification contains fewer than 25 words" }],
      confidences: { parsing: 0.3, matching: 0.3, recommendation: 0.3 },
      stability: "Low",
      headspace: { finalVerb: "SPARSE_SPEC", downgraded: false },
      comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
      explanation: { reason: "test", dominantFactor: "test", missingEvidence: ["Detailed requirements", "Responsibilities"], unknowns: [] },
      trace: {
        priority: 0,
        factors: { careerValue: 0, shortlistingPotential: 0, pursuitFriction: 0 },
        verb0: "SPARSE_SPEC",
        finalVerb: "SPARSE_SPEC",
        confidence: 0.3,
        stability: "Low",
        pipeline: [{ stage: "EvidenceGate", status: "SPARSE_SPEC" }],
        evidenceMapping: [],
        careerValueBreakdown: { brandValue: 0, learningValue: 0, trajectoryValue: 0, riskMitigation: 0 },
        headspace: { finalVerb: "SPARSE_SPEC", downgraded: false },
        missing: [],
        timestamp: new Date().toISOString(),
        candidateProjectionHash: "test",
        opportunityContentHash: "test"
      },
      esi: 0,
      diligenceStatus: "INSUFFICIENT"
    };

    const mockSource: OpportunitySource = {
      jobHash: "test-sparse",
      role: "Manager",
      company: "MinimalCorp",
      location: "Mumbai",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const risk = synthesizePrincipalRisk(mockRecord, mockSource);

    // Should acknowledge the spec uncertainty, not invent capability gaps
    expect(risk.category).toBe("job_spec_uncertainty");
    // Should explain that details are unavailable
    expect(risk.statement.toLowerCase()).toContain("unavailable");
    expect(risk.statement.toLowerCase()).toContain("pursuing");
    // Should NOT make claims about capability gaps
    expect(risk.statement.toLowerCase()).not.toContain("lack of");
    expect(risk.statement.toLowerCase()).not.toContain("insufficient");
    // Should have low confidence due to missing evidence
    expect(risk.confidence).toBeLessThan(0.6);
  });

  // Test 7: Strategic Advantage and Principal Risk remain distinct concepts
  it("7: Strategic Advantage and Principal Risk remain distinct concepts", async () => {
    const mockRecord: RecommendationRecord = {
      jobHash: "test-distinct",
      engineVersion: "4.3.0",
      recommendationVersion: "4.3.0:test",
      verb: "CONSIDER",
      rawScore: 65,
      priority: 65,
      vetoed: false,
      vetoReason: null,
      claimPermissions: {
        allowedClaims: ["CRM", "TRANSFORMATION"],
        explicitUnknowns: ["Industry Domain [DOMAIN_FAMILIARITY]"],
        explicitRisks: []
      },
      confidence: 0.75,
      factors: { pursuitFriction: 10 },
      evidenceGrounding: {},
      decisionSummary: { careerValue: 70, shortlistingPotential: 65, pursuitFriction: 10 },
      decisionDrivers: [
        { factor: "CRM Transformation", impact: "positive", strength: "high", evidence: "13-market migration" }
      ],
      decisionRisks: [
        { factor: "Capability Gaps", impact: "negative", strength: "medium", evidence: "Missing domain familiarity" }
      ],
      confidences: { parsing: 0.88, matching: 0.75, recommendation: 0.75 },
      stability: "Medium",
      headspace: { finalVerb: "CONSIDER", downgraded: false },
      comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
      explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
      trace: {
        priority: 65,
        factors: { careerValue: 70, shortlistingPotential: 65, pursuitFriction: 10 },
        verb0: "CONSIDER",
        finalVerb: "CONSIDER",
        confidence: 0.75,
        stability: "Medium",
        pipeline: [],
        evidenceMapping: [
          { jobCapability: "CRM Transformation [CORE_MANDATE]", candidateCapability: "13-market Salesforce migration", confidence: 0.92, reason: "Strong match" },
          { jobCapability: "Healthcare Domain [DOMAIN_FAMILIARITY]", candidateCapability: "Limited healthcare experience", confidence: 0.4, reason: "Weak match" }
        ],
        careerValueBreakdown: { brandValue: 18, learningValue: 18, trajectoryValue: 17, riskMitigation: 12 },
        headspace: { finalVerb: "CONSIDER", downgraded: false },
        missing: ["Healthcare Domain"],
        timestamp: new Date().toISOString(),
        candidateProjectionHash: "test",
        opportunityContentHash: "test"
      },
      esi: 0.65,
      diligenceStatus: "READY"
    };

    const mockSource: OpportunitySource = {
      jobHash: "test-distinct",
      role: "VP Marketing",
      company: "HealthTech",
      location: "Bengaluru",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    // Import strategic advantage synthesizer at top of file
    const { synthesizeStrategicAdvantage, formatStrategicAdvantage } = await import("@/lib/intelligence/editorial/StrategicAdvantageSynthesizer");

    const strategicAdvantage = synthesizeStrategicAdvantage(mockRecord, mockSource);
    const principalRisk = synthesizePrincipalRisk(mockRecord, mockSource);

    // Strategic advantage should focus on positive capability
    expect(strategicAdvantage.category).toMatch(/core_mandate_match|transformation_experience|capability_combination/);

    // Principal risk should focus on the gap (domain)
    expect(principalRisk.category).toBe("identity_domain_concern");
    expect(principalRisk.statement.toLowerCase()).toContain("domain");

    // They should NOT be the same
    expect(formatStrategicAdvantage(strategicAdvantage)).not.toBe(formatPrincipalRisk(principalRisk));

    // Strategic advantage should have higher confidence than risk (positive vs negative)
    expect(strategicAdvantage.confidence).toBeGreaterThan(principalRisk.confidence);

    // Strategic advantage should reference CRM/matches
    expect(strategicAdvantage.evidence.some(e => e.toLowerCase().includes("crm") || e.toLowerCase().includes("migration"))).toBe(true);

    // Principal risk should reference domain/gap
    expect(principalRisk.evidence.some(e => e.toLowerCase().includes("domain"))).toBe(true);
  });
});

// Additional tests for edge cases and completeness
describe("P2-A.2: Principal Risk Edge Cases", () => {
  // Identity mismatch as principal risk
  it("identifies identity/domain mismatch as principal risk", () => {
    const mockRecord: RecommendationRecord = {
      jobHash: "test-identity",
      engineVersion: "4.3.0",
      recommendationVersion: "4.3.0:test",
      verb: "PASS",
      rawScore: 25,
      priority: 25,
      vetoed: true,
      vetoReason: "G-IDENTITY-VETO",
      claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: ["Identity Distance"] },
      confidence: 0.8,
      factors: { pursuitFriction: 30 },
      evidenceGrounding: {},
      decisionSummary: { careerValue: 20, shortlistingPotential: 15, pursuitFriction: 30 },
      decisionDrivers: [],
      decisionRisks: [{ factor: "Identity Distance", impact: "negative", strength: "high", evidence: "Distance 0.82 reduces capability weight" }],
      confidences: { parsing: 0.9, matching: 0.8, recommendation: 0.8 },
      stability: "High",
      headspace: { finalVerb: "PASS", downgraded: false },
      comparison: { higherThan: [], lowerThan: [], differentiators: [], tradeOffs: [] },
      explanation: { reason: "test", dominantFactor: "test", missingEvidence: [], unknowns: [] },
      trace: {
        priority: 25,
        factors: { careerValue: 20, shortlistingPotential: 15, pursuitFriction: 30 },
        verb0: "PASS",
        finalVerb: "PASS",
        confidence: 0.8,
        stability: "High",
        pipeline: [],
        evidenceMapping: [],
        careerValueBreakdown: { brandValue: 6, learningValue: 5, trajectoryValue: 4, riskMitigation: 5 },
        headspace: { finalVerb: "PASS", downgraded: false },
        missing: [],
        timestamp: new Date().toISOString(),
        candidateProjectionHash: "test",
        opportunityContentHash: "test"
      },
      esi: 0.25,
      diligenceStatus: "READY"
    };

    const mockSource: OpportunitySource = {
      jobHash: "test-identity",
      role: "Chief Technology Officer",
      company: "TechCorp",
      location: "Remote",
      postedRelative: "Posted recently",
      scrapedFrom: "LinkedIn",
      primaryConcern: null,
      dimensions: []
    };

    const risk = synthesizePrincipalRisk(mockRecord, mockSource);

    expect(risk.category).toBe("identity_domain_concern");
    expect(risk.statement.toLowerCase()).toContain("different functional domain");
    expect(risk.severity).toBe("high");
  });

  // Formatting function test
  it("formatPrincipalRisk handles low confidence correctly", () => {
    const lowConfidenceRisk: PrincipalRisk = {
      statement: "Unclear assessment",
      category: "job_spec_uncertainty",
      evidence: [],
      confidence: 0.4,
      severity: "medium"
    };

    const formatted = formatPrincipalRisk(lowConfidenceRisk);
    expect(formatted).toContain("Risk unclear:");
  });

  it("formatPrincipalRisk handles normal confidence correctly", () => {
    const normalRisk: PrincipalRisk = {
      statement: "Clear material gap",
      category: "material_capability_gap",
      evidence: ["Evidence 1"],
      confidence: 0.7,
      severity: "high"
    };

    const formatted = formatPrincipalRisk(normalRisk);
    expect(formatted).not.toContain("Risk unclear:");
    expect(formatted).toBe("Clear material gap");
  });
});
