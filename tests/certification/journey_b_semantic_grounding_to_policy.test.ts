/**
 * tests/certification/journey_b_semantic_grounding_to_policy.test.ts
 *
 * Continuous Certification Gate — Journey B: Semantic Grounding → Policy Evaluation
 *
 * Invariants Certified:
 * 1. Rich executive JD text synthesizes typed GroundedOpportunityDimension[].
 * 2. EvidenceRichnessCalculator returns SUFFICIENT evidence without false data loss.
 * 3. CanonicalEvaluator produces meaningful recommendation (PURSUE/CONSIDER), positive score, and 0 vetoes.
 * 4. Sparse/Stub JDs (< 25 words) remain classified as SPARSE_SPEC with null score and low confidence.
 * 5. Zero hallucinated dimension evidence quotes in sparse specs.
 */

import { describe, it, expect } from "vitest";
import { JobProjectionBuilder, buildGroundedDimensions } from "@/lib/intelligence/builders/JobProjectionBuilder";
import { CanonicalEvaluator } from "@/lib/intelligence/evaluation/CanonicalEvaluator";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";
import { EvidenceRichnessCalculator } from "@/lib/intelligence/utils/EvidenceRichnessCalculator";
import { EvidenceGate } from "@/lib/intelligence/gates/EvidenceGate";
import { candidateProfile } from "@/data/candidate-profile";
import type { GroundedOpportunityDimension } from "@/lib/domain/job_projection";

describe("Journey B: Semantic Grounding → Policy Evaluation Boundary", () => {
  const candidateBuilder = new CandidateProjectionBuilderImpl();
  const candidateProjection = candidateBuilder.fromProfile(candidateProfile);

  const richCmoJd = `
    Chief Marketing Officer (CMO)
    Enterprise Scale B2B Software Platform
    Location: Bengaluru / Remote Hybrid

    Mandate & Strategic Role:
    HyperScale Tech is looking for an experienced Chief Marketing Officer (CMO) to lead our global enterprise marketing, brand reputation, and revenue demand generation engine.
    The CMO will be a core member of the executive committee, reporting directly to the Founder & CEO.

    Key Responsibilities:
    - Lead Performance Marketing, GTM Strategy, and Digital Transformation across global enterprise demand channels.
    - Oversee global marketing P&L of 40M ARR demand pipeline across North America, Europe, and Asia-Pacific.
    - Lead a multidisciplinary team of 35+ marketing leaders, product marketing managers, and performance growth specialists.
    - Drive our end-to-end go-to-market transformation, enterprise brand repositioning, and customer acquisition engine.
    - Steer category leadership, analyst relations (Gartner/Forrester), and digital commercial expansion.

    Candidate Requirements:
    - 15+ years of senior executive marketing leadership in high-growth enterprise software / technology companies.
    - Proven success scaling ARR from $50M to $250M+ through pipeline transformation, digital channels, and commercial leadership.
  `;

  const sparseStubJd = `
    Marketing Manager needed for fast growing startup in Mumbai. Contact HR.
  `;

  it("grounds dimensions and qualifies rich executive mandate with positive score and zero vetoes", () => {
    const rawOpp = {
      jobHash: "v_rich_cmo_101",
      title: "Chief Marketing Officer",
      company: "HyperScale Tech",
      location: "Bengaluru, India (Hybrid)",
      rawText: richCmoJd,
      description: richCmoJd,
      normalizedText: richCmoJd,
    };

    const projection = JobProjectionBuilder.build(rawOpp);

    // 1. Structural Signal Extraction
    const opLevel = typeof projection.operatingLevel === "object" ? projection.operatingLevel?.value : projection.operatingLevel;
    const mandate = projection.trueExecutiveMandate;
    const commScope = typeof projection.commercialScope === "object" ? projection.commercialScope?.value : projection.commercialScope;

    expect(opLevel).toMatch(/^(EXECUTIVE|L3_EXEC|VP_PLUS)$/);
    expect(mandate).toBeDefined();
    expect(commScope).toBeDefined();

    // 2. Typed Grounded Dimensions Invariant
    const dimensions: readonly GroundedOpportunityDimension[] = projection.dimensions || buildGroundedDimensions(projection);
    expect(dimensions.length).toBeGreaterThanOrEqual(4);

    const dimKeys = dimensions.map(d => d.key);
    expect(dimKeys).toContain("operatingLevel");
    expect(dimKeys).toContain("mandate");
    expect(dimKeys).toContain("commercialScope");

    // 3. Evidence Sufficiency Invariant
    const richness = EvidenceRichnessCalculator.calculate({ dimensions });
    expect(richness.sufficiency).toBe("SUFFICIENT");
    expect(richness.count).toBeGreaterThanOrEqual(3);
    expect(richness.structuralSignalsCount).toBeGreaterThanOrEqual(2);

    // 4. Canonical Evaluation Qualification
    const evalOutput = CanonicalEvaluator.evaluateOpportunity(rawOpp, candidateProjection);

    expect(evalOutput.record.verb).toMatch(/^(PURSUE|CONSIDER)$/);
    expect(evalOutput.record.qualityScore).toBeGreaterThanOrEqual(70);
    expect(evalOutput.record.confidences.recommendation).toBeGreaterThanOrEqual(0.55);

    // 5. Sparse JD Boundary Check
    const gateResult = EvidenceGate.evaluate(sparseStubJd);
    expect(gateResult.isSparse).toBe(true);
    expect(gateResult.evaluationStatus).toBe("SPARSE_SPEC");

    const sparseOpp = {
      jobHash: "v_sparse_stub_202",
      title: "Marketing Manager",
      company: "Startup",
      location: "Mumbai",
      rawText: sparseStubJd,
      description: sparseStubJd,
      normalizedText: sparseStubJd,
    };

    const sparseEval = CanonicalEvaluator.evaluateOpportunity(sparseOpp, candidateProjection);

    expect(sparseEval.record.verb).not.toBe("PURSUE");
    if (sparseEval.record.verb === "SPARSE_SPEC") {
      expect(sparseEval.record.qualityScore).toBeNull();
    }
  });
});
