import { describe, expect, it, vi } from "vitest";
import { CandidateProofExtractorV1 } from "../../../src/lib/intelligence/extraction/CandidateProofExtractorV1";
import {
  ExperimentalLlmCandidateProofProvider,
  ExperimentalLlmRoleIntelligenceProvider,
  LLM_EXPERIMENT_PROMPT_VERSION,
  LLM_EXPERIMENT_RESPONSE_SCHEMA_VERSION,
  createLlmExperimentConfigurationFingerprint,
  toStrictStructuredOutputTransportRequest,
  type LlmStructuredExtractionClient,
} from "../../../src/lib/intelligence/extraction/LlmExperimentalExtractionProvider";
import {
  LLM_SEMANTIC_ASSEMBLER_VERSION,
  LLM_SEMANTIC_PROPOSAL_SCHEMA_VERSION,
} from "../../../src/lib/intelligence/extraction/ExperimentalSemanticProposal";
import { ExperimentalLlmExtractionExecutor } from "../../../src/lib/intelligence/extraction/ExperimentalLlmExtractionExecutor";
import { VerifiedExtractionProviderRunner } from "../../../src/lib/intelligence/extraction/VerifiedExtractionProviderRunner";
import type { CandidateDocumentSourceRef, OpportunityVersionSourceRef } from "../../../src/lib/domain/source_provenance";
import type { ResolvedSourceSnapshot } from "../../../src/lib/provenance/SourceSnapshotResolver";

const roleText = "# Key Responsibilities\nOwn pricing governance across channel expansion.";
const candidateText = [
  "# Candidate",
  "## PROFESSIONAL EXPERIENCE",
  "### Commercial Director | Acme | 2020–Present",
  "- Led pricing governance across regional markets.",
].join("\n");
const roleSource: OpportunityVersionSourceRef = {
  kind: "OPPORTUNITY_VERSION", canonicalJobId: "job-llm-experiment", opportunityVersion: "opp-version-llm-experiment",
  contentHash: "content-hash-llm-experiment", sourcePayloadKey: null, sourcePayloadSha256: null,
};
const candidateSource: CandidateDocumentSourceRef = {
  kind: "CANDIDATE_DOCUMENT_TEXT", personId: "person-llm-experiment", documentId: "candidate-document-llm-experiment",
  documentHash: "candidate-document-hash", textHash: "candidate-text-hash",
};
const configuration = {
  providerId: "experimental-test-llm", model: "test-structured-model", promptVersion: LLM_EXPERIMENT_PROMPT_VERSION,
  responseSchemaVersion: LLM_EXPERIMENT_RESPONSE_SCHEMA_VERSION, proposalSchemaVersion: LLM_SEMANTIC_PROPOSAL_SCHEMA_VERSION,
  assemblerVersion: LLM_SEMANTIC_ASSEMBLER_VERSION, generationParameters: { temperature: 0, seed: 73 },
} as const;

function sourceSnapshot(ref: CandidateDocumentSourceRef | OpportunityVersionSourceRef, text: string): ResolvedSourceSnapshot {
  return { ref, storage: "DATABASE_TEXT", mediaType: "text/plain; charset=utf-8", bytes: Buffer.from(text), text };
}

function runnerFor(ref: CandidateDocumentSourceRef | OpportunityVersionSourceRef, text: string): VerifiedExtractionProviderRunner {
  return new VerifiedExtractionProviderRunner({ resolve: async (requested) => {
    expect(requested).toEqual(ref);
    return sourceSnapshot(ref, text);
  } } as never);
}

function clientFor(output: unknown, inspect?: (request: Parameters<LlmStructuredExtractionClient["generate"]>[0]) => void): LlmStructuredExtractionClient {
  return { generate: async (request) => {
    inspect?.(request);
    return {
      outputText: JSON.stringify({ schemaVersion: LLM_EXPERIMENT_RESPONSE_SCHEMA_VERSION, output }),
      responseId: "response-test-73", model: "test-structured-model-actual", usage: { totalTokens: 42 }, estimatedCostUsd: 0.0012,
    };
  } };
}

const roleProposal = { proposals: [{ exactQuote: "Own pricing governance across channel expansion.", semanticType: "DECISION_AUTHORITY", subject: "ROLE", confidence: 0.9 }] };
const candidateProposal = { proposals: [{ exactQuote: "Led pricing governance across regional markets.", evidenceClass: "WORK_HISTORY", proofTypes: ["OWNERSHIP"] }] };

