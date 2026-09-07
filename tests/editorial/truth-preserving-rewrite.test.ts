import { describe, expect, it } from "vitest";
import candidateProfileData from "@/data/candidate-profile.json";
import { CandidateEvidenceGraph } from "@/lib/intelligence/execution/CandidateEvidenceGraph";
import { TruthPreservingRewriteEngine } from "@/lib/intelligence/execution/TruthPreservingRewriteEngine";
import type { JobProjection } from "@/domain/job_projection";

function job(overrides: Partial<JobProjection> = {}): JobProjection {
  return {
    jobHash: "grounded-job",
    role: "Director of Influencer Marketing",
    company: "Social Beat",
    executiveIdentity: { value: "Director", confidence: 1, evidence: [] },
    operatingLevel: { value: "UNKNOWN", confidence: 0, reasoning: "" } as any,
    workNature: { value: "UNKNOWN", confidence: 0, reasoning: "" } as any,
    decisionAuthority: { value: "UNKNOWN", confidence: 0, reasoning: "" } as any,
    commercialScope: { value: "UNKNOWN", confidence: 0, reasoning: "" } as any,
    capabilities: [],
    executiveFunction: [],
    businessObjectives: [],
    executionStyle: [],
    operatingContext: {},
    location: "Gurugram",
    workModel: "UNKNOWN",
    capabilityExtractionStatus: "COMPLETE",
    dimensions: [],
    ...overrides,
  };
}

describe("TruthPreservingRewriteEngine employer relevance", () => {
  const graph = new CandidateEvidenceGraph(candidateProfileData);

  it("does not create CRM, commercial, or mandate cards from candidate evidence alone", () => {
    const result = TruthPreservingRewriteEngine.generateExecutionPackage(graph, job());
    const categories = result.package.resumeGaps.map((item) => item.category);

    expect(categories).not.toContain("Platform & Pipeline Governance");
    expect(categories).not.toContain("Commercial Scope & P&L Ownership");
    expect(categories).not.toContain("Commercial Scope & Portfolio Scale");
    expect(categories).not.toContain("Executive Mandate Alignment");
    expect(result.package.recommendationConditions).toEqual([]);
  });

  it("uses explicit employer CRM evidence and never synthetic requirement IDs", () => {
    const quote = "Salesforce CDP experience required for lifecycle operations.";
    const result = TruthPreservingRewriteEngine.generateExecutionPackage(graph, job({
      capabilityRequirements: [{ capability: "Salesforce", tier: "TECHNOLOGY_STACK", required: true, materiality: "CORE", evidenceIds: ["source-crm"], sourceQuotes: [quote] }],
    }));
    const item = result.package.resumeGaps.find((gap) => gap.category === "Platform & Pipeline Governance");

    expect(item?.targetRoleRequirement).toBe(quote);
    expect(item?.jdRequirementIds).toEqual(["source-crm"]);
    expect(item?.jdRequirementIds).not.toContain("jd_crm_mandate");
  });

  it("uses explicit commercial and mandate dimensions only when present", () => {
    const commercialQuote = "Own the marketing P&L and commercial performance.";
    const mandateQuote = "Lead the influencer growth mandate across priority campaigns.";
    const result = TruthPreservingRewriteEngine.generateExecutionPackage(graph, job({
      dimensions: [
        { key: "commercialAccountability", label: "Commercial", importance: "Core", bucket: "Matched", jdEvidence: { status: "Explicit", value: commercialQuote, evidence: [{ quote: commercialQuote }] } },
        { key: "mandate", label: "Mandate", importance: "Core", bucket: "Matched", jdEvidence: { status: "Explicit", value: mandateQuote, evidence: [{ quote: mandateQuote }] } },
      ],
    }));
    const commercial = result.package.resumeGaps.find((gap) => gap.category.includes("Commercial Scope"));
    const mandate = result.package.resumeGaps.find((gap) => gap.category === "Executive Mandate Alignment");

    expect(commercial?.targetRoleRequirement).toBe(commercialQuote);
    expect(commercial?.jdRequirementIds).not.toContain("jd_commercial_pl_mandate");
    expect(mandate?.targetRoleRequirement).toBe(mandateQuote);
    expect(mandate?.jdRequirementIds).not.toContain("jd_exec_mandate");
  });

  it("uses only explicit conditions, not title, company, or geography metadata", () => {
    const bare = TruthPreservingRewriteEngine.generateExecutionPackage(graph, job());
    expect(bare.package.recommendationConditions).toEqual([]);

    const quote = "Hybrid — 3 days in the Gurugram HQ.";
    const explicit = TruthPreservingRewriteEngine.generateExecutionPackage(graph, job({
      dimensions: [{ key: "workModel", label: "Work model", importance: "Context", bucket: "Matched", jdEvidence: { status: "Explicit", value: quote, evidence: [{ quote }] } }],
    }));
    expect(explicit.package.recommendationConditions).toContain(`Published role evidence: ${quote}`);
    expect(explicit.package.recommendationConditions).not.toContain("Published role evidence: Director of Influencer Marketing");
    expect(explicit.package.recommendationConditions).not.toContain("Published role evidence: Gurugram");
  });
});
