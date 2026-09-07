import { describe, expect, it, vi } from "vitest";
import type { Opportunity } from "@/data/opportunity-fixtures";
import { AdvisoryConstitution } from "@/lib/intelligence/editorial/AdvisoryConstitution";
import { BriefCompositionEngine } from "@/lib/intelligence/editorial/BriefCompositionEngine";
import { EditorialContextBuilder } from "@/lib/intelligence/editorial/EditorialContext";
import { EditorialEngine } from "@/lib/intelligence/editorial/EditorialEngine";
import { PreviewCompositionEngine } from "@/lib/intelligence/editorial/PreviewCompositionEngine";
import { EditorialPatternSelector } from "@/lib/intelligence/editorial/EditorialPatternSelector";
import { getBriefProvenanceLabel } from "@/components/radar/opportunity/surfaces/ExecutiveBriefingSurface";

function sparseOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    jobHash: "sparse-opportunity",
    role: "VP Finance",
    company: "TestCo",
    location: "Mumbai",
    scrapedFrom: "LinkedIn",
    dimensions: [],
    engineRecommendation: {
      engineVerdict: "PURSUE",
      qualityScore: 91,
      triggeredRuleIds: [],
    },
    ...overrides,
  } as Opportunity;
}

describe("Editorial evidence sufficiency contract", () => {
  it("does not promote a missing score or title into evaluated P&L evidence", () => {
    const context = EditorialContextBuilder.build(sparseOpportunity({ engineRecommendation: undefined }));

    expect(context.rawScore).toBeNull();
    expect(context.hasPnlOwnership).toBe(false);
    expect(context.pnlProvenance).toBe("UNKNOWN");
  });

  it("does not promote inferred commercial-accountability evidence into observed P&L ownership", () => {
    const context = EditorialContextBuilder.build(sparseOpportunity({
      dimensions: [{ key: "commercialAccountability", jdEvidence: { status: "Inferred", value: "P&L ownership" } }] as Opportunity["dimensions"],
    }));

    expect(context.hasPnlOwnership).toBe(false);
    expect(context.pnlProvenance).toBe("UNKNOWN");
  });

  it("renders a partial-evidence brief for sparse evaluated input with a canonical assessment", () => {
    const opportunity = sparseOpportunity();
    const brief = BriefCompositionEngine.compose(opportunity);

    expect(brief.memory.decision).toBe("PURSUE");
    expect(brief.certaintyLevel).toBe("LOW");
    expect(brief.executiveOpinion).toContain("recorded PURSUE assessment");
    expect(brief.fitProofs).toEqual([]);
    expect(brief.executiveOpinion).not.toMatch(/P&L|multi-million|shortlisting probability|board-level/i);
  });

  it("preserves mandate, candidate assessment, and proof points when reporting and P&L are missing", () => {
    const opportunity = sparseOpportunity({
      dimensions: [{
        key: "functionalScope",
        label: "Functional Scope",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: {
          status: "Explicit",
          value: "Lead influencer marketing strategy",
          evidence: [{ quote: "Lead influencer marketing strategy", source: "snippet" }],
        },
        candidateProof: { headline: "Relevant leadership record", detail: "Recorded candidate evidence." },
      }] as Opportunity["dimensions"],
      engineRecommendation: {
        engineVerdict: "PURSUE",
        qualityScore: 72,
        triggeredRuleIds: [],
        capabilityFit: { matchedCapabilities: ["Influencer strategy"], missingCapabilities: [] },
      } as any,
    });

    const brief = BriefCompositionEngine.compose(opportunity);

    expect(brief.memory.decision).toBe("PURSUE");
    expect(brief.structuredSections.mandate.thesis).toContain("Lead influencer marketing strategy");
    expect(brief.proofPoints.map((point) => point.detail)).toContain("Lead influencer marketing strategy");
    expect(brief.qualitativeReasoning.some((row) => row.layer === "Capability assessment")).toBe(true);
    expect(brief.qualitativeReasoning.find((row) => row.layer === "Capability assessment")?.ratingLabel).toBe("Requires Verification");
    expect(brief.rankedUnknowns.map((unknown) => unknown.label)).toContain("Reporting line");
    expect(brief.rankedUnknowns.map((unknown) => unknown.label)).toContain("Commercial ownership");
    expect(brief.decisionSensitivity.becomesPursueIf).toEqual([]);
    expect(brief.decisionSensitivity.becomesPassIf).toEqual([]);
    expect(brief.structuredSections.mandate.thesis).not.toMatch(/CEO|board|P&L/i);
  });

  it("keeps a missing commercial-accountability signal local to the P&L question", () => {
    const brief = BriefCompositionEngine.compose(sparseOpportunity({
      dimensions: [{
        key: "mandate",
        label: "Mandate",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: {
          status: "Explicit",
          value: "Build creator partnerships",
          evidence: [{ quote: "Build creator partnerships", source: "snippet" }],
        },
      }] as Opportunity["dimensions"],
    }));

    expect(brief.structuredSections.mandate.thesis).toContain("Build creator partnerships");
    expect(brief.rankedUnknowns.map((unknown) => unknown.label)).toContain("Commercial ownership");
    expect(JSON.stringify(brief)).not.toMatch(/full country-level commercial ownership|strongest P&L acceleration|board-level commercial reporting/i);
  });

  it("keeps explicit SPARSE_SPEC on the evidence-limited path", () => {
    const brief = BriefCompositionEngine.compose(sparseOpportunity({
      evaluationState: "SPARSE_SPEC" as any,
      dimensions: [{
        key: "mandate",
        label: "Mandate",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: { status: "Explicit", value: "Lead growth", evidence: [{ quote: "Lead growth", source: "snippet" }] },
      }] as Opportunity["dimensions"],
    }));

    expect(brief.memory.decision).toBeNull();
    expect(brief.certaintyLevel).toBe("LOW");
    expect(brief.structuredSections.mandate.thesis).toContain("not established");
  });

  it("retains invalid identity and zero evidence as evidence-limited", () => {
    const invalid = BriefCompositionEngine.compose(sparseOpportunity({ role: "", company: "" }));
    const zeroEvidence = BriefCompositionEngine.compose(sparseOpportunity({ engineRecommendation: undefined }));

    expect(invalid.memory.decision).toBeNull();
    expect(zeroEvidence.memory.decision).toBeNull();
    expect(invalid.certaintyLevel).toBe("LOW");
    expect(zeroEvidence.certaintyLevel).toBe("LOW");
  });

  it("does not make legacy fabricated defaults reachable through the partial path", () => {
    const brief = BriefCompositionEngine.compose(sparseOpportunity({
      dimensions: [{
        key: "functionalScope",
        label: "Functional Scope",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: { status: "Explicit", value: "Lead audience strategy", evidence: [{ quote: "Lead audience strategy", source: "snippet" }] },
      }] as Opportunity["dimensions"],
    }));

    expect(JSON.stringify(brief)).not.toMatch(/full country-level commercial ownership|strongest P&L acceleration|board-level commercial reporting|25 FTEs|founder-led|Growth Architecture|Commercial Transformation|Executive Governance/i);
    expect(brief.qualityScore).toBe(91);
    expect(brief.explanation.verdict).toBe("PURSUE");
  });

  it("uses the same safe posture for direct editorial engine and context composition", () => {
    const opportunity = sparseOpportunity();
    const output = EditorialEngine.process(opportunity);
    const paragraph = AdvisoryConstitution.getWhyThisRoleExistsParagraph(opportunity, {}, "finance");

    expect(output.certaintyLevel).toBe("LOW");
    expect(output.whyWellSuited).toEqual([]);
    expect(paragraph).toContain("are limited");
    expect(paragraph).not.toMatch(/stealth-mandate|founder-led processes|structural ceiling/i);
  });

  it("keeps preview rendering evidence-limited and never exposes legacy recommendation fields", () => {
    const opportunity = sparseOpportunity({
      recommendation: "Unsafe historical recommendation",
      primaryDriver: "Unsafe P&L claim",
      primaryRisk: "Unsafe board claim",
    });
    const preview = PreviewCompositionEngine.compose(opportunity);

    expect(`${preview.headline} ${preview.narrative} ${preview.whyItWorks} ${preview.watchFor}`).not.toMatch(/unsafe|P&L claim|board claim/i);
    expect(preview.headline).toContain("Assessment pending");
  });

  it("keeps an evaluated preview error fallback neutral rather than reading legacy editorial fields", () => {
    const opportunity = sparseOpportunity({
      description: "A".repeat(220),
      recommendation: "Unsafe historical recommendation",
      primaryDriver: "Unsafe P&L claim",
      primaryRisk: "Unsafe board claim",
    });
    const selector = vi.spyOn(EditorialPatternSelector, "select").mockImplementation(() => {
      throw new Error("forced preview failure");
    });
    try {
      const preview = PreviewCompositionEngine.compose(opportunity);
      expect(`${preview.headline} ${preview.narrative} ${preview.whyItWorks} ${preview.watchFor}`).not.toMatch(/unsafe|P&L claim|board claim/i);
      expect(preview.narrative).toContain("Editorial composition is unavailable");
    } finally {
      selector.mockRestore();
    }
  });

  it("derives executive provenance labels from the actual evidence state", () => {
    expect(getBriefProvenanceLabel({ explanation: { evidenceStrength: "INSUFFICIENT" }, evidenceQuality: "Inferred Evidence" }))
      .toBe("Insufficient evidence — verification pending.");
    expect(getBriefProvenanceLabel({ explanation: { evidenceStrength: "SUPPORTED" }, evidenceQuality: "High Evidence Quality" }))
      .toBe("High Evidence Quality · Claim strength reflects recorded evidence.");
  });

  it("validates quotes with the shared isMeaningfulEvidenceQuote predicate", async () => {
    const { isMeaningfulEvidenceQuote } = await import("@/lib/intelligence/editorial/AdvisoryConstitution");
    expect(isMeaningfulEvidenceQuote("")).toBe(false);
    expect(isMeaningfulEvidenceQuote("   ")).toBe(false);
    expect(isMeaningfulEvidenceQuote(",")).toBe(false);
    expect(isMeaningfulEvidenceQuote("...")).toBe(false);
    expect(isMeaningfulEvidenceQuote(" - ")).toBe(false);
    expect(isMeaningfulEvidenceQuote("P&L")).toBe(true);
    expect(isMeaningfulEvidenceQuote("Lead marketing team")).toBe(true);
    expect(isMeaningfulEvidenceQuote("Reports to CEO")).toBe(true);
  });

  it("unlocks EVALUATED only when explicit evidence is from a mandate-bearing dimension", () => {
    // Mandate-bearing dimension (mandate, functionalScope, commercialAccountability, reportingLine, requiredLevel)
    const mandateOpp = sparseOpportunity({
      dimensions: [{
        key: "mandate",
        label: "Mandate",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: {
          status: "Explicit",
          value: "Lead corporate transformation",
          evidence: [{ quote: "Lead corporate transformation", source: "snippet" }],
        },
      }] as Opportunity["dimensions"],
    });
    const sufficiency = AdvisoryConstitution.validateDataSufficiency(mandateOpp);
    expect(sufficiency.state).toBe("EVALUATED");
    expect(sufficiency.isSufficient).toBe(true);

    // Non-mandate dimension alone (geography / location)
    const geoOnlyOpp = sparseOpportunity({
      dimensions: [{
        key: "geography" as any,
        label: "Location",
        importance: "Context",
        bucket: "Matched",
        jdEvidence: {
          status: "Explicit",
          value: "Gurugram",
          evidence: [{ quote: "Gurugram", source: "snippet" }],
        },
      }] as Opportunity["dimensions"],
    });
    const geoSufficiency = AdvisoryConstitution.validateDataSufficiency(geoOnlyOpp);
    expect(geoSufficiency.state).toBe("SPARSE_SPEC");
    expect(geoSufficiency.isSufficient).toBe(false);
    expect(geoSufficiency.message).toContain("not provide enough evidence");
  });

  it("rejects punctuation or meaningless quotes from satisfying the constitutional evidence gate", () => {
    const invalidQuoteOpp = sparseOpportunity({
      dimensions: [{
        key: "mandate",
        label: "Mandate",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: {
          status: "Explicit",
          value: "...",
          evidence: [{ quote: "...", source: "snippet" }],
        },
      }] as Opportunity["dimensions"],
    });
    const sufficiency = AdvisoryConstitution.validateDataSufficiency(invalidQuoteOpp);
    expect(sufficiency.state).toBe("SPARSE_SPEC");
    expect(sufficiency.isSufficient).toBe(false);
  });

  it("rejects an Explicit dimension when value is meaningful but quote is punctuation (PL_OWNERSHIP + ,)", async () => {
    const adversarialOpp = sparseOpportunity({
      dimensions: [{
        key: "commercialAccountability",
        label: "P&L Accountability",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: {
          status: "Explicit",
          value: "PL_OWNERSHIP",
          quote: ",",
          evidence: [{ quote: ",", source: "snippet" }],
        },
      }] as Opportunity["dimensions"],
    });

    // 1. Constitutional sufficiency must fail closed and return SPARSE_SPEC
    const sufficiency = AdvisoryConstitution.validateDataSufficiency(adversarialOpp);
    expect(sufficiency.state).toBe("SPARSE_SPEC");
    expect(sufficiency.isSufficient).toBe(false);

    // The canonical present() normalizer must also demote Explicit to Missing when quote is invalid.
    const { present } = await import("@/lib/intelligence/present");
    const presented = present(
      {
        jobHash: "pl-test-1",
        role: "Chief Commercial Officer",
        company: "Acme",
        location: "Mumbai",
        dimensions: [{
          key: "commercialAccountability",
          label: "P&L Accountability",
          importance: "Core",
          bucket: "Matched",
          jdEvidence: {
            status: "Explicit",
            value: "PL_OWNERSHIP",
            quote: ",",
            evidence: [{ quote: ",", source: "snippet" }],
          },
        }],
      } as any,
      {
        jobHash: "pl-test-1",
        verb: "PURSUE",
        decision: "PURSUE",
        priority: 85,
        fitDimensions: [{ dimension: "commercialAccountability", score: 10 }],
        headspace: { downgraded: false },
        confidences: { recommendation: 0.9 },
        stability: "High",
        comparison: { higherThan: [], lowerThan: [] },
        explanation: { missingEvidence: [] },
      } as any
    );
    expect(presented.opportunity.dimensions[0].jdEvidence.status).toBe("Missing");
    expect(presented.opportunity.dimensions[0].jdEvidence.value).toBe("");
  });

});
