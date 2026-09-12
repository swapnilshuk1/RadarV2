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

export const LLM_EXPERIMENT_PROMPT_VERSION = "gate1b-batch03/v1";
export const LLM_EXPERIMENT_RESPONSE_SCHEMA_VERSION = "llm-extraction-envelope/v1";

export interface LlmExperimentConfiguration {
  readonly providerId: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly responseSchemaVersion: string;
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
}

/** Transport is injected so Batch 03 has no provider SDK, credential, or serving dependency. */
export interface LlmStructuredExtractionClient {
  generate(request: LlmStructuredRequest): Promise<LlmStructuredResponse>;
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

const ENVELOPE_SCHEMA: Readonly<Record<string, unknown>> = {
  type: "object",
  required: ["schemaVersion", "sourceIdentity", "output"],
  properties: {
    schemaVersion: { type: "string", const: LLM_EXPERIMENT_RESPONSE_SCHEMA_VERSION },
    sourceIdentity: { type: "string" },
    output: { type: "object" },
  },
  additionalProperties: false,
};

function createPrompt(
  kind: LlmStructuredRequest["kind"],
  promptVersion: string,
  sourceText: string,
): string {
  return [
    `You are an experimental ${kind} extractor using prompt ${promptVersion}.`,
    "Return JSON only, conforming exactly to the supplied schema.",
    "Every text field and offset must resolve exactly against the supplied source.",
    "Do not make recommendations, evaluate fit, or introduce facts absent from the source.",
    "SOURCE:",
    sourceText,
  ].join("\n");
}

function parseEnvelope(
  response: LlmStructuredResponse,
  sourceIdentity: string,
): Record<string, unknown> {
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
    envelope.schemaVersion !== LLM_EXPERIMENT_RESPONSE_SCHEMA_VERSION
    || typeof envelope.output !== "object"
    || envelope.output === null
    || Array.isArray(envelope.output)
  ) {
    throw new LlmExperimentalExtractionError("SCHEMA", "LLM response violates the experimental response schema.");
  }
  if (envelope.sourceIdentity !== sourceIdentity) {
    throw new LlmExperimentalExtractionError("SOURCE_BINDING", "LLM response is bound to a different immutable source.");
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
  ): Promise<Record<string, unknown>> {
    try {
      const response = await this.client.generate({
        kind,
        model: this.configuration.model,
        prompt: createPrompt(kind, this.configuration.promptVersion, sourceText),
        responseSchema: ENVELOPE_SCHEMA,
        cacheKey,
        sourceIdentity,
        generationParameters: this.configuration.generationParameters,
        store: false,
      });
      return parseEnvelope(response, sourceIdentity);
    } catch (error) {
      if (error instanceof LlmExperimentalExtractionError) throw error;
      throw new LlmExperimentalExtractionError(
        "TRANSPORT",
        `Experimental LLM transport failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
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

  async extract(input: RoleExtractionProviderInput): Promise<ProviderExtractionResult<RoleIntelligenceOutputV1>> {
    const cacheIdentity = createProviderCacheIdentity(input.source, this.descriptor);
    const envelope = await this.request("ROLE_INTELLIGENCE", input.sourceText, cacheIdentity.sourceIdentity, cacheIdentity.key);
    return {
      provider: this.descriptor,
      cacheIdentity,
      source: input.source,
      output: envelope.output as RoleIntelligenceOutputV1,
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

  async extract(input: CandidateExtractionProviderInput): Promise<ProviderExtractionResult<CandidateProofOutputV1>> {
    const cacheIdentity = createProviderCacheIdentity(input.source, this.descriptor);
    const envelope = await this.request("CANDIDATE_PROOF", input.sourceText, cacheIdentity.sourceIdentity, cacheIdentity.key);
    return {
      provider: this.descriptor,
      cacheIdentity,
      source: input.source,
      output: envelope.output as CandidateProofOutputV1,
    };
  }
}
