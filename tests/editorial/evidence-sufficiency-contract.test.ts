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
});
