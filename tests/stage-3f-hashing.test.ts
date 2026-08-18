import { describe, it, expect } from "vitest";

function simpleStringHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

function getOppContentHash(raw: any): string {
  const role = raw.role || "";
  const company = raw.company || "";
  const text = raw.description || raw.normalizedText || raw.rawText || raw.rawDescription || "";
  const dimsStr = Array.isArray(raw.dimensions)
    ? raw.dimensions.map((d: any) => `${d.key}:${d.label}:${d.jdEvidence?.status || ""}`).join(";")
    : "";
  return simpleStringHash(`${raw.jobHash || ""}|${role}|${company}|${text}|${dimsStr}`);
}

describe("Stage 3F — Content Hashing Optimization", () => {
  const baseOpp = {
    jobHash: "j-test-123",
    role: "VP of Product",
    company: "TechCorp",
    rawText: "Lead product strategy and engineering teams across global markets.",
    dimensions: [
      { key: "P&L", label: "P&L Ownership", jdEvidence: { status: "Explicit" } },
      { key: "Team", label: "Team Leadership", jdEvidence: { status: "Inferred" } }
    ]
  };

  it("same opportunity produces same signature", () => {
    const hash1 = getOppContentHash(baseOpp);
    const hash2 = getOppContentHash({ ...baseOpp });
    expect(hash1).toBe(hash2);
  });

  it("irrelevant object/reference changes produce same signature", () => {
    const hash1 = getOppContentHash(baseOpp);
    const hash2 = getOppContentHash({
      ...baseOpp,
      unrelatedMetadata: "extra-value",
      timestamp: Date.now()
    });
    expect(hash1).toBe(hash2);
  });

  it("relevant role or company changes invalidate signature", () => {
    const hashBase = getOppContentHash(baseOpp);
    const hashRoleChange = getOppContentHash({ ...baseOpp, role: "Chief Product Officer" });
    const hashCompanyChange = getOppContentHash({ ...baseOpp, company: "NewCo" });

    expect(hashRoleChange).not.toBe(hashBase);
    expect(hashCompanyChange).not.toBe(hashBase);
  });

  it("relevant JD content changes invalidate signature", () => {
    const hashBase = getOppContentHash(baseOpp);
    const hashJdChange = getOppContentHash({
      ...baseOpp,
      rawText: "Lead product strategy and engineering teams across global markets with $50M P&L."
    });

    expect(hashJdChange).not.toBe(hashBase);
  });

  it("dimensions changes invalidate signature", () => {
    const hashBase = getOppContentHash(baseOpp);
    const hashDimsChange = getOppContentHash({
      ...baseOpp,
      dimensions: [
        { key: "P&L", label: "P&L Ownership", jdEvidence: { status: "Explicit" } },
        { key: "Team", label: "Team Leadership", jdEvidence: { status: "Explicit" } }
      ]
    });

    expect(hashDimsChange).not.toBe(hashBase);
  });
});
