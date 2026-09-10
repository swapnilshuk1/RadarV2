import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Opportunity } from "@/data/opportunity-fixtures";
import type { CandidateProjection } from "@/lib/domain/candidate_projection";
import type { EvidenceMatch } from "@/lib/domain/semantic";
import type { EvaluationArtifact } from "@/lib/intelligence/engine";
import { buildEditorialIntelligenceContract } from "@/lib/intelligence/editorial/EditorialIntelligenceContractBuilder";
import { substantiveCandidateEvidence } from "@/lib/intelligence/editorial/CandidateProofPolicy";

const candidate: CandidateProjection = {
  operatingLevel: { value: "STRATEGIC", confidence: 0.8, evidenceIds: [] },
  workNature: { value: "STRATEGIC_WORK", confidence: 0.8, evidenceIds: [] },
  decisionAuthority: { value: "ENTERPRISE", confidence: 0.8, evidenceIds: [] },
  commercialScope: { value: "ENTERPRISE", confidence: 0.8, evidenceIds: [] },
  yearsOfExperience: 15,
  coreCapabilities: ["Marketing Strategy"],
  preferredLocations: [],
  preferredWorkModel: "ANY",
  executiveThemes: [],
  inferredCapabilities: [
    {
      name: "Marketing Strategy",
      confidence: 0.82,
      evidenceIds: ["candidate-1"],
      supportingEvidence: [{
        id: "candidate-1",
        quote: "Led multi-market creator growth programs and improved campaign performance through disciplined measurement.",
        relation: "SUPPORTS_INFERENCE",
      }],
    },
    {
      name: "Enterprise P&L Ownership & ENTERPRISE | Board Decision Authority",
      confidence: 0.95,
      evidenceIds: ["taxonomy"],
      supportingEvidence: [{ id: "taxonomy", quote: "Enterprise P&L Ownership & ENTERPRISE | Board Decision Authority", relation: "SUPPORTS_INFERENCE" }],
    },
  ],
  semanticEvidence: [{
    canonicalConcept: "Creator partnerships",
    entityType: "CAPABILITY",
    semanticRelationship: "EXACT",
    evidenceRelationship: "DIRECT_EQUIVALENT",
    direction: "BIDIRECTIONAL_EQUIVALENT",
    confidence: 0.81,
    sourcePhrase: "Led creator partnership programs across consumer brands.",
    context: "Led creator partnership programs across consumer brands and improved campaign performance through structured measurement.",
    negated: false,
    temporalState: "HISTORICAL",
    evidenceStrength: "DIRECT_OWNERSHIP",
    metadata: { sourceId: "semantic-candidate-1" },
  }],
};

const defaultMappings: EvidenceMatch[] = [
  { jobCapability: "Marketing Strategy", candidateCapability: "Marketing Strategy", confidence: 0.9, reason: "Direct Explicit Evidence Match" },
  { jobCapability: "Creator partnerships", candidateCapability: "Creator partnerships", confidence: 0.9, reason: "Strong Semantic Equivalent" },
];

function artifact(
  dimensions: Opportunity["dimensions"],
  evidenceMapping: EvidenceMatch[] = defaultMappings,
): EvaluationArtifact {
  const roleWorkEvidence = (dimensions ?? [])
    .flatMap((dimension) => {
      if (dimension.jdEvidence?.status !== "Explicit") return [];
      const statement = typeof dimension.jdEvidence.value === "string"
        ? dimension.jdEvidence.value.replace(/\s+/g, " ").trim()
        : "";
      if (!statement || /^[A-Z0-9_]+$/.test(statement)) return [];
      return [{
        id: `fixture:${dimension.key}`,
        kind: "RESPONSIBILITY" as const,
        statement,
        sourceQuote: statement,
        sourceRegion: "RESPONSIBILITIES" as const,
        ordinal: 1,
        capabilityKeys: [],
        confidence: 0.95,
      }];
    });
  const successCondition = "Build and develop creator partnerships across priority accounts.";
  roleWorkEvidence.push({
    id: "fixture:success-conditions",
    kind: "RESPONSIBILITY" as const,
    statement: successCondition,
    sourceQuote: successCondition,
    sourceRegion: "RESPONSIBILITIES" as const,
    ordinal: 1,
    capabilityKeys: ["Creator partnerships"],
    confidence: 0.95,
  });
  return {
    record: { trace: { evidenceMapping } },
    opportunity: {
      jobHash: "contract-role",
      role: "Director of Influencer Marketing",
      company: "Social Beat",
      location: "Gurugram",
      scrapedFrom: "LinkedIn",
      decision: "PURSUE",
      recommendation: "Pursue",
      primaryConcern: null,
      positioning: ["Lead with creator growth precedent."],
      headspace: [],
      hiringRisk: "Validate reporting scope before committing interview time.",
      dimensions,
      primaryDriver: "A grounded candidate precedent aligns with the published creator-growth work.",
      recommendedAction: "Proceed with screening and clarify reporting scope.",
      engineRecommendation: {
        jobHash: "contract-role",
        evaluationFingerprint: "fp",
        engineVerdict: "PURSUE",
        vetoed: false,
        qualityScore: 72,
        evaluatedAt: "2026-09-09T00:00:00.000Z",
      },
    } as Opportunity,
    jobProjection: {
      capabilities: [
        { name: "Marketing Strategy", tier: "CORE_MANDATE" },
        { name: "Creator partnerships", tier: "EXECUTION_CAPABILITY" },
      ],
      executiveMission: { successConditions: ["Build and develop creator partnerships across priority accounts."] },
      roleWorkEvidence,
    },
  };
}

