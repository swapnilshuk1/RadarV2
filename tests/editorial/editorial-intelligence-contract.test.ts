import { describe, expect, it } from "vitest";
import type { Opportunity } from "@/data/opportunity-fixtures";
import type { CandidateProjection } from "@/lib/domain/candidate_projection";
import type { EvaluationArtifact } from "@/lib/intelligence/engine";
import { buildEditorialIntelligenceContract } from "@/lib/intelligence/editorial/EditorialIntelligenceContractBuilder";

const candidate: CandidateProjection = {
  operatingLevel: { value: "STRATEGIC", confidence: 0.8, evidenceIds: [] },
  workNature: { value: "STRATEGIC_WORK", confidence: 0.8, evidenceIds: [] },
  decisionAuthority: { value: "ENTERPRISE", confidence: 0.8, evidenceIds: [] },
  commercialScope: { value: "ENTERPRISE", confidence: 0.8, evidenceIds: [] },
  yearsOfExperience: 15,
  coreCapabilities: ["Marketing Strategy"],
  preferredLocations: [],
  preferredWorkModel: "ANY",
  executiveThemes: [],
  inferredCapabilities: [
    {
      name: "Marketing Strategy",
      confidence: 0.82,
      evidenceIds: ["candidate-1"],
      supportingEvidence: [{
        id: "candidate-1",
        quote: "Led multi-market creator growth programs and improved campaign performance through disciplined measurement.",
        relation: "SUPPORTS_INFERENCE",
      }],
    },
    {
      name: "Enterprise P&L Ownership & ENTERPRISE | Board Decision Authority",
      confidence: 0.95,
      evidenceIds: ["taxonomy"],
      supportingEvidence: [{ id: "taxonomy", quote: "Enterprise P&L Ownership & ENTERPRISE | Board Decision Authority", relation: "SUPPORTS_INFERENCE" }],
    },
  ],
};

function artifact(dimensions: Opportunity["dimensions"]): EvaluationArtifact {
  return {
    record: {},
    opportunity: {
      jobHash: "contract-role",
      role: "Director of Influencer Marketing",
      company: "Social Beat",
      location: "Gurugram",
      scrapedFrom: "LinkedIn",
      decision: "PURSUE",
      recommendation: "Pursue",
      primaryConcern: null,
      positioning: ["Lead with creator growth precedent."],
      headspace: [],
      hiringRisk: "Validate reporting scope before committing interview time.",
      dimensions,
      primaryDriver: "A grounded candidate precedent aligns with the published creator-growth work.",
      recommendedAction: "Proceed with screening and clarify reporting scope.",
      engineRecommendation: {
        jobHash: "contract-role",
        evaluationFingerprint: "fp",
        engineVerdict: "PURSUE",
        vetoed: false,
        qualityScore: 72,
        evaluatedAt: "2026-09-09T00:00:00.000Z",
      },
    } as Opportunity,
    jobProjection: {},
  };
}

describe("EditorialIntelligenceContractBuilder", () => {
  it("keeps verified candidate precedent and explicit employer outcome while rejecting classifier-only evidence", () => {
    const contract = buildEditorialIntelligenceContract(artifact([
      {
        key: "functionalScope",
        label: "Functional scope",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: { status: "Explicit", value: "Build creator partnerships and analyze campaign performance.", evidence: [{ quote: "Build creator partnerships and analyze campaign performance." }] },
      },
      {
        key: "commercialScope",
        label: "Commercial scope",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: { status: "Explicit", value: "ENTERPRISE", evidence: [{ quote: "ENTERPRISE" }] },
      },
    ]), candidate);

    expect(contract.verdict).toBe("PURSUE");
    expect(contract.qualityScore).toBe(72);
    expect(contract.candidatePrecedents).toEqual([expect.objectContaining({ capability: "Marketing Strategy", evidenceIds: ["candidate-1"] })]);
    expect(contract.publishedRoleOutcomes).toEqual([expect.objectContaining({ statement: "Build creator partnerships and analyze campaign performance." })]);
    expect(JSON.stringify(contract)).not.toContain("Enterprise P&L Ownership");
    expect(JSON.stringify(contract)).not.toContain("ENTERPRISE");
  });

  it("does not let a missing authority dimension erase published responsibilities", () => {
    const contract = buildEditorialIntelligenceContract(artifact([
      {
        key: "functionalScope",
        label: "Functional scope",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: { status: "Explicit", value: "Develop influencer campaigns across client accounts.", evidence: [{ quote: "Develop influencer campaigns across client accounts." }] },
      },
      { key: "decisionAuthority", label: "Decision authority", importance: "Core", bucket: "Missing", jdEvidence: { status: "Missing", value: "", evidence: [] } },
    ]), candidate);
    expect(contract.publishedRoleOutcomes.map((outcome) => outcome.statement)).toContain("Develop influencer campaigns across client accounts.");
    expect(contract.decisionHinges.some((hinge) => hinge.topic === "Decision rights")).toBe(true);
  });
});
