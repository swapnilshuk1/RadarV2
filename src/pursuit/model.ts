/**
 * src/pursuit/model.ts
 *
 * Model routing for the Pursuit Cockpit.
 *
 * Provider policy (product-owner locked): AWS Bedrock Mantle and Google Vertex
 * Gemini only. No other gateway, broker or hosted-inference dependency is
 * permitted in this module, and nothing here may fall back to one.
 *
 * Mantle is primary because pursuit generation is a strict-JSON structured
 * reasoning task and Mantle is already the staged structured-output route.
 * DeepSeek V3.2 is the default primary model and GLM-5 is the same-provider
 * fallback; Gemini remains the optional cross-provider secondary. When none are
 * configured, callers fall back to deterministic derivation rather than
 * failing the user's journey.
 */

import type { ModelCallMetadata, ModelUsage } from "../lib/model/model-invocation";
import type { PursuitModelContext } from "./budget";

/**
 * Mantle bearer keys are base64 and are sometimes stored with the trailing
 * padding clipped. Pure string work, kept local so this module stays portable:
 * importing the credential loader would pull node:fs/node:path (and, through
 * the ADC helper, google-auth-library -> node:process) into every runtime that
 * bundles the cockpit, including edge bundlers that ship no Node ESM modules.
 */
function normalizeMantleKey(value: string): string {
  const key = value.trim();
  if (!/^[A-Za-z0-9+/]+=*$/.test(key)) return key;
  const remainder = key.length % 4;
  if (remainder === 0) return key;
  return key.padEnd(key.length + (4 - remainder), "=");
}

export interface PursuitModel {
  id: string;
  generate(
    instruction: string,
    input: unknown,
    schema: Record<string, unknown>,
    metadata?: ModelCallMetadata,
  ): Promise<unknown>;
  /** Provider-reported usage for the most recent call, when available. */
  usage(): ModelUsage | undefined;
}

/** Env reads go through the global so no runtime-specific module is imported. */
function env(name: string): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[
    name
  ]?.trim();
}

export const DEFAULT_PURSUIT_MANTLE_PRIMARY_MODEL = "deepseek.v3.2";
export const DEFAULT_PURSUIT_MANTLE_FALLBACK_MODEL = "zai.glm-5";

/**
 * The operator override changes the Mantle primary, but GLM-5 remains the
 * in-provider fallback unless it is already primary. This keeps a single
 * transport/credential path and avoids falling back to deterministic output
 * for a transient or model-specific Mantle failure.
 */
export function pursuitMantleModelIds(): string[] {
  const primary = env("RADAR_PURSUIT_MANTLE_MODEL") || DEFAULT_PURSUIT_MANTLE_PRIMARY_MODEL;
  return primary === DEFAULT_PURSUIT_MANTLE_FALLBACK_MODEL
    ? [primary]
    : [primary, DEFAULT_PURSUIT_MANTLE_FALLBACK_MODEL];
}

async function mantleModels(context?: PursuitModelContext): Promise<PursuitModel[]> {
  const raw = env("BEDROCK_MANTLE_API_KEY");
  if (!raw) return [];
  const apiKey = normalizeMantleKey(raw);
  const { BedrockMantleJsonModel } = await import("../lib/model/bedrock-mantle-model");
  return pursuitMantleModelIds().map((modelId) => {
    const model = new BedrockMantleJsonModel(modelId, async () => apiKey, fetch, {
      region: env("AWS_REGION") || "us-east-1",
      maxOutputTokens: 10_240,
      timeoutMs: 120_000,
      ...(context?.invocationSink ? { invocationSink: context.invocationSink } : {}),
    });
    return {
      id: `bedrock-mantle:${model.version}`,
      generate: (
        instruction: string,
        input: unknown,
        schema: Record<string, unknown>,
        metadata?: ModelCallMetadata,
      ) => model.generate(instruction, input, schema, metadata),
      usage: () => model.lastUsage,
    };
  });
}

/** Vertex reports usage under its own field names; normalise to ModelUsage. */
function geminiUsage(raw: GeminiUsage): ModelUsage | undefined {
  if (!raw) return undefined;
  return {
    inputTokens: raw.promptTokenCount,
    outputTokens: raw.candidatesTokenCount,
    reasoningTokens: raw.thoughtsTokenCount,
    totalTokens: raw.totalTokenCount,
    cachedInputTokens: raw.cachedContentTokenCount,
  };
}

type GeminiUsage =
  | {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
      totalTokenCount?: number;
      cachedContentTokenCount?: number;
    }
  | undefined;

/**
 * Gemini stays the declared secondary but is opt-in: this organization's GCP
 * policy blocks service-account keys, so ADC yields no token outside GCP and
 * every call would fail. Set RADAR_PURSUIT_ENABLE_GEMINI=true once ADC works.
 */
async function geminiModel(context?: PursuitModelContext): Promise<PursuitModel | null> {
  if (env("RADAR_PURSUIT_ENABLE_GEMINI")?.toLowerCase() !== "true") return null;
  const projectId = env("GCP_PROJECT_ID");
  if (!projectId) return null;
  // Loaded on demand so the Node-only ADC library is never part of the static
  // import graph when Gemini is disabled.
  let provider: (() => Promise<string>) | undefined;
  const token = async () => {
    provider ??= (await import("../lib/model/google-adc")).adcTokenProvider();
    return provider();
  };
  const { GeminiJsonModel } = await import("../lib/model/json-model");
  const model = new GeminiJsonModel(projectId, token, fetch, {
    model: env("RADAR_PURSUIT_GEMINI_MODEL") || "gemini-3.8-flash",
    location: "global",
    schemaFormat: "json-schema",
    thinkingLevel: "LOW",
    maxOutputTokens: 10_240,
    ...(context?.invocationSink ? { invocationSink: context.invocationSink } : {}),
  });
  return {
    id: `vertex-gemini:${model.version}`,
    generate: (instruction, input, schema, metadata) =>
      model.generate(instruction, input, schema, metadata),
    usage: () => geminiUsage(model.lastUsage),
  };
}

/** Ordered provider chain. Empty means deterministic derivation only. */
export async function pursuitModelChain(context?: PursuitModelContext): Promise<PursuitModel[]> {
  if (context?.configuredModels) return context.configuredModels;
  const [mantle, gemini] = await Promise.all([mantleModels(context), geminiModel(context)]);
  return [...mantle, ...(gemini ? [gemini] : [])];
}

/**
 * Try each configured provider in order. A provider failure is never fatal:
 * the caller keeps a deterministic result so the cockpit always opens.
 */
export async function generateWithFallback<T>(
  stage: string,
  instruction: string,
  input: unknown,
  schema: Record<string, unknown>,
  parse: (raw: unknown) => T,
  context?: PursuitModelContext,
): Promise<{ value: T; modelId: string } | null> {
  // A package that has spent its token allowance stops calling providers and
  // finishes deterministically rather than billing without a ceiling.
  if (context?.ledger?.exhausted()) {
    console.warn(`[pursuit] ${stage} skipped — package token budget exhausted.`);
    return null;
  }
  const failures: string[] = [];
  for (const model of await pursuitModelChain(context)) {
    try {
      const raw = await model.generate(instruction, input, schema, { stage });
      context?.ledger?.record(model.usage());
      return { value: parse(raw), modelId: model.id };
    } catch (error) {
      if (error instanceof Error && error.name === "QuotaDeferredError") throw error;
      context?.ledger?.record(model.usage());
      failures.push(`${model.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length > 0) {
    console.warn(`[pursuit] ${stage} model derivation unavailable — ${failures.join(" | ")}`);
  }
  return null;
}
