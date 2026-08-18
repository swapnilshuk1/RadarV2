import { describe, it, expect } from "vitest";
import { unwrapEvidenceValue, cleanOntologyConstants } from "../src/lib/intelligence/editorial/SemanticNaturalLanguageResolver";

describe("Extraction Boundary Loss-Safe Sanitation", () => {
  it("Unwraps valid JSON object payload cleanly", () => {
    const raw = { value: "15+ years experience in Enterprise SaaS", status: "Explicit" };
    const res = unwrapEvidenceValue(raw);
    expect(res).toBe("15+ years experience in Enterprise SaaS");
  });

  it("Unwraps valid stringified JSON payload cleanly", () => {
    const raw = '{"value": "GROWTH_EXPANSION", "status": "Explicit"}';
    const res = unwrapEvidenceValue(raw);
    expect(res).toBe("Growth Expansion");
  });

  it("Returns clean fallback (empty string) for malformed or truncated JSON without heuristic recovery", () => {
    // Truncated JSON
    const rawTruncated = '{"value": "VP Growth and Operations", "status":';
    expect(unwrapEvidenceValue(rawTruncated)).toBe("");

    // Malformed JSON (syntax error)
    const rawMalformed = '{"value": "Director of Commercial Sales", unclosed}';
    expect(unwrapEvidenceValue(rawMalformed)).toBe("");

    // Unclosed bracket JSON fragment
    const rawFragment = '{key: "broken"';
    expect(unwrapEvidenceValue(rawFragment)).toBe("");

    // Stray raw JSON value snippet
    const rawSnippet = '"value": "GTM Strategy"';
    expect(unwrapEvidenceValue(rawSnippet)).toBe("");
  });

  it("Handles null, undefined, boolean, and empty string safely", () => {
    expect(unwrapEvidenceValue(null)).toBe("");
    expect(unwrapEvidenceValue(undefined)).toBe("");
    expect(unwrapEvidenceValue(true)).toBe("Required");
    expect(unwrapEvidenceValue(false)).toBe("Optional");
    expect(unwrapEvidenceValue("")).toBe("");
  });

  it("Handles clean natural language strings without corruption", () => {
    expect(unwrapEvidenceValue("Chief Commercial Officer")).toBe("Chief Commercial Officer");
    expect(unwrapEvidenceValue("Enterprise Transformation")).toBe("Enterprise Transformation");
  });

  it("Handles nested canonicalValue arrays safely", () => {
    const raw = {
      canonicalValue: {
        products: ["SCALE_TRANSFORMATION", "PL_OWNERSHIP"]
      }
    };
    const res = unwrapEvidenceValue(raw);
    expect(res).toBe("Scale Transformation, P&L Ownership");
  });
});
