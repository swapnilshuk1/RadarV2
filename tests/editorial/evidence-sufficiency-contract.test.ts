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

  it("renders an evidence-limited brief for sparse evaluated input", () => {
    const opportunity = sparseOpportunity();
    const brief = BriefCompositionEngine.compose(opportunity);

    expect(brief.memory.decision).toBeNull();
    expect(brief.certaintyLevel).toBe("LOW");
    expect(brief.executiveOpinion).toContain("not provide enough evidence");
    expect(brief.fitProofs).toEqual([]);
    expect(brief.executiveOpinion).not.toMatch(/P&L|multi-million|shortlisting probability|board-level/i);
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

    // 2. adaptLegacyEvaluation must demote Explicit to Missing when quote is invalid
    const { adaptLegacyEvaluation } = await import("@/lib/intelligence/serving/EvaluationServingEngine");
    const legacyEnvelope = {
      opportunity: {
        jobHash: "pl-test-1",
        role: "Chief Commercial Officer",
        company: "Acme",
        dimensions: adversarialOpp.dimensions,
      },
      record: { jobHash: "pl-test-1", verb: "PURSUE", qualityScore: 85 },
      narrative: { recommendation: "Test" },
    };
    const candCtx = { personId: "p1", attentionWindow: 6, activePursuits: 0 };
    const oppCtx = { jobHash: "pl-test-1", role: "Chief Commercial Officer", company: "Acme" };
    const served = adaptLegacyEvaluation(legacyEnvelope, candCtx, oppCtx, null);
    expect(served.dimensions[0].jdEvidence.status).toBe("Missing");
    expect(served.dimensions[0].jdEvidence.value).toBe("");
    expect(served.dimensions[0].jdEvidence.evidence).toHaveLength(0);

    // 3. present() normalizer must also demote Explicit to Missing when quote is invalid
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

  it("safely adapts legacy Presented envelopes without leaking legacy editorial narrative", async () => {
    const { adaptLegacyEvaluation } = await import("@/lib/intelligence/serving/EvaluationServingEngine");

    // Simulates an EvaluationWorker record that persisted JSON.stringify(presented)
    const storedPresentedEnvelope = {
      opportunity: {
        jobHash: "titan-growth-1",
        role: "Head of Growth Marketing",
        company: "Titan",
        location: "Bengaluru",
        dimensions: [
          {
            key: "mandate",
            label: "Mandate",
            importance: "Core",
            bucket: "Matched",
            jdEvidence: {
              status: "Explicit",
              value: "Scale direct-to-consumer e-commerce",
              evidence: [{ quote: "Scale direct-to-consumer e-commerce", source: "snippet" }],
            },
          },
          {
            key: "reportingLine",
            label: "Reporting Line",
            importance: "Core",
            bucket: "Matched",
            jdEvidence: {
              status: "Explicit",
              value: ",", // Invalid quote
              evidence: [{ quote: ",", source: "snippet" }],
            },
          },
        ],
        recommendation: "Unsafe historical narrative from legacy envelope",
        primaryDriver: "Unsafe legacy primary driver",
        primaryRisk: "Unsafe legacy primary risk",
        hiringRisk: "Critical",
        whyNow: "Unsafe why now",
      },
      record: {
        jobHash: "titan-growth-1",
        verb: "PURSUE",
        qualityScore: 92,
      },
      narrative: {
        recommendation: "Unsafe historical narrative from legacy envelope",
      },
    };

    const candCtx = { personId: "p1", attentionWindow: 6, activePursuits: 0 };
    const oppCtx = {
      jobHash: "titan-growth-1",
      role: "Head of Growth Marketing",
      company: "Titan",
      location: "Bengaluru",
    };

    const served = adaptLegacyEvaluation(storedPresentedEnvelope, candCtx, oppCtx, null);

    // Dimensions extracted and sanitized
    expect(served.dimensions).toHaveLength(2);
    expect(served.dimensions[0].key).toBe("mandate");
    expect(served.dimensions[0].jdEvidence.status).toBe("Explicit");
    expect(served.dimensions[0].jdEvidence.value).toBe("Scale direct-to-consumer e-commerce");

    // Invalid quote was demoted to Missing
    expect(served.dimensions[1].key).toBe("reportingLine");
    expect(served.dimensions[1].jdEvidence.status).toBe("Missing");
    expect(served.dimensions[1].jdEvidence.value).toBe("");

    // Legacy editorial narratives were NOT leaked into served DTO
    expect(served.recommendation).toBe("");
    expect(served.primaryDriver).toBeUndefined();
    expect(served.primaryRisk).toBeUndefined();
    expect(served.whyNow).toBeUndefined();
    expect(served.hiringRisk).toBe("Unknown");

    // Constitutional sufficiency recognizes the valid mandate dimension
    const sufficiency = AdvisoryConstitution.validateDataSufficiency(served);
    expect(sufficiency.state).toBe("EVALUATED");
    expect(sufficiency.isSufficient).toBe(true);
  });
});
