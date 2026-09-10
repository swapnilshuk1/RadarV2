import { describe, expect, it } from "vitest";
import candidateProfileData from "@/data/candidate-profile.json";
import { CandidateEvidenceGraph } from "@/lib/intelligence/execution/CandidateEvidenceGraph";
import { TruthPreservingRewriteEngine } from "@/lib/intelligence/execution/TruthPreservingRewriteEngine";
import { JobProjectionBuilder } from "@/lib/intelligence/builders/JobProjectionBuilder";
import type { JobProjection } from "@/domain/job_projection";
import { present } from "@/lib/intelligence/present";
import type { OpportunitySource } from "@/data/opportunity-fixtures";
import type { RecommendationRecord } from "@/lib/intelligence/record";

const baseRecord: RecommendationRecord = {
  jobHash: "test-job",
  engineVersion: "4.3",
  recommendationVersion: "test",
  verb: "PURSUE",
  qualityScore: 72,
  rawScore: 72,
  priority: 72,
  vetoed: false,
  claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: [] },
  confidence: 0.8,
  decisionSummary: { careerValue: 1, shortlistingPotential: 1, pursuitFriction: 1 },
  decisionDrivers: [],
  decisionRisks: [],
  confidences: { parsing: 0.8, matching: 0.8, recommendation: 0.8 },
  stability: "High",
  comparison: { higherThan: [], lowerThan: [] },
  explanation: { missingEvidence: [], contradictionFlags: [] },
  trace: { pipeline: [], evidenceMapping: [], careerValueBreakdown: {} },
  headspace: { finalVerb: "PURSUE", downgraded: false },
} as unknown as RecommendationRecord;

