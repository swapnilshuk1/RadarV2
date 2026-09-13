import crypto from "crypto";
import {
  createProviderCacheIdentity,
  type CandidateExtractionProviderInput,
  type LlmCandidateProofExtractionProvider,
  type LlmRoleIntelligenceExtractionProvider,
  type ProviderExtractionResult,
  type RoleExtractionProviderInput,
} from "./ExtractionProvider";
import type { CandidateProofOutputV1 } from "./CandidateProofExtractorV1";
import type { RoleIntelligenceOutputV1 } from "./RoleIntelligenceExtractorV1";
import {
  CANDIDATE_SEMANTIC_PROPOSAL_JSON_SCHEMA,
  LLM_SEMANTIC_ASSEMBLER_VERSION,
  LLM_SEMANTIC_PROPOSAL_SCHEMA_VERSION,
  ROLE_SEMANTIC_PROPOSAL_JSON_SCHEMA,
  assembleCandidateSemanticProposals,
  assembleRoleSemanticProposals,
  parseCandidateSemanticProposals,
  parseRoleSemanticProposals,
  type SemanticProposalRejection,
} from "./ExperimentalSemanticProposal";

export const LLM_EXPERIMENT_PROMPT_VERSION = "gate1b-batch03/proposals-v1";
export const LLM_EXPERIMENT_RESPONSE_SCHEMA_VERSION = "llm-semantic-proposal-envelope/v1";

export interface LlmExperimentConfiguration {
  readonly providerId: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly responseSchemaVersion: string;
  readonly proposalSchemaVersion: string;
  readonly assemblerVersion: string;
  readonly generationParameters: Readonly<Record<string, string | number | boolean | null>>;
}

export interface LlmStructuredRequest {
  readonly kind: "ROLE_INTELLIGENCE" | "CANDIDATE_PROOF";
  readonly model: string;
  readonly prompt: string;
  readonly responseSchema: Readonly<Record<string, unknown>>;
  readonly cacheKey: string;
  readonly sourceIdentity: string;
  readonly generationParameters: Readonly<Record<string, string | number | boolean | null>>;
  /** Experimental calls must not ask a transport to retain source material. */
  readonly store: false;
}

export interface LlmStructuredResponse {
  readonly outputText: string;
  readonly responseId?: string;
  readonly model?: string;
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number; readonly totalTokens?: number };
  readonly estimatedCostUsd?: number;
}

/** Transport is injected so Batch 03 has no provider SDK, credential, or serving dependency. */
export interface LlmStructuredExtractionClient {
  generate(request: LlmStructuredRequest): Promise<LlmStructuredResponse>;
}

/** Provider-SDK-neutral representation of a Responses-style strict JSON request. */
export interface StrictStructuredOutputTransportRequest {
  readonly model: string;
  readonly input: string;
  readonly store: false;
  readonly text: {
    readonly format: {
      readonly type: "json_schema";
      readonly name: "radar_experimental_extraction";
      readonly strict: true;
      readonly schema: Readonly<Record<string, unknown>>;
    };
  };
  readonly metadata: Readonly<{ cacheKey: string; sourceIdentity: string; kind: LlmStructuredRequest["kind"] }>;
  readonly generationParameters: LlmStructuredRequest["generationParameters"];
}

/**
 * The real transport adapter must use this mapping verbatim. It makes strict
 * structured output and non-retention explicit without coupling Batch 03 to a
 * provider SDK or credential.
 */
export function toStrictStructuredOutputTransportRequest(
  request: LlmStructuredRequest,
): StrictStructuredOutputTransportRequest {
  return {
    model: request.model,
    input: request.prompt,
    store: false,
    text: {
      format: {
        type: "json_schema",
        name: "radar_experimental_extraction",
        strict: true,
        schema: request.responseSchema,
      },
    },
    metadata: { cacheKey: request.cacheKey, sourceIdentity: request.sourceIdentity, kind: request.kind },
    generationParameters: request.generationParameters,
  };
}

