import { describe, expect, it } from "vitest";
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
    ["fabricated quote", { proposals: [{ ...roleProposal.proposals[0], exactQuote: "Invented mandate." }] }],
    ["ambiguous repeated quote", { proposals: [{ ...roleProposal.proposals[0], exactQuote: "Own pricing." }] }],
    ["invalid semantic enum", { proposals: [{ ...roleProposal.proposals[0], semanticType: "NOT_A_TYPE" }] }],
    ["model-authored identity", { proposals: [{ ...roleProposal.proposals[0], caseId: "forged" }] }],
    ["duplicate semantic anchor", { proposals: [roleProposal.proposals[0], roleProposal.proposals[0]] }],
  ])("rejects %s rather than repairing an experimental role proposal", async (_label, output) => {
    const text = _label === "ambiguous repeated quote" ? "Own pricing. Own pricing." : roleText;
    const outcome = await new ExperimentalLlmExtractionExecutor(runnerFor(roleSource, text)).runRole(
      new ExperimentalLlmRoleIntelligenceProvider(clientFor(output), configuration), { source: roleSource, caseId: "llm-role-case" },
    );
    expect(outcome.state).toBe("REJECTED");
  });

  it("rejects a candidate quote that exists outside its declared structural parent bullet", async () => {
    const output = { proposals: [{ exactQuote: "Candidate", evidenceClass: "WORK_HISTORY", proofTypes: ["OWNERSHIP"] }] };
    const outcome = await new ExperimentalLlmExtractionExecutor(runnerFor(candidateSource, candidateText)).runCandidate(
      new ExperimentalLlmCandidateProofProvider(clientFor(output), configuration), { source: candidateSource },
    );
    expect(outcome.state).toBe("REJECTED");
  });

  it("rejects malformed candidate enums and duplicate proof types before assembly", async () => {
    const malformed = { proposals: [{ ...candidateProposal.proposals[0], proofTypes: ["OWNERSHIP", "OWNERSHIP"] }] };
    const outcome = await new ExperimentalLlmExtractionExecutor(runnerFor(candidateSource, candidateText)).runCandidate(
      new ExperimentalLlmCandidateProofProvider(clientFor(malformed), configuration), { source: candidateSource },
    );
    expect(outcome.state).toBe("REJECTED");
  });

  it("binds cache identity to model, prompt, proposal schema, assembler version, parameters, and immutable source", async () => {
    const stable = createLlmExperimentConfigurationFingerprint(configuration);
    expect(stable).not.toBe(createLlmExperimentConfigurationFingerprint({ ...configuration, assemblerVersion: "semantic-assembler/v2" }));
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
