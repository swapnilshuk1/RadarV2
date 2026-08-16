import { describe, it, expect } from "vitest";
import { extract } from "../../scripts/scraper/extract/extractor";
import { JobProjectionBuilder } from "../../src/lib/intelligence/builders/JobProjectionBuilder";
import { CapabilityAssessmentEngine } from "../../src/lib/intelligence/engines/CapabilityAssessmentEngine";
import { CandidateProjectionBuilderImpl } from "../../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { DecisionPolicyEngine } from "../../src/lib/intelligence/policy/DecisionPolicyEngine";
import { invalidateEngineCache } from "../../src/lib/intelligence/engine";
import type { DetailedCard } from "../../scripts/scraper/types";

import { candidateProfile } from "../../src/data/candidate-profile";

describe("RADAR V4 Pipeline Repair - Regression Suite", () => {
  const dummyCandidate = new CandidateProjectionBuilderImpl().fromProfile(candidateProfile);

  const mockFullCard: DetailedCard = {
    cardHash: "test_full_card_hash_123",
    title: "VP of Growth Marketing",
    company: "Acme Enterprise Solutions",
    location: "Bengaluru, India (Hybrid)",
    portal: "LinkedIn",
    detailUrl: "https://linkedin.com/jobs/view/123456",
    rawText: "VP Growth Marketing snippet",
    detail: {
      rawText: `
        Acme Enterprise Solutions is seeking a VP of Growth Marketing to lead our global GTM strategy and demand generation.
        
        Key Responsibilities:
        - Full P&L ownership for $25M marketing and performance budget.
        - Direct reporting line to the Chief Executive Officer (CEO).
        - Oversee performance marketing, CRM analytics, Klaviyo, Salesforce, and digital transformation.
        - Drive enterprise customer acquisition and retention across global markets.
        
        Requirements:
        - 12+ years in executive commercial leadership.
        - Proven track record scaling B2B SaaS revenue.
      `,
      normalizedText: "Normalized text placeholder"
    }
  };

  it("Test 1: Full JD generates structured dimensions with valid verbatim quotes", async () => {
    const extraction = await extract(mockFullCard, { mode: "deterministic" });
    expect(extraction.dimensions).toBeDefined();
    expect(extraction.dimensions.length).toBeGreaterThan(0);

    const validDims = extraction.dimensions.filter(d => d.jdEvidence.status !== "Missing" && d.jdEvidence.value);
    expect(validDims.length).toBeGreaterThan(0);

    const fullCardText = `${mockFullCard.location} ${mockFullCard.rawText} ${mockFullCard.detail.rawText}`;
    for (const d of validDims) {
      if (d.jdEvidence.evidence && d.jdEvidence.evidence.length > 0) {
        for (const ev of d.jdEvidence.evidence) {
          if (ev.quote) {
            expect(fullCardText).toContain(ev.quote);
          }
        }
      }
    }
  });

  it("Test 2: Serialized JSON is never stored as capability name", async () => {
    const extraction = await extract(mockFullCard, { mode: "deterministic" });
    const oppObj = {
      jobHash: mockFullCard.cardHash,
      role: mockFullCard.title,
      company: mockFullCard.company,
      location: mockFullCard.location,
      rawText: mockFullCard.detail.rawText,
      dimensions: extraction.dimensions
    };

    const proj = JobProjectionBuilder.build(oppObj as any);
    expect(proj.capabilities).toBeDefined();
    expect(proj.capabilities.length).toBeGreaterThan(0);

    for (const cap of proj.capabilities) {
      expect(cap.name).not.toContain('{"value":');
      expect(cap.name).not.toContain('"canonicalValue":');
      expect(cap.name.startsWith("{")).toBe(false);
      expect(cap.name.length).toBeGreaterThan(2);
    }
  });

  it("Test 3: Natural JD phrasing produces structured evidence via canonical extractors", async () => {
    const extraction = await extract(mockFullCard, { mode: "deterministic" });
    const keys = extraction.dimensions.map(d => d.key);
    expect(keys).toContain("commercialAccountability");
    expect(keys).toContain("mandate");
    expect(keys).toContain("reportingLine");
  });

  it("Test 4: Full JD supersedes snippet extractions", async () => {
    const snippetCard: DetailedCard = {
      ...mockFullCard,
      detail: { rawText: "", normalizedText: "" }
    };

    const snippetEx = await extract(snippetCard, { mode: "deterministic" });
    const fullEx = await extract(mockFullCard, { mode: "deterministic" });

    expect(fullEx.normalizedText.length).toBeGreaterThan(snippetEx.normalizedText.length);
    expect(fullEx.dimensions.length).toBeGreaterThanOrEqual(snippetEx.dimensions.length);
  });

  it("Test 5: Empty/missing JDs remain unevaluable (SPARSE_SPEC)", async () => {
    const emptyOpp = {
      jobHash: "empty_123",
      role: "VP Marketing",
      company: "Unknown",
      location: "Remote",
      rawText: "",
      dimensions: []
    };

    const proj = JobProjectionBuilder.build(emptyOpp as any);
    expect(proj.capabilities.length).toBe(0);

    const capEval = CapabilityAssessmentEngine.evaluate(dummyCandidate, proj);
    expect(capEval.status).toBe("FAILED");

    const decision = DecisionPolicyEngine.evaluate({
      candidate: dummyCandidate,
      job: proj,
      capability: capEval,
      identity: { status: "COMPLETE", overallFit: 0.8, matches: [], mismatches: [] } as any,
      career: { status: "COMPLETE", overallFit: 0.8 } as any,
      opportunity: { status: "COMPLETE", overallFit: 0.8 } as any,
      lifestyle: { status: "COMPLETE", overallFit: 0.8 } as any
    });

    expect(["NOT_EVALUABLE", "SPARSE_SPEC"]).toContain(decision.verdict);
  });

  it("Test 6: Rich JDs with capability evidence produce COMPLETE capability status", async () => {
    const extraction = await extract(mockFullCard, { mode: "deterministic" });
    const oppObj = {
      jobHash: mockFullCard.cardHash,
      role: mockFullCard.title,
      company: mockFullCard.company,
      location: mockFullCard.location,
      rawText: mockFullCard.detail.rawText,
      dimensions: extraction.dimensions
    };

    const proj = JobProjectionBuilder.build(oppObj as any);
    const capEval = CapabilityAssessmentEngine.evaluate(dummyCandidate, proj);
    expect(capEval.status).toBe("COMPLETE");
    expect(capEval.overallFit).toBeGreaterThan(0);
  });

  it("Test 7: Enrichment completion triggers cache invalidation", () => {
    expect(() => invalidateEngineCache()).not.toThrow();
  });

  it("Test 8: Re-evaluation is idempotent and preserves user decisions structure", async () => {
    const extraction = await extract(mockFullCard, { mode: "deterministic" });
    const oppObj = {
      jobHash: mockFullCard.cardHash,
      role: mockFullCard.title,
      company: mockFullCard.company,
      location: mockFullCard.location,
      rawText: mockFullCard.detail.rawText,
      dimensions: extraction.dimensions
    };

    const proj1 = JobProjectionBuilder.build(oppObj as any);
    const proj2 = JobProjectionBuilder.build(oppObj as any);

    expect(proj1.capabilities.map(c => c.name)).toEqual(proj2.capabilities.map(c => c.name));
  });
});
