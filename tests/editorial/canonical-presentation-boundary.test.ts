import { describe, expect, it } from "vitest";
import type { OpportunitySource } from "@/data/opportunity-fixtures";
import type { RecommendationRecord } from "@/lib/intelligence/record";
import { JobProjectionBuilder } from "@/lib/intelligence/builders/JobProjectionBuilder";
import { present } from "@/lib/intelligence/present";
import { TruthPreservingRewriteEngine } from "@/lib/intelligence/execution/TruthPreservingRewriteEngine";
import candidateProfileData from "@/data/candidate-profile.json";
import { CandidateEvidenceGraph } from "@/lib/intelligence/execution/CandidateEvidenceGraph";

const socialBeatDescription = `
Develop and execute influencer marketing strategies across key client accounts.
Build creator partnerships, monitor and analyze influencer performance, and achieve storefront metrics.
Strong planning skills and the ability to translate marketing strategy into campaign execution are required.
`;

const baseRecord: RecommendationRecord = {
  jobHash: "boundary-test-job",
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
  explanation: { missingEvidence: ["reporting line"], contradictionFlags: [] },
  trace: { pipeline: [], evidenceMapping: [], careerValueBreakdown: {} },
  headspace: { finalVerb: "PURSUE", downgraded: false },
} as unknown as RecommendationRecord;

describe("Canonical vs Presentation Boundary", () => {
  const graph = new CandidateEvidenceGraph(candidateProfileData);

  it("Test 1: Canonical JobProjection retains explicit classifier dimensions for Social Beat", () => {
    const projection = JobProjectionBuilder.build({
      jobHash: "canonical-social-beat",
      role: "Director of Influencer Marketing",
      company: "Social Beat",
      location: "Gurugram",
      rawDescription: socialBeatDescription,
      dimensions: [],
    } as any);

    const mandateDim = projection.dimensions?.find((d) => d.key === "mandate");
    const commercialDim = projection.dimensions?.find((d) => d.key === "commercialScope");
    const decisionDim = projection.dimensions?.find((d) => d.key === "decisionAuthority");

    expect(mandateDim).toBeDefined();
    expect(mandateDim?.jdEvidence.status).toBe("Explicit");
    expect(commercialDim).toBeDefined();
    expect(commercialDim?.jdEvidence.status).toBe("Explicit");
    expect(decisionDim).toBeDefined();
    expect(decisionDim?.jdEvidence.status).toBe("Explicit");

    expect(projection.trueExecutiveMandate).toBeDefined();
    expect(projection.commercialScope.value).toBeDefined();
    expect(projection.decisionAuthority.value).toBeDefined();
  });

  it("Test 2: Presentation sanitization turns ungrounded employer dimensions into Missing", () => {
    const projection = JobProjectionBuilder.build({
      jobHash: "presentation-social-beat",
      role: "Director of Influencer Marketing",
      company: "Social Beat",
      location: "Gurugram",
      rawDescription: socialBeatDescription,
      dimensions: [],
    } as any);

    const source: OpportunitySource = {
      jobHash: projection.jobHash,
      role: projection.role,
      company: projection.company,
      location: projection.location,
      rawDescription: socialBeatDescription,
      dimensions: projection.dimensions as any,
    };

    const presented = present(source, { ...baseRecord, jobHash: source.jobHash });

    const mandateDim = presented.opportunity.dimensions.find((d) => d.key === "mandate");
    const commercialDim = presented.opportunity.dimensions.find((d) => d.key === "commercialScope");
    const decisionDim = presented.opportunity.dimensions.find((d) => d.key === "decisionAuthority");
    const workModelDim = presented.opportunity.dimensions.find((d) => d.key === "workModel");

    expect(mandateDim?.jdEvidence.status).toBe("Missing");
    expect(commercialDim?.jdEvidence.status).toBe("Missing");
    expect(decisionDim?.jdEvidence.status).toBe("Missing");
    expect(workModelDim?.jdEvidence.status).toBe("Missing");
  });

  it("Test 3: Grounded employer dimension survives presentation", () => {
    const source: OpportunitySource = {
      jobHash: "grounded-mandate-survives",
      role: "Director of Influencer Marketing",
      company: "Social Beat",
      location: "Gurugram",
      rawDescription: "The executive charter and mandate is to scale influencer growth.",
      dimensions: [
        {
          key: "mandate",
          label: "Mandate",
          importance: "Core",
          bucket: "Matched",
          jdEvidence: {
            status: "Explicit",
            value: "The executive charter and mandate is to scale influencer growth.",
            evidence: [{ quote: "The executive charter and mandate is to scale influencer growth.", source: "snippet" }],
          },
        },
      ],
    };

    const presented = present(source, { ...baseRecord, jobHash: source.jobHash });
    const mandateDim = presented.opportunity.dimensions.find((d) => d.key === "mandate");

    expect(mandateDim?.jdEvidence.status).toBe("Explicit");
    expect(mandateDim?.jdEvidence.evidence[0]?.quote).toContain("mandate");
  });

  it("Test 4: Candidate proof on source dimension survives presentation", () => {
    const candidateProof = {
      headline: "Recorded leadership evidence",
      detail: "Led multi-market creator programs across enterprise accounts.",
    };

    const source: OpportunitySource = {
      jobHash: "candidate-proof-survives",
      role: "Director of Influencer Marketing",
      company: "Social Beat",
      location: "Gurugram",
      rawDescription: socialBeatDescription,
      dimensions: [
        {
          key: "functionalScope",
          label: "Functional Scope",
          importance: "Core",
          bucket: "Matched",
          jdEvidence: {
            status: "Explicit",
            value: "Director of Influencer Marketing",
            evidence: [{ quote: "Director of Influencer Marketing", source: "snippet" }],
          },
          candidateProof,
        },
      ],
    };

    const presented = present(source, { ...baseRecord, jobHash: source.jobHash });
    const functionalDim = presented.opportunity.dimensions.find((d) => d.key === "functionalScope");

    expect(functionalDim?.candidateProof).toEqual(candidateProof);
  });

  it("Test 5: TruthPreservingRewriteEngine on presented Social Beat dimensions emits NO commercial or mandate cards", () => {
    const projection = JobProjectionBuilder.build({
      jobHash: "presented-rewrite-clean",
      role: "Director of Influencer Marketing",
      company: "Social Beat",
      location: "Gurugram",
      rawDescription: socialBeatDescription,
      dimensions: [],
    } as any);

    const source: OpportunitySource = {
      jobHash: projection.jobHash,
      role: projection.role,
      company: projection.company,
      location: projection.location,
      rawDescription: socialBeatDescription,
      dimensions: projection.dimensions as any,
    };

    const presented = present(source, { ...baseRecord, jobHash: source.jobHash });

    const presentationJob = {
      ...projection,
      dimensions: presented.opportunity.dimensions as any,
    };

    const result = TruthPreservingRewriteEngine.generateExecutionPackage(graph, presentationJob);

    const categories = result.package.resumeGaps.map((gap) => gap.category);
    expect(categories).not.toContain("Commercial Scope & P&L Ownership");
    expect(categories).not.toContain("Commercial Scope & Portfolio Scale");
    expect(categories).not.toContain("Executive Mandate Alignment");
    expect(result.package.recommendationConditions).toEqual([]);
  });
});
