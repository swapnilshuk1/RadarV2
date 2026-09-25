import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GROQ_CANDIDATE_EXTRACTION_MODEL,
  EvidenceExtractionService,
} from "../../src/lib/intelligence/extraction/EvidenceExtractionService";

describe("candidate evidence extraction contract", () => {
  afterEach(() => {
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_CANDIDATE_EXTRACTION_MODEL;
    vi.unstubAllGlobals();
  });

  it("uses a supported strict-schema Groq model and discards non-verbatim source spans", async () => {
    process.env.GROQ_API_KEY = "test-key";
    const request = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              facts: [
                {
                  type: "EMPLOYMENT",
                  value: "VP Growth Marketing",
                  confidence: 0.98,
                  sourceSpan: "Current role: VP Growth Marketing",
                  justification: "Explicit current role",
                },
                {
                  type: "ACHIEVEMENT",
                  value: "Invented claim",
                  confidence: 0.99,
                  sourceSpan: "This quotation is not in the source",
                  justification: "Should be rejected",
                },
              ],
            }),
          },
        }],
      }),
    });
    vi.stubGlobal("fetch", request);

    const service = new EvidenceExtractionService();
    const result = await service.extract({
      personId: "person-1",
      documentId: "doc-1",
      documentHash: "hash-1",
      documentText: "Current role: VP Growth Marketing",
    });

    expect(DEFAULT_GROQ_CANDIDATE_EXTRACTION_MODEL).toBe("qwen/qwen3.8-27b");
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].sourceSpan).toBe("Current role: VP Growth Marketing");

    const wire = JSON.parse(String(request.mock.calls[0][1].body));
    expect(wire.model).toBe("qwen/qwen3.8-27b");
    expect(wire.reasoning_effort).toBe("none");
    expect(wire.response_format.type).toBe("json_schema");
    expect(wire.response_format.json_schema.strict).toBe(true);
    expect(wire.messages[0].content).toContain("Current role: VP Growth Marketing");
  });
});