function presentJob(projection: JobProjection, rawDescription = ""): JobProjection {
  const source: OpportunitySource = {
    jobHash: projection.jobHash,
    role: projection.role,
    company: projection.company,
    location: projection.location,
    rawDescription,
    dimensions: projection.dimensions as any,
  };
  const presented = present(source, { ...baseRecord, jobHash: source.jobHash });
  return {
    ...projection,
    dimensions: presented.opportunity.dimensions as any,
  };
}

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

  it("keeps Social Beat inferred mandate, commercial scope, and authority out of employer evidence", () => {
    const rawDescription = `
      Develop and execute influencer marketing strategies across key client accounts.
      Build creator partnerships, monitor and analyze influencer performance, and achieve storefront metrics.
      Strong planning skills and the ability to translate marketing strategy into campaign execution are required.
    `;
    const socialBeat = JobProjectionBuilder.build({
      jobHash: "social-beat-no-commercial-mandate",
      role: "Director of Influencer Marketing",
      company: "Social Beat",
      location: "Gurugram",
      rawDescription,
      dimensions: [],
    } as any);
    const presented = presentJob(socialBeat, rawDescription);
    const dimensions = new Map((presented.dimensions || []).map((dimension) => [dimension.key, dimension]));
    const result = TruthPreservingRewriteEngine.generateExecutionPackage(graph, presented);
    const categories = result.package.resumeGaps.map((item) => item.category);

    expect(dimensions.get("mandate")?.jdEvidence.status).toBe("Missing");
    expect(dimensions.get("commercialScope")?.jdEvidence.status).toBe("Missing");
    expect(dimensions.get("decisionAuthority")?.jdEvidence.status).toBe("Missing");
    expect(dimensions.get("workModel")?.jdEvidence.status).toBe("Missing");
    expect(socialBeat.trueExecutiveMandate).toBeDefined();
    expect(socialBeat.commercialScope.value).toBeDefined();
    expect(socialBeat.decisionAuthority.value).toBeDefined();
    expect(categories).not.toContain("Commercial Scope & P&L Ownership");
    expect(categories).not.toContain("Commercial Scope & Portfolio Scale");
    expect(categories).not.toContain("Executive Mandate Alignment");
    expect(result.package.recommendationConditions).toEqual([]);
    expect(JSON.stringify(result.package.recommendationConditions)).not.toContain("UNKNOWN");
    expect(JSON.stringify(result.package.recommendationConditions)).not.toContain("Gurugram");
    expect(JSON.stringify(result.package.recommendationConditions)).not.toContain("Strong planning skills");
  });

  it("does not promote generic commercial objectives or capability requirements into ownership evidence", () => {
    const rawDescription = `
      Drive revenue outcomes, profitability, margin improvement, and commercial metrics.
      Strong commercial acumen and budget planning experience required.
    `;
    const projection = JobProjectionBuilder.build({
      jobHash: "generic-commercial-objectives-no-ownership",
      role: "Director of Influencer Marketing",
      company: "Social Beat",
      location: "Gurugram",
      rawDescription,
      dimensions: [],
    } as any);
    const presented = presentJob(projection, rawDescription);
    const result = TruthPreservingRewriteEngine.generateExecutionPackage(graph, presented);
    const categories = result.package.resumeGaps.map((gap) => gap.category);

    expect(projection.commercialScope.value).toBeDefined();
    expect(presented.dimensions?.find((dimension) => dimension.key === "commercialScope")?.jdEvidence.status).toBe("Missing");
    expect(presented.dimensions?.find((dimension) => dimension.key === "commercialAccountability")?.jdEvidence.status ?? "Missing").toBe("Missing");
    expect(categories).not.toContain("Commercial Scope & P&L Ownership");
    expect(categories).not.toContain("Commercial Scope & Portfolio Scale");
  });

  it("uses published end-to-end P&L ownership for commercial coaching", () => {
    const commercialQuote = "Own the end-to-end P&L for influencer growth across priority markets.";
    const projection = JobProjectionBuilder.build({
      jobHash: "published-commercial-ownership",
      role: "Director of Influencer Marketing",
      company: "Social Beat",
      location: "Gurugram",
      rawDescription: commercialQuote,
      dimensions: [
        {
          key: "commercialScope",
          label: "Commercial Scope",
          importance: "Core",
          bucket: "Matched",
          jdEvidence: {
            status: "Explicit",
            value: commercialQuote,
            evidence: [{ quote: commercialQuote, source: "snippet" }],
          },
        },
      ],
    } as any);
    const presented = presentJob(projection, commercialQuote);
    const result = TruthPreservingRewriteEngine.generateExecutionPackage(graph, presented);
    const commercial = result.package.resumeGaps.find((gap) => gap.category.includes("Commercial Scope"));

    expect(presented.dimensions?.find((dimension) => dimension.key === "commercialScope")?.jdEvidence.status).toBe("Explicit");
    expect(commercial?.targetRoleRequirement).toBe(commercialQuote);
  });

  it("does not promote generic influencer responsibilities into an executive mandate", () => {
    const rawDescription = `
      Lead influencer marketing strategy across client accounts.
      Drive creator performance and campaign outcomes.
      Responsible for campaign execution and performance analysis.
    `;
    const projection = JobProjectionBuilder.build({
      jobHash: "generic-influencer-responsibilities-no-mandate",
      role: "Director of Influencer Marketing",
      company: "Social Beat",
      location: "Gurugram",
      rawDescription,
      dimensions: [],
    } as any);
    const presented = presentJob(projection, rawDescription);
    const result = TruthPreservingRewriteEngine.generateExecutionPackage(graph, presented);

    expect(projection.trueExecutiveMandate).toBeDefined();
    expect(presented.dimensions?.find((dimension) => dimension.key === "mandate")?.jdEvidence.status).toBe("Missing");
    expect(result.package.resumeGaps.map((gap) => gap.category)).not.toContain("Executive Mandate Alignment");
  });

  it("uses published mandate language for executive mandate coaching", () => {
    const mandateQuote = "The mandate is to lead influencer growth across priority markets.";
    const projection = JobProjectionBuilder.build({
      jobHash: "published-influencer-mandate",
      role: "Director of Influencer Marketing",
      company: "Social Beat",
      location: "Gurugram",
      rawDescription: mandateQuote,
      dimensions: [
        {
          key: "mandate",
          label: "Mandate",
          importance: "Core",
          bucket: "Matched",
          jdEvidence: {
            status: "Explicit",
            value: mandateQuote,
            evidence: [{ quote: mandateQuote, source: "snippet" }],
          },
        },
      ],
    } as any);
    const presented = presentJob(projection, mandateQuote);
    const result = TruthPreservingRewriteEngine.generateExecutionPackage(graph, presented);
    const mandate = result.package.resumeGaps.find((gap) => gap.category === "Executive Mandate Alignment");

    expect(presented.dimensions?.find((dimension) => dimension.key === "mandate")?.jdEvidence.status).toBe("Explicit");
    expect(mandate?.targetRoleRequirement).toBe(mandateQuote);
  });

  it("fails closed when inherited Social Beat dimensions only cite classifier metadata", () => {
    const projection = JobProjectionBuilder.build({
      jobHash: "social-beat-inherited-classifier-dimensions",
      role: "Director of Influencer Marketing",
      company: "Social Beat",
      location: "Gurugram",
      description: "Monitor influencer performance, build creator partnerships, and coordinate campaign activity.",
      dimensions: [
        { key: "mandate", label: "Mandate", importance: "Core", bucket: "Matched", jdEvidence: { status: "Explicit", value: "ACCELERATE_GROWTH", evidence: [{ quote: "Director of Influencer Marketing" }] } },
        { key: "commercialScope", label: "Commercial Scope", importance: "Core", bucket: "Matched", jdEvidence: { status: "Explicit", value: "PORTFOLIO", evidence: [{ quote: "Director of Influencer Marketing" }] } },
        { key: "decisionAuthority", label: "Decision Authority", importance: "Core", bucket: "Matched", jdEvidence: { status: "Explicit", value: "FUNCTION", evidence: [{ quote: "Director of Influencer Marketing" }] } },
        { key: "workModel", label: "Work Model", importance: "Supporting", bucket: "Matched", jdEvidence: { status: "Explicit", value: "HYBRID", evidence: [{ quote: "Gurugram" }] } },
      ],
    } as any);
    const presented = presentJob(projection);

    for (const key of ["mandate", "commercialScope", "decisionAuthority", "workModel"]) {
      expect(presented.dimensions?.find((dimension) => dimension.key === key)?.jdEvidence.status).toBe("Missing");
    }
  });

  it("uses explicit employer CRM evidence and never synthetic requirement IDs", () => {
    const quote = "Salesforce CDP experience required for lifecycle operations.";
    const result = TruthPreservingRewriteEngine.generateExecutionPackage(graph, job({
      capabilityRequirements: [{ capability: "Salesforce", tier: "TECHNOLOGY_STACK", required: true, materiality: "CORE", evidenceIds: ["source-crm"], sourceQuotes: [quote] }],
    }));
    const item = result.package.resumeGaps.find((gap) => gap.category === "Platform & Pipeline Governance");

    expect(item).toBeDefined();
    expect(item?.targetRoleRequirement).toBe(quote);
    expect(item?.jdRequirementIds).toEqual(["source-crm"]);
    expect(item?.jdRequirementIds).not.toContain("jd_crm_mandate");
    expect(result.package.resumeGaps.map((gap) => gap.category)).not.toContain("Executive Mandate Alignment");
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