export class LlmExperimentalExtractionError extends Error {
  constructor(
    readonly code: "TRANSPORT" | "MALFORMED_JSON" | "SCHEMA" | "SOURCE_BINDING",
    message: string,
  ) {
    super(message);
    this.name = "LlmExperimentalExtractionError";
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createLlmExperimentConfigurationFingerprint(
  configuration: LlmExperimentConfiguration,
): string {
  return crypto.createHash("sha256").update(stableJson(configuration)).digest("hex");
}

function envelopeSchema(kind: LlmStructuredRequest["kind"]): Readonly<Record<string, unknown>> {
  return {
  type: "object",
  required: ["schemaVersion", "output"],
  properties: {
    schemaVersion: { type: "string", const: LLM_EXPERIMENT_RESPONSE_SCHEMA_VERSION },
    output: kind === "ROLE_INTELLIGENCE" ? ROLE_SEMANTIC_PROPOSAL_JSON_SCHEMA : CANDIDATE_SEMANTIC_PROPOSAL_JSON_SCHEMA,
  },
  additionalProperties: false,
  };
}

function createPrompt(
  kind: LlmStructuredRequest["kind"],
  promptVersion: string,
  sourceText: string,
): string {
  return [
    `You are an experimental ${kind} extractor using prompt ${promptVersion}.`,
    "Return JSON only, conforming exactly to the supplied schema.",
    "Return only semantic proposals with exact source quotes. Do not emit IDs, source identity, offsets, sections, collections, counts, or metrics.",
    "Do not make recommendations, evaluate fit, or introduce facts absent from the source.",
    "SOURCE:",
    sourceText,
  ].join("\n");
}

function parseEnvelope(response: LlmStructuredResponse): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.outputText);
  } catch {
    throw new LlmExperimentalExtractionError("MALFORMED_JSON", "LLM response is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LlmExperimentalExtractionError("SCHEMA", "LLM response is not an extraction envelope.");
  }
  const envelope = parsed as Record<string, unknown>;
  if (
    Object.keys(envelope).some((key) => key !== "schemaVersion" && key !== "output")
    || Object.keys(envelope).length !== 2
    || envelope.schemaVersion !== LLM_EXPERIMENT_RESPONSE_SCHEMA_VERSION
    || typeof envelope.output !== "object"
    || envelope.output === null
    || Array.isArray(envelope.output)
  ) {
    throw new LlmExperimentalExtractionError("SCHEMA", "LLM response violates the experimental response schema.");
  }
  return envelope;
}

abstract class LlmExperimentalProviderBase {
  protected readonly configurationFingerprint: string;

  constructor(
    protected readonly client: LlmStructuredExtractionClient,
    protected readonly configuration: LlmExperimentConfiguration,
  ) {
    if (
      configuration.promptVersion !== LLM_EXPERIMENT_PROMPT_VERSION
      || configuration.responseSchemaVersion !== LLM_EXPERIMENT_RESPONSE_SCHEMA_VERSION
      || configuration.proposalSchemaVersion !== LLM_SEMANTIC_PROPOSAL_SCHEMA_VERSION
      || configuration.assemblerVersion !== LLM_SEMANTIC_ASSEMBLER_VERSION
    ) {
      throw new LlmExperimentalExtractionError(
        "SCHEMA",
        "Experimental LLM configuration does not match the approved prompt and response schema versions.",
      );
    }
    this.configurationFingerprint = createLlmExperimentConfigurationFingerprint(configuration);
  }

