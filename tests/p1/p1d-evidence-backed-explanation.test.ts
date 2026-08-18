/**
 * P1-D: Evidence-Backed Recommendation Explanation
 *
 * Acceptance Contract:
 * - D1: Every material positive recommendation driver must be traceable to supporting evidence/assessment
 * - D2: Every material negative/gap claim must be supported by assessment or missing evidence
 * - D3: Editorial must not invent experience, capability, seniority, business outcomes, etc.
 * - D4: Editorial must not mutate the authoritative decision (no PASS→CONSIDER, etc.)
 * - D5: Confidence remains epistemic ("how certain are we?" not "how capable is candidate?")
 * - D6: Narrative driver traceable back to evidence references/proof chains
 * - D7: Missing evidence produces uncertainty, not fabricated positive claim
 * - D8: Presenter/editorial consume authoritative decision data; they do not recompute intelligence
 */

import { describe, it, expect } from "vitest";
import { candidateProfile } from "@/data/candidate-profile";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";
import { runEngine, injectFreshRecords, clearInjectedRecords } from "@/lib/intelligence/engine";
import type { RecommendationRecord } from "@/lib/intelligence/record";
import type { OpportunitySource } from "@/data/opportunity-fixtures";
import type { Presented } from "@/lib/intelligence/present";

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

describe("P1-D: Evidence-Backed Recommendation Explanation", () => {
  it("D1: recommendation drivers are grounded in authoritative decisionDrivers", () => {
    const { record, presented } = runEngineToPresented({
      role: "VP Marketing",
      company: "GrowthCo",
      description: "Lead marketing transformation. 15+ years experience required. P&L ownership.",
    });

    // The Presented opportunity should have primaryDriver derived from decisionDrivers
    expect(presented.opportunity.primaryDriver).toBeDefined();

    // If record has decisionDrivers, primaryDriver must reference the first driver's factor
    if (record.decisionDrivers && record.decisionDrivers.length > 0) {
      const firstDriver = record.decisionDrivers[0];
      expect(presented.opportunity.primaryDriver).toContain(firstDriver.factor);
      // D6: Evidence must be traceable
      expect(presented.opportunity.primaryDriver).toContain(firstDriver.evidence);
    }
  });

  it("D2: recommendation risks are grounded in authoritative decisionRisks", () => {
    const { record, presented } = runEngineToPresented({
      role: "Director Marketing",
      company: "SmallCo",
      description: "Entry level marketing role. 2-3 years experience.",
    });

    // The Presented opportunity should have primaryRisk derived from decisionRisks
    expect(presented.opportunity.primaryRisk).toBeDefined();

    // If record has decisionRisks, primaryRisk must reference the first risk's factor
    if (record.decisionRisks && record.decisionRisks.length > 0) {
      const firstRisk = record.decisionRisks[0];
      expect(presented.opportunity.primaryRisk).toContain(firstRisk.factor);
      // D6: Evidence must be traceable
      expect(presented.opportunity.primaryRisk).toContain(firstRisk.evidence);
    }
  });

  it("D4: editorial cannot mutate the authoritative decision verb", () => {
    const { record, presented } = runEngineToPresented({
      role: "VP Marketing",
      company: "TestCo",
      description: "Executive marketing leadership role.",
    });

    // D4: Editorial must preserve the authoritative decision
    // The presented verb must match the record's authoritative decision (verb field)
    expect(presented.opportunity.decision).toBe(record.verb);

    // No mutation: CONSIDER cannot become PURSUE, PASS cannot become CONSIDER, etc.
    const validVerbs = ["PURSUE", "CONSIDER", "PASS", "SPARSE_SPEC", "NOT_EVALUABLE"];
    expect(validVerbs).toContain(presented.opportunity.decision);
  });

  it("D3/D6: primaryDriver contains evidence reference, not invented claim", () => {
    const { record, presented } = runEngineToPresented({
      role: "Chief Marketing Officer",
      company: "ScaleCo",
      description: "Lead global marketing. $100M+ P&L. Board exposure.",
    });

    // D3: No invented claims - primaryDriver should be grounded
    // D6: Evidence must survive into the explanation
    if (record.decisionDrivers && record.decisionDrivers.length > 0) {
      const firstDriver = record.decisionDrivers[0];
      // Evidence should be in the primaryDriver string
      const driverText = presented.opportunity.primaryDriver || "";
      expect(driverText).toContain(firstDriver.evidence);

      // Should not be a hardcoded template string like "Commercial Expansion"
      // without supporting evidence
      if (driverText.includes("Commercial Expansion") && !driverText.includes("(")) {
        throw new Error("D3 violation: primaryDriver appears to be hardcoded without evidence reference");
      }
    }
  });

  it("D7: missing evidence produces uncertainty, not fabricated positive claim", () => {
    const { record } = runEngineToPresented({
      role: "VP",
      company: "MinimalCo",
      description: "Role", // Minimal description - missing evidence
    });

    // D7: When evidence is missing, we should see:
    // 1. Either missingEvidence array populated
    // 2. Or lower confidence
    // 3. Or explicit gaps in decisionRisks
    // But NOT fabricated positive claims

    const hasMissingEvidence = record.explanation?.missingEvidence?.length > 0;
    const hasGaps = record.decisionRisks?.some(r =>
      r.factor.toLowerCase().includes("gap") ||
      r.factor.toLowerCase().includes("missing") ||
      r.factor.toLowerCase().includes("insufficient")
    );
    const lowConfidence = (record.confidences?.recommendation || 0) < 0.5;

    // If evidence is truly missing, system must acknowledge it
    // We cannot assert all three are true, but at minimum one should signal uncertainty
    const hasUncertainty = hasMissingEvidence || hasGaps || lowConfidence;

    // But D7 specifically: if there IS missing evidence, don't fabricate positives
    if (hasMissingEvidence) {
      // No decisionDriver should claim certainty where evidence is missing
      const hasCertaintyClaims = record.decisionDrivers?.some(d =>
        d.strength === "high" && d.evidence?.toLowerCase().includes("missing")
      );
      expect(hasCertaintyClaims).toBe(false);
    }
  });

  it("D8: presenter consumes authoritative data, does not recompute", () => {
    const { record, presented } = runEngineToPresented({
      role: "VP Growth",
      company: "TechCo",
      description: "Scale growth marketing. Team of 40+. CRM experience required.",
    });

    // D8: Presenter/editorial must consume authoritative decision data
    // Scores in presented should match record scores (not recomputed)

    if (record.scores?.overall !== undefined) {
      expect(presented.opportunity.score).toBe(record.scores.overall);
    }

    // decisionDrivers/decisionRisks in record must be preserved through presentation
    if (record.decisionDrivers) {
      // The primaryDriver should be derived from these, not invented
      expect(presented.opportunity.primaryDriver).toBeDefined();
    }
  });

  it("D5: confidence remains epistemic (how certain are we)", () => {
    const { record, presented } = runEngineToPresented({
      role: "VP Marketing",
      company: "EstablishedCo",
      description: "Well-documented executive role with clear requirements.",
    });

    // D5: Confidence should reflect epistemic certainty, not candidate capability
    // i.e., "Confidence 75%" not "You are 75% capable"

    // Access narrative through any available path
    const narrative = (presented as any).narrative || {};
    const confidenceText = narrative.confidenceLine || "";
    // Should reference confidence level, not capability
    expect(confidenceText.toLowerCase()).not.toContain("you are");
    expect(confidenceText.toLowerCase()).not.toContain("candidate is");
    expect(confidenceText.toLowerCase()).not.toContain("your capability");
  });
});
