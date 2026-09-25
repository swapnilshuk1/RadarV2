import { describe, expect, it } from "vitest";
import {
  DEFAULT_GEMINI_ENRICHMENT_LOCATION,
  DEFAULT_GEMINI_ENRICHMENT_MODEL,
  buildGeminiGenerationConfig,
  buildVertexGenerateContentUrl,
} from "../../scripts/scraper/enrich/gemini";
import {
  INTRINSIC_ENRICHMENT_SYSTEM_INSTRUCTION,
  buildIntrinsicEnrichmentPayload,
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
    expect(config.responseJsonSchema.properties.mandate.properties.value.anyOf[0].enum).toEqual([
      "GREENFIELD", "SCALE", "TRANSFORMATION", "TURNAROUND", "INTEGRATION",
    ]);
    expect(config.responseJsonSchema.properties.mandate.properties).not.toHaveProperty("rationale");
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
  });
});
