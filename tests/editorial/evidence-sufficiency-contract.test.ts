import { describe, expect, it } from "vitest";
import type { Opportunity } from "@/data/opportunity-fixtures";
import { AdvisoryConstitution } from "@/lib/intelligence/editorial/AdvisoryConstitution";
import { BriefCompositionEngine } from "@/lib/intelligence/editorial/BriefCompositionEngine";
import { EditorialContextBuilder } from "@/lib/intelligence/editorial/EditorialContext";
import { EditorialEngine } from "@/lib/intelligence/editorial/EditorialEngine";
import { PreviewCompositionEngine } from "@/lib/intelligence/editorial/PreviewCompositionEngine";
import { getBriefProvenanceLabel } from "@/components/radar/opportunity/surfaces/ExecutiveBriefingSurface";
import { buildCanonicalDossierPresentation } from "@/lib/intelligence/dossier/CanonicalDossierBuilder";
import { JobProjectionBuilder } from "@/lib/intelligence/builders/JobProjectionBuilder";
import { DEFAULT_CANDIDATE_PROJECTION } from "@/lib/domain/candidate_projection";

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
    expect(brief.executiveOpinion).toContain("Published evidence is partial");
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

  it("uses recorded driver, risk, and proof rather than generic partial-assessment prose", () => {
    const driver = "Recorded driver: creator-market strategy aligns with the current search plan.";
    const risk = "Recorded risk: published decision rights remain unresolved.";
    const brief = BriefCompositionEngine.compose(sparseOpportunity({
      primaryDriver: driver,
      primaryRisk: risk,
      primaryProof: { headline: "Recorded candidate proof", detail: "Distinctive recorded proof detail." },
      dimensions: [{
        key: "functionalScope",
        label: "Functional Scope",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: { status: "Explicit", value: "Lead influencer strategy", evidence: [{ quote: "Lead influencer strategy", source: "snippet" }] },
      }] as Opportunity["dimensions"],
      engineRecommendation: { engineVerdict: "PURSUE", qualityScore: 72, triggeredRuleIds: [] } as any,
    }));

    expect(brief.memory.decision).toBe("PURSUE");
    expect(brief.qualityScore).toBe(72);
    expect(brief.executiveOpinion).toBe(driver);
    expect(brief.structuredSections.context.thesis).toBe(driver);
    expect(brief.oneMinuteTLDR.whyPursue).toContain(driver);
    expect(brief.memory.primaryRisk).toBe(risk);
    expect(brief.oneMinuteTLDR.watchFor).toContain(risk);
    expect(brief.proofPoints).toContainEqual(expect.objectContaining({ headline: "Recorded candidate proof", detail: "Distinctive recorded proof detail." }));
    expect(JSON.stringify(brief)).not.toContain("RADAR's recorded PURSUE assessment is available; role facts below are limited to published evidence.");
  });

  it("keeps a long but employer-thin evaluated dossier evidence-bound", () => {
    const description = [
      "Social Beat is seeking a Director of Influencer Marketing.",
      "Monitor and analyze influencer performance and achieve storefront metrics.",
      "Build creator partnerships and coordinate published campaign activity.",
      "The posting does not state a reporting line, P&L ownership, hiring budget, board relationship, or decision rights.",
    ].join(" ").repeat(2);
    const opportunity = sparseOpportunity({
      jobHash: "social-beat-employer-thin",
      role: "Director of Influencer Marketing",
      company: "Social Beat",
      location: "Gurugram",
      description,
      rawDescription: description,
      dimensions: [{
        key: "functionalScope",
        label: "Functional Scope",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: {
          status: "Explicit",
          value: "Monitor influencer performance",
          evidence: [{ quote: "Monitor and analyze influencer performance and achieve storefront metrics.", source: "JD" }],
        },
      }] as Opportunity["dimensions"],
      engineRecommendation: {
        engineVerdict: "PURSUE",
        qualityScore: 72,
        triggeredRuleIds: [],
      } as any,
    });
    const dossier = buildCanonicalDossierPresentation(
      { opportunity, jobProjection: JobProjectionBuilder.build(opportunity) } as any,
      DEFAULT_CANDIDATE_PROJECTION,
      "evaluation-hash",
      "2026-09-08T00:00:00.000Z",
      "2026-09-07T00:00:00.000Z",
    );
    const rendered = JSON.stringify(dossier);

    expect(dossier.brief.memory.decision).toBe("PURSUE");
    expect(dossier.brief.qualityScore).toBe(72);
    expect(dossier.brief.rankedUnknowns.map((unknown: { label: string }) => unknown.label)).toContain("Reporting line");
    expect(dossier.brief.rankedUnknowns.map((unknown: { label: string }) => unknown.label)).toContain("Decision rights");
    expect(dossier.brief.decisionSensitivity).toEqual({ becomesPursueIf: [], becomesPassIf: [] });
    expect(dossier.brief.executiveThesis).toBeDefined();
    expect(dossier.jobProjection).toBeDefined();
    expect(dossier.executionPackage).toBeDefined();
    expect(dossier.rawDimensions).toHaveLength(1);
    expect(rendered).not.toMatch(/Enterprise P&L|headcount hiring budget|25 FTE|board-level commercial reporting|founder-led|Direct P&L responsibility/i);
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

  it("keeps a long evaluated preview evidence-limited without grounded mandate evidence", () => {
    const opportunity = sparseOpportunity({
      description: "A".repeat(220),
      recommendation: "Unsafe historical recommendation",
      primaryDriver: "Unsafe P&L claim",
      primaryRisk: "Unsafe board claim",
    });
    const preview = PreviewCompositionEngine.compose(opportunity);
    expect(`${preview.headline} ${preview.narrative} ${preview.whyItWorks} ${preview.watchFor}`).not.toMatch(/unsafe|P&L claim|board claim/i);
    expect(preview.narrative).toContain("does not provide enough evidence");
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


  it("does NOT render an evaluated canonical opportunity using composeEvidenceLimitedBrief when mandate quote is absent", () => {
    const opportunity = sparseOpportunity({
      role: "Director of Influencer Marketing",
      company: "Social Beat",
      location: "Gurugram",
      dimensions: [{
        key: "functionalScope",
        label: "Functional Scope",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: {
          status: "Explicit",
          value: "Monitor influencer performance",
          evidence: [{ quote: "Monitor and analyze influencer performance and achieve storefront metrics.", source: "JD" }],
        },
      }] as Opportunity["dimensions"],
      engineRecommendation: {
        engineVerdict: "PURSUE",
        qualityScore: 72,
        triggeredRuleIds: ["CAREER_STEP_UP"],
        relativeDifferentiator: "First director-level role in influencer marketing",
      } as any,
    });

    const brief = BriefCompositionEngine.compose(opportunity, { canonicalEvidenceBound: true });

    // Assert canonical qualityScore and verdict remain intact
    expect(brief.qualityScore).toBe(72);
    expect(brief.memory.decision).toBe("PURSUE");
    expect(brief.executiveThesis.verdict).toBe("PURSUE");

    // Context thesis uses recorded intelligence / role evidence
    expect(brief.structuredSections.context.thesis).toBeTruthy();
    expect(brief.structuredSections.context.thesis).not.toMatch(/^Assessment pending:/i);
    expect(brief.structuredSections.context.thesis).not.toMatch(/recommendation cannot be made/i);
    expect(brief.memory.retentionSentence).not.toMatch(/recommendation cannot be made/i);

    // Explicit SPARSE_SPEC still uses the evidence-limited path
    const sparseOpp = sparseOpportunity({
      evaluationState: "SPARSE_SPEC",
      engineRecommendation: {
        engineVerdict: "PURSUE",
        qualityScore: 72,
      } as any,
    });
    const sparseBrief = BriefCompositionEngine.compose(sparseOpp, { canonicalEvidenceBound: true });
    expect(sparseBrief.memory.headline).toMatch(/^Assessment pending:/i);
    expect(sparseBrief.structuredSections.context.thesis).toMatch(/published role specification is sparse/i);
  });

});
