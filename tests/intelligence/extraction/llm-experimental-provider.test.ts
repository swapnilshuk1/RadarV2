import { describe, expect, it } from "vitest";
import { CandidateProofExtractorV1 } from "../../../src/lib/intelligence/extraction/CandidateProofExtractorV1";
import {
  ExperimentalLlmExtractionExecutor,
  type ExperimentalExtractionOutcome,
} from "../../../src/lib/intelligence/extraction/ExperimentalLlmExtractionExecutor";
import {
  ExperimentalLlmCandidateProofProvider,
  ExperimentalLlmRoleIntelligenceProvider,
  LLM_EXPERIMENT_PROMPT_VERSION,
  LLM_EXPERIMENT_RESPONSE_SCHEMA_VERSION,
  createLlmExperimentConfigurationFingerprint,
  type LlmStructuredExtractionClient,
} from "../../../src/lib/intelligence/extraction/LlmExperimentalExtractionProvider";
import { RoleIntelligenceExtractorV1 } from "../../../src/lib/intelligence/extraction/RoleIntelligenceExtractorV1";
import { VerifiedExtractionProviderRunner } from "../../../src/lib/intelligence/extraction/VerifiedExtractionProviderRunner";
import type {
  CandidateDocumentSourceRef,
  OpportunityVersionSourceRef,
} from "../../../src/lib/domain/source_provenance";
import type { ResolvedSourceSnapshot } from "../../../src/lib/provenance/SourceSnapshotResolver";

const roleText = "Key Responsibilities\nOwn pricing governance across channel expansion.";
const candidateText = [
  "# Candidate",
  "## PROFESSIONAL EXPERIENCE",
  "### Commercial Director | Acme | 2020–Present",
  "- Led pricing governance across regional markets.",
].join("\n");

const roleSource: OpportunityVersionSourceRef = {
  kind: "OPPORTUNITY_VERSION",
  canonicalJobId: "job-llm-experiment",
  opportunityVersion: "opp-version-llm-experiment",
  contentHash: "content-hash-llm-experiment",
  sourcePayloadKey: null,
  sourcePayloadSha256: null,
};
const candidateSource: CandidateDocumentSourceRef = {
  kind: "CANDIDATE_DOCUMENT_TEXT",
  personId: "person-llm-experiment",
  documentId: "candidate-document-llm-experiment",
  documentHash: "candidate-document-hash",
  textHash: "candidate-text-hash",
};

const configuration = {
  providerId: "experimental-test-llm",
  model: "test-structured-model",
  promptVersion: LLM_EXPERIMENT_PROMPT_VERSION,
  responseSchemaVersion: LLM_EXPERIMENT_RESPONSE_SCHEMA_VERSION,
  generationParameters: { temperature: 0, seed: 73 },
} as const;

function snapshot(
  ref: CandidateDocumentSourceRef | OpportunityVersionSourceRef,
  text: string,
): ResolvedSourceSnapshot {
  return {
    ref,
    storage: "DATABASE_TEXT",
    mediaType: "text/plain; charset=utf-8",
    bytes: Buffer.from(text, "utf8"),
    text,
  };
}

function runnerFor(
  ref: CandidateDocumentSourceRef | OpportunityVersionSourceRef,
  text: string,
): { runner: VerifiedExtractionProviderRunner; resolverCalls: () => number } {
  let resolves = 0;
  const resolver = {
    resolve: async (requested: CandidateDocumentSourceRef | OpportunityVersionSourceRef) => {
      resolves += 1;
      expect(requested).toEqual(ref);
      return snapshot(ref, text);
    },
  };
  return {
    runner: new VerifiedExtractionProviderRunner(resolver as never),
    resolverCalls: () => resolves,
  };
}

function roleOutput() {
  return new RoleIntelligenceExtractorV1().extract({
    caseId: "llm-role-case",
    canonicalJobId: roleSource.canonicalJobId,
    rawText: roleText,
  });
}

function candidateOutput() {
  return new CandidateProofExtractorV1().extract({
    sourceDocumentId: candidateSource.documentId,
    rawText: candidateText,
  });
}

function responseFor(output: unknown, sourceIdentity?: string): LlmStructuredExtractionClient {
  return {
    async generate(request) {
      expect(request.model).toBe(configuration.model);
      expect(request.store).toBe(false);
      expect(request.prompt).toContain("Return JSON only");
      expect(request.prompt).toContain("SOURCE:");
      expect(request.cacheKey).toHaveLength(64);
      return {
        outputText: JSON.stringify({
          schemaVersion: LLM_EXPERIMENT_RESPONSE_SCHEMA_VERSION,
          sourceIdentity: sourceIdentity ?? request.sourceIdentity,
          output,
        }),
      };
    },
  };
}