describe("experimental semantic proposal providers", () => {
  it("runs role semantic proposals through source-bound assembly and the shared verifier", async () => {
    const outcome = await new ExperimentalLlmExtractionExecutor(runnerFor(roleSource, roleText)).runRole(
      new ExperimentalLlmRoleIntelligenceProvider(clientFor(roleProposal), configuration),
      { source: roleSource, caseId: "llm-role-case" },
    );
    expect(outcome.state).toBe("VERIFIED");
    if (outcome.state === "VERIFIED") {
      expect(outcome.result.output.atoms).toMatchObject([{ id: "role_atom:llm-role-case:23_71:DECISION_AUTHORITY", startOffset: 23, endOffset: 71 }]);
      expect(outcome.result.output.metadata.proposalCounts).toEqual({ proposedAtoms: 1, acceptedAtoms: 1, rejectedAtoms: 0 });
      expect(outcome.telemetry).toMatchObject({ responseId: "response-test-73", actualModel: "test-structured-model-actual" });
    }
  });

  it("assembles candidate parents, IDs, aggregate claims, and accounting locally", async () => {
    const outcome = await new ExperimentalLlmExtractionExecutor(runnerFor(candidateSource, candidateText)).runCandidate(
      new ExperimentalLlmCandidateProofProvider(clientFor(candidateProposal), configuration), { source: candidateSource },
    );
    expect(outcome.state).toBe("VERIFIED");
    if (outcome.state === "VERIFIED") {
      const [claim] = outcome.result.output.allClaims;
      expect(outcome.result.output.allClaims).toHaveLength(1);
      expect(outcome.result.output.allBullets[0]?.claims).toEqual([claim]);
      expect(claim?.claimId).toContain(`claim:${candidateSource.documentId}:`);
      expect(outcome.result.output.metadata.proposalCounts).toEqual({ proposedClaims: 1, acceptedClaims: 1, rejectedClaims: 0 });
    }
  });

  it("does not ask the model to author source or request identity, IDs, offsets, or aggregate collections", async () => {
    const provider = new ExperimentalLlmRoleIntelligenceProvider(clientFor(roleProposal, (request) => {
      expect(request.prompt).not.toContain(roleSource.canonicalJobId);
      expect(request.prompt).not.toContain("llm-role-case");
      const schema = JSON.stringify(request.responseSchema);
      for (const forbidden of ["sourceIdentity", "sourceRef", "canonicalJobId", "caseId", "startOffset", "allClaims", "proposalCounts"]) {
        expect(schema).not.toContain(forbidden);
      }
      expect(schema).not.toContain('"id"');
    }), configuration);
    const outcome = await new ExperimentalLlmExtractionExecutor(runnerFor(roleSource, roleText)).runRole(provider, { source: roleSource, caseId: "llm-role-case" });
    expect(outcome.state).toBe("VERIFIED");
  });

  it.each([
    ["malformed semantic enum", { proposals: [{ ...roleProposal.proposals[0], semanticType: "NOT_A_TYPE" }] }],
    ["model-authored identity", { proposals: [{ ...roleProposal.proposals[0], caseId: "forged" }] }],
  ])("rejects a malformed response envelope for %s", async (_label, output) => {
    const outcome = await new ExperimentalLlmExtractionExecutor(runnerFor(roleSource, roleText)).runRole(
      new ExperimentalLlmRoleIntelligenceProvider(clientFor(output), configuration), { source: roleSource, caseId: "llm-role-case" },
    );
    expect(outcome.state).toBe("REJECTED");
  });

  it.each([
    ["fabricated quote", { proposals: [{ ...roleProposal.proposals[0], exactQuote: "Invented mandate." }] }, roleText, 1],
    ["ambiguous repeated quote", { proposals: [{ ...roleProposal.proposals[0], exactQuote: "Own pricing." }] }, "Own pricing. Own pricing.", 1],
    ["duplicate semantic anchor", { proposals: [roleProposal.proposals[0], roleProposal.proposals[0]] }, roleText, 2],
  ])("counts %s as a proposition-level source rejection while retaining a valid V1 result", async (_label, output, text, rejectedAtoms) => {
    const outcome = await new ExperimentalLlmExtractionExecutor(runnerFor(roleSource, text)).runRole(
      new ExperimentalLlmRoleIntelligenceProvider(clientFor(output), configuration), { source: roleSource, caseId: "llm-role-case" },
    );
    expect(outcome.state).toBe("VERIFIED");
    if (outcome.state === "VERIFIED") {
      expect(outcome.result.output.metadata.proposalCounts).toEqual({ proposedAtoms: output.proposals.length, acceptedAtoms: 0, rejectedAtoms });
    }
  });

  it("retains same-span role propositions when their semantic types differ", async () => {
    const multiLabel = { proposals: [
      { ...roleProposal.proposals[0], semanticType: "PNL_OWNERSHIP" },
      { ...roleProposal.proposals[0], semanticType: "REVENUE_ACCOUNTABILITY" },
    ] };
    const outcome = await new ExperimentalLlmExtractionExecutor(runnerFor(roleSource, roleText)).runRole(
      new ExperimentalLlmRoleIntelligenceProvider(clientFor(multiLabel), configuration), { source: roleSource, caseId: "llm-role-case" },
    );
    expect(outcome.state).toBe("VERIFIED");
    if (outcome.state === "VERIFIED") {
      expect(outcome.result.output.atoms).toHaveLength(2);
      expect(outcome.result.output.metadata.proposalCounts).toEqual({ proposedAtoms: 2, acceptedAtoms: 2, rejectedAtoms: 0 });
    }
  });

  it("preserves typed source-rejection causality in the experimental sidecar", async () => {
    const provider = new ExperimentalLlmRoleIntelligenceProvider(clientFor({ proposals: [
      { ...roleProposal.proposals[0], exactQuote: "Absent." },
      { ...roleProposal.proposals[0], exactQuote: "Also absent." },
    ] }), configuration);
    const result = await provider.extract({ source: roleSource, sourceText: roleText, caseId: "llm-role-case" });
    expect(result.proposalRejections).toEqual([
      expect.objectContaining({ code: "ABSENT_QUOTE", proposalIndex: 0 }),
      expect.objectContaining({ code: "ABSENT_QUOTE", proposalIndex: 1 }),
    ]);
  });

  it("rejects a candidate quote that exists outside its declared structural parent bullet", async () => {
    const output = { proposals: [{ exactQuote: "Candidate", evidenceClass: "WORK_HISTORY", proofTypes: ["OWNERSHIP"] }] };
    const outcome = await new ExperimentalLlmExtractionExecutor(runnerFor(candidateSource, candidateText)).runCandidate(
      new ExperimentalLlmCandidateProofProvider(clientFor(output), configuration), { source: candidateSource },
    );
    expect(outcome.state).toBe("VERIFIED");
    if (outcome.state === "VERIFIED") {
      expect(outcome.result.output.metadata.proposalCounts).toEqual({ proposedClaims: 1, acceptedClaims: 0, rejectedClaims: 1 });
    }
  });

  it("rejects malformed candidate enums and duplicate proof types before assembly", async () => {
    const malformed = { proposals: [{ ...candidateProposal.proposals[0], proofTypes: ["OWNERSHIP", "OWNERSHIP"] }] };
    const outcome = await new ExperimentalLlmExtractionExecutor(runnerFor(candidateSource, candidateText)).runCandidate(
      new ExperimentalLlmCandidateProofProvider(clientFor(malformed), configuration), { source: candidateSource },
    );
    expect(outcome.state).toBe("REJECTED");
  });

  it("canonicalizes proof-type order before deriving candidate claim identity", async () => {
    const first = { proposals: [{ ...candidateProposal.proposals[0], proofTypes: ["OWNERSHIP", "FINANCIAL_SCOPE"] }] };
    const second = { proposals: [{ ...candidateProposal.proposals[0], proofTypes: ["FINANCIAL_SCOPE", "OWNERSHIP"] }] };
    const executor = new ExperimentalLlmExtractionExecutor(runnerFor(candidateSource, candidateText));
    const firstOutcome = await executor.runCandidate(new ExperimentalLlmCandidateProofProvider(clientFor(first), configuration), { source: candidateSource });
    const secondOutcome = await executor.runCandidate(new ExperimentalLlmCandidateProofProvider(clientFor(second), configuration), { source: candidateSource });
    expect(firstOutcome.state).toBe("VERIFIED");
    expect(secondOutcome.state).toBe("VERIFIED");
    if (firstOutcome.state === "VERIFIED" && secondOutcome.state === "VERIFIED") {
      expect(firstOutcome.result.output.allClaims[0]?.claimId).toBe(secondOutcome.result.output.allClaims[0]?.claimId);
      expect(firstOutcome.result.output.allClaims[0]?.proofTypes).toEqual(secondOutcome.result.output.allClaims[0]?.proofTypes);
    }
  });

  it("retains valid candidate proposals while accounting for invalid source anchors", async () => {
    const mixed = { proposals: [candidateProposal.proposals[0], { ...candidateProposal.proposals[0], exactQuote: "Absent from this document." }] };
    const outcome = await new ExperimentalLlmExtractionExecutor(runnerFor(candidateSource, candidateText)).runCandidate(
      new ExperimentalLlmCandidateProofProvider(clientFor(mixed), configuration), { source: candidateSource },
    );
    expect(outcome.state).toBe("VERIFIED");
    if (outcome.state === "VERIFIED") {
      expect(outcome.result.output.allClaims).toHaveLength(1);
      expect(outcome.result.output.metadata.proposalCounts).toEqual({ proposedClaims: 2, acceptedClaims: 1, rejectedClaims: 1 });
    }
  });

  it("applies deterministic metric and source-grounded-entity enrichment after semantic proposal resolution", async () => {
    const text = ["## PROFESSIONAL EXPERIENCE", "### Commercial Director | Acme | 2020–Present", "- Led APAC pricing governance with $8M revenue accountability."].join("\n");
    const proposal = { proposals: [{ exactQuote: "Led APAC pricing governance with $8M revenue accountability.", evidenceClass: "WORK_HISTORY", proofTypes: ["FINANCIAL_SCOPE"] }] };
    const outcome = await new ExperimentalLlmExtractionExecutor(runnerFor(candidateSource, text)).runCandidate(
      new ExperimentalLlmCandidateProofProvider(clientFor(proposal), configuration), { source: candidateSource },
    );
    expect(outcome.state).toBe("VERIFIED");
    if (outcome.state === "VERIFIED") {
      expect(outcome.result.output.allClaims[0]?.metrics).toEqual(expect.arrayContaining([expect.objectContaining({ metricType: "CURRENCY_AMOUNT", normalizedValue: 8_000_000 })]));
      expect(outcome.result.output.allClaims[0]?.groundedEntities).toEqual(expect.arrayContaining([expect.objectContaining({ exactText: "APAC", category: "GEOGRAPHY" })]));
    }
  });

  it("turns an unexpected deterministic normalizer failure into a whole-run rejection", async () => {
    const normalizer = vi.spyOn(CandidateProofExtractorV1.prototype, "extractMetrics").mockImplementation(() => {
      throw new Error("normalizer defect");
    });
    try {
      const outcome = await new ExperimentalLlmExtractionExecutor(runnerFor(candidateSource, candidateText)).runCandidate(
        new ExperimentalLlmCandidateProofProvider(clientFor(candidateProposal), configuration), { source: candidateSource },
      );
      expect(outcome).toMatchObject({ state: "REJECTED", rejection: { reason: expect.stringContaining("normalizer defect") } });
    } finally {
      normalizer.mockRestore();
    }
  });

  it("binds cache identity to model, prompt, proposal schema, assembler version, parameters, and immutable source", async () => {
    const stable = createLlmExperimentConfigurationFingerprint(configuration);
    expect(stable).not.toBe(createLlmExperimentConfigurationFingerprint({ ...configuration, assemblerVersion: "semantic-assembler/v3" }));
    expect(stable).not.toBe(createLlmExperimentConfigurationFingerprint({ ...configuration, generationParameters: { temperature: 0.1 } }));
    const first = await new ExperimentalLlmRoleIntelligenceProvider(clientFor(roleProposal), configuration).extract({ source: roleSource, sourceText: roleText, caseId: "one" });
    const second = await new ExperimentalLlmRoleIntelligenceProvider(clientFor(roleProposal), configuration).extract({ source: { ...roleSource, canonicalJobId: "different-job", opportunityVersion: "different-version" }, sourceText: roleText, caseId: "two" });
    expect(first.cacheIdentity.key).not.toBe(second.cacheIdentity.key);
    expect(first.output.atoms[0]?.id).not.toBe(second.output.atoms[0]?.id);
  });

  it("maps strict structured output and non-retention transport intent", () => {
    const mapped = toStrictStructuredOutputTransportRequest({ kind: "ROLE_INTELLIGENCE", model: configuration.model, prompt: "extract",
      responseSchema: { type: "object" }, cacheKey: "cache", sourceIdentity: "immutable-source", generationParameters: configuration.generationParameters, store: false });
    expect(mapped).toMatchObject({ store: false, text: { format: { type: "json_schema", strict: true } }, metadata: { sourceIdentity: "immutable-source" } });
  });
});