function makeCandidateProjection(overrides: Partial<CandidateProjection>): CandidateProjection {
  return { ...candidate, ...overrides };
}

function artifactWithRoleEvidence(statement: string, evidenceMapping: EvidenceMatch[]): EvaluationArtifact {
  const evaluated = artifact([{
    key: "functionalScope", label: "Functional scope", importance: "Core", bucket: "Matched",
    jdEvidence: { status: "Explicit", value: statement, evidence: [{ quote: statement }] },
  }], evidenceMapping);
  evaluated.jobProjection = {
    capabilities: [],
    executiveMission: { successConditions: [] },
    roleWorkEvidence: [{
      id: "fixture:role-evidence",
      kind: "RESPONSIBILITY",
      statement,
      sourceQuote: statement,
      sourceRegion: "RESPONSIBILITIES",
      ordinal: 1,
      capabilityKeys: [],
      confidence: 0.95,
    }],
  };
  return evaluated;
}

describe("EditorialIntelligenceContractBuilder", () => {
  it("keeps verified candidate precedent and explicit employer outcome while rejecting classifier-only evidence", () => {
    const contract = buildEditorialIntelligenceContract(artifact([
      {
        key: "functionalScope",
        label: "Functional scope",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: { status: "Explicit", value: "Build creator partnerships and analyze campaign performance.", evidence: [{ quote: "Build creator partnerships and analyze campaign performance." }] },
      },
      {
        key: "commercialScope",
        label: "Commercial scope",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: { status: "Explicit", value: "ENTERPRISE", evidence: [{ quote: "ENTERPRISE" }] },
      },
    ]), candidate);

    expect(contract.verdict).toBe("PURSUE");
    expect(contract.qualityScore).toBe(72);
    expect(contract.candidatePrecedents).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: "Creator partnerships", evidenceIds: ["semantic-candidate-1"] }),
    ]));
    expect(contract.publishedRoleOutcomes).toEqual(expect.arrayContaining([expect.objectContaining({ statement: "Build creator partnerships and analyze campaign performance." })]));
    expect(contract.publishedRoleWork).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "RESPONSIBILITY",
        sourceEvidenceId: "fixture:success-conditions",
      }),
    ]));
    expect(JSON.stringify(contract)).not.toContain("Enterprise P&L Ownership");
    expect(JSON.stringify(contract)).not.toContain("ENTERPRISE");
  });

  it("does not admit a score summary as the editorial career case", () => {
    const evaluated = artifact([]);
    evaluated.opportunity!.primaryDriver = "Quality Score 67/100 with 100% Identity similarity and 93% Capability fit.";
    const contract = buildEditorialIntelligenceContract(evaluated, candidate);
    expect(contract.careerCase).not.toContain("Quality Score");
    expect(contract.careerCase).not.toMatch(/Identity similarity|Capability fit|score\b/i);
    expect(contract.careerCase).toMatch(/creator partnerships/i);
    expect(contract.careerCase).not.toMatch(/candidate precedent|bridge/i);
  });

  it("fails closed when semantic context is an unbounded profile corpus and never exposes ontology keys", () => {
    const projection: CandidateProjection = {
      ...candidate,
      inferredCapabilities: [],
      semanticEvidence: [{
        canonicalConcept: "PNL_RESPONSIBILITY",
        entityType: "FINANCIAL_SCOPE",
        semanticRelationship: "EXACT",
        evidenceRelationship: "DIRECT_EQUIVALENT",
        direction: "BIDIRECTIONAL_EQUIVALENT",
        confidence: 0.95,
        sourcePhrase: "PNL_RESPONSIBILITY",
        context: "Led revenue transformation across a portfolio. ".repeat(20),
        negated: false,
        temporalState: "HISTORICAL",
        evidenceStrength: "DIRECT_OWNERSHIP",
      }],
    };
    const contract = buildEditorialIntelligenceContract(artifact([]), projection);
    expect(contract.candidatePrecedents).toEqual([]);
    expect(JSON.stringify(contract)).not.toContain("PNL_RESPONSIBILITY");
  });

  it("never promotes the whole semantic profile corpus into candidate proof", () => {
    const projection: CandidateProjection = {
      ...candidate,
      inferredCapabilities: [],
      semanticEvidence: [{
        canonicalConcept: "PNL_RESPONSIBILITY",
        entityType: "FINANCIAL_SCOPE",
        semanticRelationship: "STRONG_EQUIVALENT",
        evidenceRelationship: "STRONG_SUPPORT",
        direction: "SOURCE_TO_TARGET",
        confidence: 0.91,
        sourcePhrase: "owned regional commercial performance",
        context: [
          "Executive profile summary containing many unrelated career facts and competencies.",
          "Led multi-market creator growth programs across regional accounts.",
          "Owned regional commercial performance across multiple markets and delivered sustained revenue growth.",
          "Additional profile corpus containing unrelated marketing, leadership, operations and transformation material.",
          "More unrelated candidate profile material that must never be emitted into a dossier proof point.",
        ].join("\n"),
        negated: false,
        temporalState: "CURRENT",
        evidenceStrength: "DIRECT_OWNERSHIP",
      }],
    };
    const contract = buildEditorialIntelligenceContract(artifactWithRoleEvidence("Own regional commercial performance across priority accounts.", [{
      jobCapability: "Commercial Leadership",
      candidateCapability: "owned regional commercial performance",
      confidence: 0.91,
      reason: "Strong Semantic Equivalent",
    }]), projection);
    expect(contract.candidatePrecedents).toHaveLength(1);
    expect(contract.candidatePrecedents[0]?.statement).toBe("Owned regional commercial performance across multiple markets and delivered sustained revenue growth.");
    expect(contract.candidatePrecedents[0]?.statement).not.toContain("Executive profile summary");
    expect(contract.candidatePrecedents[0]?.statement).not.toContain("Additional profile corpus");
    expect(contract.candidatePrecedents[0]?.capability).toBe("Commercial Leadership");
    expect(contract.candidatePrecedents.some((precedent) => precedent.capability === "PNL_RESPONSIBILITY")).toBe(false);
  });

  it("does not use semantic context when sourcePhrase cannot resolve to a bounded candidate fact", () => {
    const projection: CandidateProjection = {
      ...candidate,
      inferredCapabilities: [],
      semanticEvidence: [{
        canonicalConcept: "PNL_RESPONSIBILITY",
        entityType: "FINANCIAL_SCOPE",
        semanticRelationship: "STRONG_EQUIVALENT",
        evidenceRelationship: "STRONG_SUPPORT",
        direction: "SOURCE_TO_TARGET",
        confidence: 0.91,
        sourcePhrase: "PNL_RESPONSIBILITY",
        context: "This is a very long candidate profile corpus containing many unrelated sections and no literal bounded source evidence matching the classifier token.",
        negated: false,
        temporalState: "CURRENT",
        evidenceStrength: "DIRECT_OWNERSHIP",
      }],
    };
    expect(buildEditorialIntelligenceContract(artifact([]), projection).candidatePrecedents).toEqual([]);
  });

  it("keeps classifier labels out of the candidate-proof policy", () => {
    expect(substantiveCandidateEvidence("marketing")).toBeNull();
    expect(substantiveCandidateEvidence("Marketing Strategy")).toBeNull();
    expect(substantiveCandidateEvidence("Enterprise P&L Ownership & ENTERPRISE | Board Decision Authority")).toBeNull();
  });

  it("does not let a missing authority dimension erase published responsibilities", () => {
    const contract = buildEditorialIntelligenceContract(artifact([
      {
        key: "functionalScope",
        label: "Functional scope",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: { status: "Explicit", value: "Develop influencer campaigns across client accounts.", evidence: [{ quote: "Develop influencer campaigns across client accounts." }] },
      },
      { key: "decisionAuthority", label: "Decision authority", importance: "Core", bucket: "Missing", jdEvidence: { status: "Missing", value: "", evidence: [] } },
    ]), candidate);
    expect(contract.publishedRoleOutcomes.map((outcome) => outcome.statement)).toContain("Develop influencer campaigns across client accounts.");
    expect(contract.decisionHinges.some((hinge) => hinge.topic === "Decision rights")).toBe(false);
  });

  it("routes bounded candidate precedents through the role-specific engine mapping", () => {
    const projection = makeCandidateProjection({
      inferredCapabilities: [
        {
          name: "Influencer Marketing Strategy",
          confidence: 0.91,
          evidenceIds: ["creator-1"],
          supportingEvidence: [{
            id: "creator-1",
            relation: "SUPPORTS_INFERENCE",
            quote: "Led multi-market creator and influencer growth programmes across regional consumer accounts.",
          }],
        },
        {
          name: "Operations Leadership",
          confidence: 0.88,
          evidenceIds: ["ops-1"],
          supportingEvidence: [{
            id: "ops-1",
            relation: "SUPPORTS_INFERENCE",
            quote: "Directed multi-market service operations and partner delivery across complex regional programmes.",
          }],
        },
        {
          name: "CRM Transformation",
          confidence: 0.94,
          evidenceIds: ["crm-1"],
          supportingEvidence: [{
            id: "crm-1",
            relation: "SUPPORTS_INFERENCE",
            quote: "Led a multi-market CRM transformation and platform migration across regional businesses.",
          }],
        },
      ],
      semanticEvidence: [],
    });
    const socialContract = buildEditorialIntelligenceContract(artifactWithRoleEvidence("Lead creator and influencer partnership programmes across regional consumer accounts.", [{
      jobCapability: "Influencer Marketing Strategy",
      candidateCapability: "Influencer Marketing Strategy",
      confidence: 1,
      reason: "Direct Explicit Evidence Match",
    }]), projection);
    const operationsContract = buildEditorialIntelligenceContract(artifactWithRoleEvidence("Direct multi-market service operations and partner delivery across complex regional programmes.", [{
      jobCapability: "Operations Leadership",
      candidateCapability: "Operations Leadership",
      confidence: 1,
      reason: "Direct Explicit Evidence Match",
    }]), projection);

    expect(socialContract.candidatePrecedents.map((precedent) => precedent.statement)).toEqual([
      "Led multi-market creator and influencer growth programmes across regional consumer accounts.",
    ]);
    expect(operationsContract.candidatePrecedents.map((precedent) => precedent.statement)).toEqual([
      "Directed multi-market service operations and partner delivery across complex regional programmes.",
    ]);
    expect(operationsContract.candidatePrecedents.some((precedent) => /creator|influencer/i.test(precedent.statement))).toBe(false);
    expect(socialContract.candidatePrecedents.some((precedent) => /service operations/i.test(precedent.statement))).toBe(false);

    const semanticProjection = makeCandidateProjection({
      inferredCapabilities: [],
      semanticEvidence: [{
        canonicalConcept: "INFLUENCER_MARKETING",
        entityType: "CAPABILITY",
        semanticRelationship: "STRONG_EQUIVALENT",
        evidenceRelationship: "STRONG_SUPPORT",
        direction: "SOURCE_TO_TARGET",
        confidence: 0.9,
        sourcePhrase: "creator-led growth",
        context: "Led multi-market creator-led growth programmes across regional accounts.",
        negated: false,
        temporalState: "CURRENT",
        evidenceStrength: "DIRECT_OWNERSHIP",
      }],
    });
    const semanticContract = buildEditorialIntelligenceContract(artifact([], [{
      jobCapability: "Influencer Marketing",
      candidateCapability: "creator-led growth",
      confidence: 0.9,
      reason: "Strong Semantic Equivalent",
    }]), semanticProjection);
    expect(semanticContract.candidatePrecedents.map((precedent) => precedent.statement)).toContain(
      "Led multi-market creator-led growth programmes across regional accounts.",
    );

    const syntheticContract = buildEditorialIntelligenceContract(artifact([], [{
      jobCapability: "Commercial Leadership",
      candidateCapability: "Enterprise P&L Ownership & ENTERPRISE | Board Decision Authority",
      confidence: 0.7,
      reason: "Enterprise Scope Grounding (ENTERPRISE Decision Authority proves Commercial Leadership)",
    }]), projection);
    expect(syntheticContract.candidatePrecedents).toEqual([]);
    expect(buildEditorialIntelligenceContract(artifact([], []), projection).candidatePrecedents).toEqual([]);
  });

  it("requires specific published-role evidence before a broad marketing mapping may route proof", () => {
    const projection = makeCandidateProjection({
      inferredCapabilities: [
        {
          name: "Performance Marketing", confidence: 0.92, evidenceIds: ["perf-1"],
          supportingEvidence: [{ id: "perf-1", relation: "SUPPORTS_INFERENCE", quote: "Built and scaled a regional performance-marketing centre of excellence across multiple consumer accounts." }],
        },
        {
          name: "CRM Transformation", confidence: 0.94, evidenceIds: ["crm-1"],
          supportingEvidence: [{ id: "crm-1", relation: "SUPPORTS_INFERENCE", quote: "Led a Salesforce CRM and customer-data-platform migration across multiple regional businesses." }],
        },
        {
          name: "Creator Partnerships", confidence: 0.9, evidenceIds: ["creator-1"],
          supportingEvidence: [{ id: "creator-1", relation: "SUPPORTS_INFERENCE", quote: "Led creator and influencer partnership programmes across regional consumer brands." }],
        },
      ],
      semanticEvidence: [],
    });
    const broadMapping: EvidenceMatch[] = [{
      jobCapability: "MARKETING_STRATEGY", candidateCapability: "marketing", confidence: 0.88, reason: "Strong Semantic Equivalent",
    }];
    const withOutcome = (statement: string) => artifactWithRoleEvidence(statement, broadMapping);

    const influencer = buildEditorialIntelligenceContract(
      withOutcome("Lead influencer and creator partnerships across client campaigns. Build scalable influencer campaign strategies across brand portfolios."),
      projection,
    );
    expect(influencer.candidatePrecedents).toEqual([]);

    const performance = buildEditorialIntelligenceContract(
      withOutcome("Own performance marketing optimisation, acquisition efficiency and paid media outcomes."),
      projection,
    );
    expect(performance.candidatePrecedents.map((precedent) => precedent.statement)).toEqual([
      "Built and scaled a regional performance-marketing centre of excellence across multiple consumer accounts.",
    ]);

    const crm = buildEditorialIntelligenceContract(
      withOutcome("Lead CRM, lifecycle automation and customer data platform transformation."),
      projection,
    );
    expect(crm.candidatePrecedents).toEqual([]);

    const retail = buildEditorialIntelligenceContract(
      withOutcome("Lead retail merchandising, category planning and inventory operations."),
      projection,
    );
    expect(retail.candidatePrecedents).toEqual([]);
  });

  it("does not let one strong mapped capability family authorize another precedent family", () => {
    const projection = makeCandidateProjection({
      inferredCapabilities: [
        {
          name: "CRM Transformation", confidence: 0.92, evidenceIds: ["crm-1"],
          supportingEvidence: [{ id: "crm-1", relation: "SUPPORTS_INFERENCE", quote: "Led a Salesforce CRM and customer-data-platform transformation across regional businesses." }],
        },
        {
          name: "Operations Leadership", confidence: 0.91, evidenceIds: ["ops-1"],
          supportingEvidence: [{ id: "ops-1", relation: "SUPPORTS_INFERENCE", quote: "Directed vendor operations and service delivery across complex regional programmes." }],
        },
      ],
      semanticEvidence: [],
    });
    const contract = buildEditorialIntelligenceContract(
      artifactWithRoleEvidence(
        "Lead CRM transformation and lifecycle platform development. Manage vendor operations and service-delivery escalations.",
        [{
          jobCapability: "CRM Transformation",
          candidateCapability: "CRM Transformation",
          confidence: 0.92,
          reason: "Direct Explicit Evidence Match",
        }],
      ),
      projection,
    );
    expect(contract.candidatePrecedents.map((precedent) => precedent.statement)).toContain(
      "Led a Salesforce CRM and customer-data-platform transformation across regional businesses.",
    );
    expect(contract.candidatePrecedents.some((precedent) => /vendor operations|service delivery/i.test(precedent.statement))).toBe(false);
  });

  it("uses capability route keys rather than incidental achievement words for relevance", () => {
    const broadMapping: EvidenceMatch[] = [{
      jobCapability: "MARKETING_STRATEGY",
      candidateCapability: "marketing",
      confidence: 0.88,
      reason: "Strong Semantic Equivalent",
    }];
    const performanceProjection = makeCandidateProjection({
      inferredCapabilities: [{
        name: "Performance Marketing",
        confidence: 0.92,
        evidenceIds: ["perf-1"],
        supportingEvidence: [{
          id: "perf-1",
          relation: "SUPPORTS_INFERENCE",
          quote: "Recruited and scaled a 40-member cross-functional Performance Marketing Center of Excellence across regional accounts.",
        }],
      }],
      semanticEvidence: [],
    });
    const genericFunctional = buildEditorialIntelligenceContract(
      artifactWithRoleEvidence("Lead a cross-functional team and coordinate agency relationships across the business.", broadMapping),
      performanceProjection,
    );
    expect(genericFunctional.candidatePrecedents).toEqual([]);

    const performanceRole = buildEditorialIntelligenceContract(
      artifactWithRoleEvidence("Monitor and optimize performance marketing outcomes across paid acquisition programs.", broadMapping),
      performanceProjection,
    );
    expect(performanceRole.candidatePrecedents.map((precedent) => precedent.statement)).toContain(
      "Recruited and scaled a 40-member cross-functional Performance Marketing Center of Excellence across regional accounts.",
    );

    const crmProjection = makeCandidateProjection({
      inferredCapabilities: [{
        name: "CRM Transformation",
        confidence: 0.92,
        evidenceIds: ["crm-1"],
        supportingEvidence: [{
          id: "crm-1",
          relation: "SUPPORTS_INFERENCE",
          quote: "Led a Salesforce CRM transformation across multiple regional businesses and cross-functional teams.",
        }],
      }],
      semanticEvidence: [],
    });
    const merchandising = buildEditorialIntelligenceContract(
      artifactWithRoleEvidence("Lead cross-functional merchandising and inventory planning.", broadMapping),
      crmProjection,
    );
    expect(merchandising.candidatePrecedents).toEqual([]);
  });

  it("treats a published merchandising qualification as a hinge, not role work", () => {
    const evaluated = artifact([], []);
    evaluated.opportunity!.role = "Business Head";
    evaluated.opportunity!.company = "FutureLeap Search";
    evaluated.jobProjection = {
      capabilities: [{
        name: "Merchandising / Category Inventory Operations",
        source: "explicit",
        confidence: 0.9,
        tier: "EXECUTION_CAPABILITY",
      }],
      capabilityRequirements: [{
        capability: "Merchandising / Category Inventory Operations",
        tier: "EXECUTION_CAPABILITY",
        required: true,
        materiality: "CORE",
        evidenceIds: ["future-req-1"],
        sourceQuotes: ["Strong understanding of product, sourcing, merchandising, inventory, and commercial management."],
      }],
      executiveMission: { successConditions: [] },
    };

    const contract = buildEditorialIntelligenceContract(evaluated, makeCandidateProjection({
      inferredCapabilities: [],
      semanticEvidence: [],
    }));

    expect(contract.publishedRoleOutcomes).toEqual([]);
    expect(contract.candidatePrecedents).toEqual([]);
    expect(contract.decisionHinges.some((hinge) => hinge.topic === "Qualification vs mandate")).toBe(true);
    expect(contract.positioningAngles[0]).toMatch(/qualification hurdle/i);
    expect(contract.positioningAngles[0]).toMatch(/Merchandising|Category|Inventory/i);
    expect(contract.positioningAngles[0]).toMatch(/not as proof of the operating mandate/i);
  });

  it("does not treat an explicit projected capability name alone as role work", () => {
    const evaluated = artifact([], []);
    evaluated.jobProjection = {
      capabilities: [{
        name: "Merchandising / Category Inventory Operations",
        source: "explicit",
        confidence: 0.9,
        tier: "EXECUTION_CAPABILITY",
      }],
      capabilityRequirements: [],
      executiveMission: { successConditions: [] },
    };

    expect(buildEditorialIntelligenceContract(evaluated, makeCandidateProjection({
      inferredCapabilities: [], semanticEvidence: [],
    })).publishedRoleOutcomes).toEqual([]);
  });

  it("uses grounded role work rather than generic legacy positioning as primary advice", () => {
    const evaluated = artifactWithRoleEvidence(
      "Monitor and analyze influencer performance and achieve storefront metrics.",
      [{ jobCapability: "Performance Marketing", candidateCapability: "Performance Marketing", confidence: 0.9, reason: "Direct Explicit Evidence Match" }],
    );
    evaluated.opportunity!.positioning = ["Lead with experience managing large-scale commercial portfolios and broad stakeholder relationships."];
    const projection = makeCandidateProjection({
      inferredCapabilities: [{
        name: "Performance Marketing", confidence: 0.92, evidenceIds: ["performance-1"],
        supportingEvidence: [{ id: "performance-1", relation: "SUPPORTS_INFERENCE", quote: "Built and scaled performance marketing operations across consumer accounts." }],
      }],
      semanticEvidence: [],
    });
    const contract = buildEditorialIntelligenceContract(evaluated, projection);
    expect(contract.positioningAngles[0]).toMatch(/Performance Marketing|influencer performance|storefront metrics/i);
    expect(contract.positioningAngles[0]).not.toMatch(/large-scale commercial portfolios/i);
  });

  it("anchors positioning in published work when no candidate proof is grounded", () => {
    const contract = buildEditorialIntelligenceContract(
      artifactWithRoleEvidence(
        "Manage vendor performance, corrective actions, QBRs and service-delivery escalations.",
        [],
      ),
      makeCandidateProjection({ inferredCapabilities: [], semanticEvidence: [] }),
    );
    expect(contract.positioningAngles[0]).toMatch(/vendor|QBR|service-delivery/i);
    expect(contract.positioningAngles[0]).toMatch(/scope|authority|report/i);
    expect(contract.positioningAngles[0]).not.toMatch(/candidate precedent|candidate bridge|large-scale commercial portfolios/i);
  });

  it("uses a decision hinge rather than generic legacy positioning when evidence is absent", () => {
    const evaluated = artifact([], []);
    evaluated.opportunity!.positioning = ["Lead with experience managing large-scale commercial portfolios and broad stakeholder relationships."];
    evaluated.jobProjection = { capabilities: [], capabilityRequirements: [], executiveMission: { successConditions: [] } };
    const contract = buildEditorialIntelligenceContract(evaluated, makeCandidateProjection({
      inferredCapabilities: [], semanticEvidence: [],
    }));
    expect(contract.positioningAngles[0]).toContain("What evidence would resolve this risk");
    expect(contract.positioningAngles[0]).not.toMatch(/large-scale commercial portfolios/i);
  });

  it("keeps role work, context, qualifications, and candidate facts in distinct provenance classes", () => {
    const evaluated = artifact([], defaultMappings);
    evaluated.jobProjection = {
      capabilities: [{ name: "Creator partnerships", source: "explicit", tier: "CORE_MANDATE", confidence: 0.9 }],
      roleWorkEvidence: [
        {
          id: "role:responsibility", kind: "RESPONSIBILITY",
          statement: "Lead creator partnerships across priority accounts.",
          sourceQuote: "Lead creator partnerships across priority accounts.",
          sourceRegion: "RESPONSIBILITIES", ordinal: 1, capabilityKeys: ["Creator partnerships"], confidence: 0.95,
        },
        {
          id: "role:outcome", kind: "OUTCOME",
          statement: "Achieve creator campaign conversion targets.",
          sourceQuote: "Achieve creator campaign conversion targets.",
          sourceRegion: "RESPONSIBILITIES", ordinal: 1, capabilityKeys: ["Creator partnerships"], confidence: 0.95,
        },
        {
          id: "role:context", kind: "ROLE_CONTEXT",
          statement: "Reports to the Chief Commercial Officer.",
          sourceQuote: "Reports to the Chief Commercial Officer.",
          sourceRegion: "SUMMARY", ordinal: 1, capabilityKeys: [], confidence: 0.9,
        },
      ],
      capabilityRequirements: [{
        capability: "Performance Marketing", tier: "EXECUTION_CAPABILITY", required: true, materiality: "CORE",
        evidenceIds: ["qualification:performance"], sourceQuotes: ["Strong experience in performance marketing and paid media."],
      }],
      executiveMission: { successConditions: [] },
      operatingLevel: { value: "EXECUTIVE", confidence: 0.9, evidence: [] },
      workNature: { value: "STRATEGIC_WORK", confidence: 0.9, evidence: [] },
      decisionAuthority: { value: "ENTERPRISE", confidence: 0.9, evidence: [] },
      commercialScope: { value: "ENTERPRISE", confidence: 0.9, evidence: [] },
      dimensions: [],
    } as any;

    const contract = buildEditorialIntelligenceContract(evaluated, candidate);

    expect(contract.version).toBe("editorial-intelligence-v2");
    expect(contract.publishedRoleWork).toEqual([
      expect.objectContaining({ kind: "RESPONSIBILITY", sourceEvidenceId: "role:responsibility" }),
      expect.objectContaining({ kind: "OUTCOME", sourceEvidenceId: "role:outcome" }),
    ]);
    expect(contract.publishedRoleWork.map((item) => item.statement)).not.toContain("Reports to the Chief Commercial Officer.");
    expect(contract.roleContext).toEqual([expect.objectContaining({ sourceEvidenceId: "role:context" })]);
    expect(contract.qualificationRequirements).toEqual([
      expect.objectContaining({ statement: "Strong experience in performance marketing and paid media.", sourceEvidenceIds: ["qualification:performance"] }),
    ]);
    expect(contract.publishedRoleWork.some((item) => /Strong experience/i.test(item.statement))).toBe(false);
    expect(contract.candidatePrecedents.every((item) => item.provenance === "CANDIDATE_FACT")).toBe(true);
    expect(contract.publishedRoleWork.every((item) => !/Led creator partnership programs across consumer brands/i.test(item.statement))).toBe(true);
    expect(contract.canonicalSignals.some((signal) => signal.kind === "OPERATING_LEVEL")).toBe(true);
    expect(contract.candidateFitEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ relationship: "MATCH", candidateEvidenceIds: ["semantic-candidate-1"] }),
    ]));
  });

  it("retains exact-source presentation qualifications without promoting them into role work", () => {
    const evaluated = artifact([], []);
    evaluated.jobProjection = {
      capabilities: [],
      capabilityRequirements: [],
      executiveMission: { successConditions: [] },
      roleWorkEvidence: [],
    } as any;

    const contract = buildEditorialIntelligenceContract(
      evaluated,
      makeCandidateProjection({ inferredCapabilities: [], semanticEvidence: [] }),
      {
        presentationQualificationEvidence: [{
          id: "qualification:source:1",
          statement: "10+ years of experience in merchandising, category management and inventory planning.",
          sourceQuote: "10+ years of experience in merchandising, category management and inventory planning.",
          sourceRegion: "REQUIREMENTS",
          ordinal: 1,
          capabilityKeys: ["Merchandising and Category Management"],
          confidence: 0.95,
        }],
      },
    );

    expect(contract.qualificationRequirements).toEqual([expect.objectContaining({
      statement: "10+ years of experience in merchandising, category management and inventory planning.",
      sourceEvidenceIds: ["qualification:source:1"],
    })]);
    expect(contract.publishedRoleWork).toEqual([]);
    expect(contract.synthesisInputs.some((input) => input.type === "EMPLOYER_FACT")).toBe(false);
  });

  it("retains canonical and candidate intelligence when bounded employer work is unavailable", () => {
    const evaluated = artifact([], []);
    evaluated.jobProjection = {
      capabilities: [{ name: "CRM Transformation", source: "explicit", tier: "CORE_MANDATE", confidence: 0.9 }],
      capabilityRequirements: [{
        capability: "CRM Transformation", tier: "CORE_MANDATE", required: true, materiality: "CORE",
        evidenceIds: ["qualification:crm"], sourceQuotes: ["Strong experience in CRM transformation and lifecycle automation."],
      }],
      executiveMission: { successConditions: [] },
      operatingLevel: { value: "EXECUTIVE", confidence: 0.9, evidence: [] },
      workNature: { value: "STRATEGIC_WORK", confidence: 0.9, evidence: [] },
      decisionAuthority: { value: "ENTERPRISE", confidence: 0.9, evidence: [] },
      commercialScope: { value: "ENTERPRISE", confidence: 0.9, evidence: [] },
      dimensions: [],
    } as any;

    const contract = buildEditorialIntelligenceContract(evaluated, candidate);

    expect(contract.publishedRoleWork).toEqual([]);
    expect(contract.qualificationRequirements).toHaveLength(1);
    expect(contract.candidateCapabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: "Marketing Strategy" }),
    ]));
    expect(contract.canonicalSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "OPERATING_LEVEL", value: "EXECUTIVE" }),
      expect.objectContaining({ kind: "CAPABILITY", value: "CRM Transformation" }),
    ]));
    expect(contract.synthesisInputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "EVIDENCE_LIMITATION" }),
      expect.objectContaining({ type: "RADAR_INFERENCE" }),
    ]));
  });

  it("retains only bounded, admissible semantic candidate signals without turning them into employer facts", () => {
    const evaluated = artifact([], []);
    evaluated.jobProjection = {
      capabilities: [],
      capabilityRequirements: [],
      executiveMission: { successConditions: [] },
      roleWorkEvidence: [],
    } as any;
    const projection = makeCandidateProjection({
      inferredCapabilities: [],
      semanticEvidence: [
        {
          canonicalConcept: "REVENUE_ACCOUNTABILITY",
          entityType: "FINANCIAL_SCOPE",
          confidence: 0.91,
          sourcePhrase: "revenue accountability",
          context: "Candidate has revenue accountability.",
          negated: false,
          temporalState: "CURRENT",
          evidenceStrength: "DIRECT_OWNERSHIP",
          evidenceRelationship: "DIRECT_EQUIVALENT",
          direction: "BIDIRECTIONAL_EQUIVALENT",
          semanticRelationship: "EXACT",
        },
        {
          canonicalConcept: "PNL_RESPONSIBILITY",
          entityType: "FINANCIAL_SCOPE",
          confidence: 0.99,
          sourcePhrase: "A profile-wide corpus that exceeds the bounded candidate-evidence policy because it is not an independently displayable fact. ".repeat(6),
          context: "A profile-wide corpus that exceeds the bounded candidate-evidence policy because it is not an independently displayable fact. ".repeat(6),
          negated: false,
          temporalState: "CURRENT",
          evidenceStrength: "DIRECT_OWNERSHIP",
          evidenceRelationship: "DIRECT_EQUIVALENT",
          direction: "BIDIRECTIONAL_EQUIVALENT",
          semanticRelationship: "EXACT",
        },
      ],
    });

    const contract = buildEditorialIntelligenceContract(evaluated, projection);

    expect(contract.candidateCapabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: "revenue accountability" }),
    ]));
    expect(contract.candidateCapabilities.some((item) => /profile-wide corpus/i.test(item.capability))).toBe(false);
    expect(contract.publishedRoleWork).toEqual([]);
    expect(contract.synthesisInputs.some((item) => item.type === "EMPLOYER_FACT")).toBe(false);
    expect(contract.synthesisInputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "EVIDENCE_LIMITATION" }),
    ]));
  });

  it("does not mutate canonical artifact identity or scoring fields while assembling presentation intelligence", () => {
    const evaluated = artifactWithRoleEvidence(
      "Own lifecycle strategy and retention outcomes.",
      [],
    );
    (evaluated as any).decision = "CONSIDER";
    (evaluated as any).score = 63;
    (evaluated as any).evaluationInputHash = "input-unchanged";
    (evaluated as any).evaluationFingerprint = "fingerprint-unchanged";
    const before = JSON.stringify(evaluated);

    const contract = buildEditorialIntelligenceContract(evaluated, candidate);

    expect(contract.verdict).toBe("CONSIDER");
    expect(contract.qualityScore).toBe(63);
    expect(JSON.stringify(evaluated)).toBe(before);
  });

  it("keeps scalar-only history distinct from an evaluator-produced persisted decision trace", () => {
    const evaluated = artifact([], []);
    const scalarOnly = buildEditorialIntelligenceContract(evaluated, candidate);
    expect(scalarOnly.decisionDrivers).toEqual(expect.objectContaining({
      availability: "SCALAR_ONLY",
      strengths: [],
      constraints: [],
    }));

    const traceBacked = {
      ...evaluated,
      record: undefined,
      decisionTrace: {
        version: "canonical-decision-trace/v1",
        relationships: [],
        components: [
          { dimension: "Creator partnerships", state: "STRENGTH", evidenceIds: [] },
          { dimension: "Inventory planning", state: "CONSTRAINT", evidenceIds: [] },
        ],
      },
    } as any;
    const detailed = buildEditorialIntelligenceContract(traceBacked, candidate);
    expect(detailed.decisionDrivers).toEqual(expect.objectContaining({
      availability: "PERSISTED_DRIVER_DETAIL",
      strengths: [expect.objectContaining({ value: "Creator partnerships" })],
      constraints: [expect.objectContaining({ value: "Inventory planning" })],
    }));
  });

  it("resolves an evaluator trace back to the exact pinned semantic candidate fact", () => {
    const evaluated = artifact([], []);
    const projection = makeCandidateProjection({
      profileVersion: "candidate-profile-v1",
      inferredCapabilities: [],
      semanticEvidence: [{
        canonicalConcept: "Creator partnerships",
        entityType: "CAPABILITY",
        semanticRelationship: "EXACT",
        evidenceRelationship: "DIRECT_EQUIVALENT",
        direction: "BIDIRECTIONAL_EQUIVALENT",
        confidence: 0.9,
        sourcePhrase: "Creator partnerships",
        context: "Led creator partnerships across consumer accounts.",
        negated: false,
        temporalState: "HISTORICAL",
        evidenceStrength: "DIRECT_OWNERSHIP",
      }],
    });
    const traceBacked = {
      ...evaluated,
      record: undefined,
      decisionTrace: {
        version: "canonical-decision-trace/v1",
        relationships: [{
          candidateEvidenceIds: ["candidate-projection:candidate-profile-v1:semantic:0"],
          jobEvidenceIds: ["job:creator"],
          candidateCapabilityKey: "Creator partnerships",
          jobCapabilityKey: "Creator partnerships",
          relationship: "MATCH",
          basis: "EVALUATOR",
        }],
        components: [{ dimension: "Creator partnerships", state: "STRENGTH", evidenceIds: [] }],
      },
    } as any;

    const contract = buildEditorialIntelligenceContract(traceBacked, projection);

    expect(contract.candidateCapabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ evidenceIds: ["candidate-projection:candidate-profile-v1:semantic:0"] }),
    ]));
    expect(contract.candidateFitEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ candidateEvidenceIds: ["candidate-projection:candidate-profile-v1:semantic:0"] }),
    ]));
  });

  it("does not grant downstream editorial code access to raw opportunity source", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/intelligence/editorial/EditorialIntelligenceContractBuilder.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\b(?:rawDescription|rawText|normalizedText|description)\b/);
  });
});