describe("experimental LLM extraction providers", () => {
  it("runs role extraction only through the resolver-bound Batch 02 runner and common verifier", async () => {
    const seam = runnerFor(roleSource, roleText);
    const recorded: ExperimentalExtractionOutcome<unknown>[] = [];
    const executor = new ExperimentalLlmExtractionExecutor(seam.runner, {
      record: (outcome) => recorded.push(outcome),
    });
    const provider = new ExperimentalLlmRoleIntelligenceProvider(responseFor(roleOutput()), configuration);

    const outcome = await executor.runRole(provider, { source: roleSource, caseId: "llm-role-case" });

    expect(outcome.state).toBe("VERIFIED");
    expect(recorded).toEqual([outcome]);
    expect(seam.resolverCalls()).toBe(1);
    if (outcome.state === "VERIFIED") {
      expect(outcome.result.source).toEqual(roleSource);
      expect(outcome.result.provider.family).toBe("LLM");
    }
  });

  it("uses the same verified path for candidate proof extraction", async () => {
    const seam = runnerFor(candidateSource, candidateText);
    const executor = new ExperimentalLlmExtractionExecutor(seam.runner);
    const provider = new ExperimentalLlmCandidateProofProvider(responseFor(candidateOutput()), configuration);

    const outcome = await executor.runCandidate(provider, { source: candidateSource });

    expect(outcome.state).toBe("VERIFIED");
    expect(seam.resolverCalls()).toBe(1);
    if (outcome.state === "VERIFIED") {
      expect(outcome.result.source).toEqual(candidateSource);
      expect(outcome.result.output.sourceDocumentId).toBe(candidateSource.documentId);
    }
  });

  it("binds experiment identity to prompt, response schema, model, parameters, and immutable source", () => {
    const changedParameters = createLlmExperimentConfigurationFingerprint({
      ...configuration,
      generationParameters: { temperature: 0.2, seed: 73 },
    });
    const changedPrompt = createLlmExperimentConfigurationFingerprint({
      ...configuration,
      promptVersion: "gate1b-batch03/v2",
    });
    const stable = createLlmExperimentConfigurationFingerprint(configuration);
    const provider = new ExperimentalLlmRoleIntelligenceProvider(responseFor(roleOutput()), configuration);

    expect(stable).not.toBe(changedParameters);
    expect(stable).not.toBe(changedPrompt);
    expect(provider.descriptor.configurationFingerprint).toBe(stable);
  });

  it("fails closed into a rejected experiment when structured output is malformed or bound to another source", async () => {
    const malformed: LlmStructuredExtractionClient = {
      async generate() {
        return { outputText: "not-json" };
      },
    };
    const foreign = new ExperimentalLlmRoleIntelligenceProvider(
      responseFor(roleOutput(), "OPPORTUNITY_VERSION:foreign:version:hash:DATABASE_TEXT:NO_BLOB"),
      configuration,
    );
    const malformedOutcome = await new ExperimentalLlmExtractionExecutor(runnerFor(roleSource, roleText).runner)
      .runRole(new ExperimentalLlmRoleIntelligenceProvider(malformed, configuration), {
        source: roleSource,
        caseId: "llm-role-case",
      });
    const foreignOutcome = await new ExperimentalLlmExtractionExecutor(runnerFor(roleSource, roleText).runner)
      .runRole(foreign, { source: roleSource, caseId: "llm-role-case" });

    expect(malformedOutcome).toMatchObject({ state: "REJECTED", rejection: { providerId: configuration.providerId } });
    expect(foreignOutcome).toMatchObject({ state: "REJECTED", rejection: { providerId: configuration.providerId } });
  });

  it("fails closed when the common verifier rejects a source span rather than repairing the provider output", async () => {
    const invalidOutput = roleOutput();
    const invalidAtom = invalidOutput.atoms[0]!;
    const provider = new ExperimentalLlmRoleIntelligenceProvider(responseFor({
      ...invalidOutput,
      atoms: [{ ...invalidAtom, exactText: "Invented role mandate" }],
    }), configuration);

    const outcome = await new ExperimentalLlmExtractionExecutor(runnerFor(roleSource, roleText).runner)
      .runRole(provider, { source: roleSource, caseId: "llm-role-case" });

    expect(outcome).toMatchObject({ state: "REJECTED", rejection: { providerId: configuration.providerId } });
  });
});
