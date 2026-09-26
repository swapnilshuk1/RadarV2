import { describe, expect, it } from "vitest";
import { extract } from "../../scripts/scraper/extract/extractor";
import type { DetailedCard } from "../../scripts/scraper/types";
import {
  DEFAULT_GEMINI_ENRICHMENT_LOCATION,
  DEFAULT_GEMINI_ENRICHMENT_MODEL,
  buildGeminiGenerationConfig,
  buildVertexGenerateContentUrl,
} from "../../scripts/scraper/enrich/gemini";
import {
  INTRINSIC_ENRICHMENT_SYSTEM_INSTRUCTION,
  buildIntrinsicEnrichmentPayload,
  validateIntrinsicEnrichmentPatch,
} from "../../scripts/scraper/enrich/intrinsic-contract";

describe("Gemini enrichment transport contract", () => {
  it("targets the documented Gemini 2.5 Flash replacement on the global Vertex endpoint", () => {
    expect(DEFAULT_GEMINI_ENRICHMENT_MODEL).toBe("gemini-3.5-flash-lite");
    expect(DEFAULT_GEMINI_ENRICHMENT_LOCATION).toBe("global");
    expect(buildVertexGenerateContentUrl("radar-project")).toBe(
      "https://aiplatform.googleapis.com/v1/projects/radar-project/locations/global/publishers/google/models/gemini-3.5-flash-lite:generateContent",
    );
  });

  it("uses minimal thinking and schema-constrained JSON without deprecated sampling controls", () => {
    const config = buildGeminiGenerationConfig(["mandate", "reportingLine"]) as any;
    expect(config.responseMimeType).toBe("application/json");
    expect(config.thinkingConfig).toEqual({ thinkingLevel: "MINIMAL" });
    expect(config.maxOutputTokens).toBe(1024);
    expect(config).not.toHaveProperty("temperature");
    expect(config).not.toHaveProperty("topP");
    expect(config).not.toHaveProperty("topK");
    expect(config.responseJsonSchema.required).toEqual(["mandate", "reportingLine"]);
    expect(config.responseJsonSchema.additionalProperties).toBe(false);
    const mandateSchema = config.responseJsonSchema.properties.mandate.anyOf[1];
    expect(mandateSchema.properties.value.enum).toEqual([
      "GREENFIELD", "SCALE", "TRANSFORMATION", "TURNAROUND", "INTEGRATION",
    ]);
    expect(mandateSchema.required).toEqual(["value", "source", "sourceSpan", "sourceStart", "sourceEnd"]);
    expect(mandateSchema.properties).not.toHaveProperty("rationale");
  });

  it("keeps candidate context out of intrinsic job enrichment", () => {
    const payload = buildIntrinsicEnrichmentPayload({
      title: "VP Growth",
      company: "Acme",
      location: "India",
      portal: "LinkedIn",
      applyUrl: "https://example.test/job",
      snippet: "Scale the business",
      detailText: "Reports to the CEO and owns P&L.",
      missingKeys: ["reportingLine"],
    } as any);
    expect(JSON.stringify(payload)).not.toContain("candidate");
    expect(payload).not.toHaveProperty("portal");
    expect(payload).not.toHaveProperty("applyUrl");
    expect(INTRINSIC_ENRICHMENT_SYSTEM_INSTRUCTION).toContain("untrusted source data");
    expect(INTRINSIC_ENRICHMENT_SYSTEM_INSTRUCTION).toContain("Never use candidate");
  });

  it("requires an exact provider-visible detail citation for non-null values", () => {
    const detailText = "The role reports to the CEO and owns the commercial budget.";
    const span = "reports to the CEO";
    const start = detailText.indexOf(span);
    const parsed = validateIntrinsicEnrichmentPatch({
      reportingLine: {
        value: "CEO",
        source: "detail",
        sourceSpan: span,
        sourceStart: start,
        sourceEnd: start + span.length,
      },
    }, { detailText, missingKeys: ["reportingLine"] });

    expect(parsed?.reportingLine).toEqual({
      value: "CEO",
      source: "detail",
      sourceSpan: span,
      sourceStart: start,
      sourceEnd: start + span.length,
    });
  });

  it("does not promote a non-null value with a fabricated or out-of-window citation", () => {
    const detailText = "The role reports to the CEO.";
    const fabricated = validateIntrinsicEnrichmentPatch({
      reportingLine: {
        value: "CEO",
        source: "detail",
        sourceSpan: "reports to the Board",
        sourceStart: 9,
        sourceEnd: 29,
      },
    }, { detailText, missingKeys: ["reportingLine"] });
    expect(fabricated?.reportingLine).toEqual({ value: null });

    const outsideVisiblePrefix = `${"x".repeat(6000)} reports to the CEO`;
    const span = "reports to the CEO";
    const start = outsideVisiblePrefix.indexOf(span);
    const outOfWindow = validateIntrinsicEnrichmentPatch({
      reportingLine: {
        value: "CEO",
        source: "detail",
        sourceSpan: span,
        sourceStart: start,
        sourceEnd: start + span.length,
      },
    }, { detailText: outsideVisiblePrefix, missingKeys: ["reportingLine"] });
    expect(outOfWindow?.reportingLine).toEqual({ value: null });
  });

  it("allows null without invented evidence", () => {
    expect(validateIntrinsicEnrichmentPatch({
      mandate: { value: null },
    }, { detailText: "A straightforward role description.", missingKeys: ["mandate"] }))
      .toEqual({ mandate: { value: null } });
  });

  it("persists validated LLM grounding as canonical JD evidence", async () => {
    const detail = "This role is accountable for the operating model.";
    const span = "operating model";
    const start = detail.indexOf(span);
    const snapshot: DetailedCard = {
      cardHash: "grounded-llm-fixture",
      title: "Strategy Lead",
      company: "Acme",
      location: "India",
      portal: "LinkedIn",
      detailUrl: "https://example.test/jobs/grounded-llm-fixture",
      rawText: "A sufficiently descriptive card summary for the enrichment gate.",
      snapshotSchemaVersion: "1.0.0",
      scraperVersion: "1.0.0",
      acquisitionRoute: "ATS_ENRICHED",
      enrichmentStatus: "ENRICHED_SUCCESS",
      detail: { fetched: true, rawHtml: "", rawText: detail, fetchDurationMs: 0 },
      telemetry: { cardExtractMs: 0, detailExtractMs: 0, totalMs: 0 },
    };
    const result = await extract(snapshot, {
      mode: "smart",
      provider: {
        id: "grounding-test-provider",
        async enrich(input) {
          const patch: Record<string, any> = {};
          for (const key of input.missingKeys) {
            patch[key] = key === "mandate"
              ? { value: "TRANSFORMATION", source: "detail", sourceSpan: span, sourceStart: start, sourceEnd: start + span.length }
              : { value: null };
          }
          return patch;
        },
      },
    });
    const mandate = result.dimensions.find((dimension) => dimension.key === "mandate");
    expect(mandate?.jdEvidence).toMatchObject({
      value: "TRANSFORMATION",
      provenance: "llm",
      evidence: [{ quote: span, source: "detail", sourceStart: start, sourceEnd: start + span.length }],
    });
  });

  it("does not let an adapter bypass grounding at the persistence boundary", async () => {
    const detail = "This role is accountable for the operating model.";
    const snapshot: DetailedCard = {
      cardHash: "ungrounded-llm-fixture",
      title: "Strategy Lead",
      company: "Acme",
      location: "India",
      portal: "LinkedIn",
      detailUrl: "https://example.test/jobs/ungrounded-llm-fixture",
      rawText: "A sufficiently descriptive card summary for the enrichment gate.",
      snapshotSchemaVersion: "1.0.0",
      scraperVersion: "1.0.0",
      acquisitionRoute: "ATS_ENRICHED",
      enrichmentStatus: "ENRICHED_SUCCESS",
      detail: { fetched: true, rawHtml: "", rawText: detail, fetchDurationMs: 0 },
      telemetry: { cardExtractMs: 0, detailExtractMs: 0, totalMs: 0 },
    };
    const result = await extract(snapshot, {
      mode: "smart",
      provider: {
        id: "ungrounded-test-provider",
        async enrich(input) {
          return Object.fromEntries(input.missingKeys.map((key) => [key,
            key === "mandate" ? { value: "TRANSFORMATION" } : { value: null },
          ]));
        },
      },
    });
    const mandate = result.dimensions.find((dimension) => dimension.key === "mandate");
    expect(mandate?.jdEvidence).toMatchObject({ value: null, status: "Missing" });
    expect(mandate?.jdEvidence.evidence).toEqual([]);
  });
});
