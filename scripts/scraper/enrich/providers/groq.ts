// Groq enrichment provider — alternate transport for the same intrinsic-JD contract.
import type { EnrichmentProvider, EnrichInput, EnrichPatch } from "../contract";
import {
  INTRINSIC_ENRICHMENT_SYSTEM_INSTRUCTION,
  buildIntrinsicEnrichmentPayload,
  buildIntrinsicResponseJsonSchema,
  validateIntrinsicEnrichmentPatch,
} from "../intrinsic-contract";

export const DEFAULT_GROQ_ENRICHMENT_MODEL = "qwen/qwen3.8-27b";
const STRICT_SCHEMA_MODELS = new Set([
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
]);

export const groqMetrics = {
  retries429: 0,
  failures: 0,
  successes: 0,
};

function responseFormat(model: string, missingKeys: readonly string[]) {
  const schema = buildIntrinsicResponseJsonSchema(missingKeys);
  return STRICT_SCHEMA_MODELS.has(model)
    ? {
        type: "json_schema",
        json_schema: {
          name: "radar_intrinsic_job_enrichment",
          strict: true,
          schema,
        },
      }
    : { type: "json_object" };
}

async function groqCall(apiKey: string, model: string, input: EnrichInput): Promise<any> {
  const payload = buildIntrinsicEnrichmentPayload(input);
  const prompt = `${INTRINSIC_ENRICHMENT_SYSTEM_INSTRUCTION}\n\nINPUT JSON:\n${JSON.stringify(payload)}`;
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      reasoning_effort: model === "qwen/qwen3.8-27b" ? "none" : undefined,
      max_completion_tokens: 1024,
      response_format: responseFormat(model, input.missingKeys),
    }),
  });
  return { res, data: res.ok ? await res.json() : null, status: res.status };
}

async function enrichWithGroq(input: EnrichInput): Promise<EnrichPatch | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const model = process.env.GROQ_MODEL || DEFAULT_GROQ_ENRICHMENT_MODEL;

  try {
    let { res, data, status } = await groqCall(apiKey, model, input);
    if (status === 429) {
      groqMetrics.retries429++;
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      ({ res, data, status } = await groqCall(apiKey, model, input));
    }
    if (!res.ok) throw new Error(`Groq status ${status}`);

    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error("Groq returned empty response");
    const parsed = validateIntrinsicEnrichmentPatch(JSON.parse(text), input);
    if (!parsed) throw new Error("Groq returned an invalid intrinsic-enrichment payload");

    groqMetrics.successes++;
    return parsed;
  } catch (err: any) {
    console.warn(`[enrich:groq] LLM fallback failed: ${err.message}`);
    groqMetrics.failures++;
    return null;
  }
}

export const groqProvider: EnrichmentProvider = {
  id: `groq:${process.env.GROQ_MODEL || DEFAULT_GROQ_ENRICHMENT_MODEL}@4.0.0`,
  async enrich(input: EnrichInput) {
    return enrichWithGroq(input);
  },
};
