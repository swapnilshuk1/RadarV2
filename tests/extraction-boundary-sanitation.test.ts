import { describe, it, expect } from "vitest";
import { unwrapEvidenceValue, cleanOntologyConstants } from "../src/lib/intelligence/editorial/SemanticNaturalLanguageResolver";

describe("Phase 7 — Extraction Boundary Loss-Safe Sanitation", () => {
  it("Unwraps valid JSON object payload cleanly", () => {
    const raw = { value: "15+ years experience in Enterprise SaaS", status: "Explicit" };
    const res = unwrapEvidenceValue(raw);
    expect(res).toBe("15+ years experience in Enterprise SaaS");
  });

  it("Unwraps stringified JSON payload cleanly", () => {
    const raw = '{"value": "GROWTH_EXPANSION", "status": "Explicit"}';
    const res = unwrapEvidenceValue(raw);
    expect(res).toBe("Growth Expansion");
  });

  it("Sanitizes truncated or malformed JSON without leaking JSON brackets or crashing", () => {
    const rawTruncated = '{"value": "VP Growth and Operations", "status":';
    const res = unwrapEvidenceValue(rawTruncated);
    
    // Must not throw, must not leak raw JSON curly braces/quotes to executive UI
    expect(res).not.toContain('{"');
    expect(res).not.toContain('"status":');
  });

  it("Handles null, undefined, boolean, and empty string safely", () => {
    expect(unwrapEvidenceValue(null)).toBe("");
    expect(unwrapEvidenceValue(undefined)).toBe("");
    expect(unwrapEvidenceValue(true)).toBe("Required");
    expect(unwrapEvidenceValue(false)).toBe("Optional");
    expect(unwrapEvidenceValue("")).toBe("");
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