  protected async request(
    kind: LlmStructuredRequest["kind"],
    sourceText: string,
    sourceIdentity: string,
    cacheKey: string,
  ): Promise<{ output: Record<string, unknown>; telemetry: LlmExecutionTelemetry }> {
    try {
      const startedAt = performance.now();
      const response = await this.client.generate({
        kind,
        model: this.configuration.model,
        prompt: createPrompt(kind, this.configuration.promptVersion, sourceText),
        responseSchema: envelopeSchema(kind),
        cacheKey,
        sourceIdentity,
        generationParameters: this.configuration.generationParameters,
        store: false,
      });
      const envelope = parseEnvelope(response);
      return {
        output: envelope.output as Record<string, unknown>,
        telemetry: {
          requestedModel: this.configuration.model,
          actualModel: response.model,
          responseId: response.responseId,
          latencyMs: performance.now() - startedAt,
          usage: response.usage,
          estimatedCostUsd: response.estimatedCostUsd,
        },
      };
    } catch (error) {
      if (error instanceof LlmExperimentalExtractionError) throw error;
      throw new LlmExperimentalExtractionError(
        "TRANSPORT",
        `Experimental LLM transport failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export interface LlmExecutionTelemetry {
  readonly requestedModel: string;
  readonly actualModel?: string;
  readonly responseId?: string;
  readonly latencyMs: number;
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number; readonly totalTokens?: number };
  readonly estimatedCostUsd?: number;
}

export interface ExperimentalLlmProviderResult<T> extends ProviderExtractionResult<T> {
  readonly experimentalTelemetry: LlmExecutionTelemetry;
  /** Experiment-only causality sidecar; never part of the V1 output contract. */
  readonly proposalRejections: readonly SemanticProposalRejection[];
}

export class ExperimentalLlmRoleIntelligenceProvider
  extends LlmExperimentalProviderBase
  implements LlmRoleIntelligenceExtractionProvider {
  public readonly descriptor;

  constructor(client: LlmStructuredExtractionClient, configuration: LlmExperimentConfiguration) {
    super(client, configuration);
    this.descriptor = {
      family: "LLM" as const,
      providerId: configuration.providerId,
      schemaVersion: "role-intelligence/v1" as const,
      configurationFingerprint: this.configurationFingerprint,
    };
  }

  async extract(input: RoleExtractionProviderInput): Promise<ExperimentalLlmProviderResult<RoleIntelligenceOutputV1>> {
    const cacheIdentity = createProviderCacheIdentity(input.source, this.descriptor);
    const response = await this.request("ROLE_INTELLIGENCE", input.sourceText, cacheIdentity.sourceIdentity, cacheIdentity.key);
    const assembled = assembleRoleSemanticProposals({
      sourceText: input.sourceText, caseId: input.caseId, canonicalJobId: input.source.canonicalJobId,
      companyName: input.companyName, title: input.title, proposals: parseRoleSemanticProposals(response.output),
    });
    return {
      provider: this.descriptor,
      cacheIdentity,
      source: input.source,
      output: assembled.output,
      proposalRejections: assembled.proposalRejections,
      experimentalTelemetry: response.telemetry,
    };
  }
}

export class ExperimentalLlmCandidateProofProvider
  extends LlmExperimentalProviderBase
  implements LlmCandidateProofExtractionProvider {
  public readonly descriptor;

  constructor(client: LlmStructuredExtractionClient, configuration: LlmExperimentConfiguration) {
    super(client, configuration);
    this.descriptor = {
      family: "LLM" as const,
      providerId: configuration.providerId,
      schemaVersion: "candidate-proof/v1" as const,
      configurationFingerprint: this.configurationFingerprint,
    };
  }

  async extract(input: CandidateExtractionProviderInput): Promise<ExperimentalLlmProviderResult<CandidateProofOutputV1>> {
    const cacheIdentity = createProviderCacheIdentity(input.source, this.descriptor);
    const response = await this.request("CANDIDATE_PROOF", input.sourceText, cacheIdentity.sourceIdentity, cacheIdentity.key);
    const assembled = assembleCandidateSemanticProposals({
      sourceText: input.sourceText, sourceDocumentId: input.source.documentId,
      proposals: parseCandidateSemanticProposals(response.output),
    });
    return {
      provider: this.descriptor,
      cacheIdentity,
      source: input.source,
      output: assembled.output,
      proposalRejections: assembled.proposalRejections,
      experimentalTelemetry: response.telemetry,
    };
  }
}
