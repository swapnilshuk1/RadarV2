// Groq enrichment provider — uses Groq's OpenAI-compatible chat endpoint.
// Model is configurable via GROQ_MODEL env var (default: llama-3.3-70b-versatile).
import type { EnrichmentProvider, EnrichInput, EnrichPatch } from "../contract";
import fs from "fs";
import { CANDIDATE_PROFILE_JSON } from "../../config";

const DEFAULT_MODEL = "llama-3.3-70b-versatile";

let profileCache: string | null = null;
function loadProfile(): string {
  if (profileCache !== null) return profileCache;
  try { profileCache = fs.readFileSync(CANDIDATE_PROFILE_JSON, "utf-8"); }
  catch { profileCache = "{}"; }
  return profileCache;
}

function buildPrompt(input: EnrichInput): string {
  return `You are an executive search analyst filling *missing* fields in a job posting.
Candidate profile (context only):
${loadProfile()}

Job posting:
Title: ${input.title}
Company: ${input.company}
Location: ${input.location}
Portal: ${input.portal}
URL: ${input.applyUrl}
Snippet: ${input.snippet}
Detail: ${input.detailText.slice(0, 6000)}

Return ONLY a JSON object mapping each of these dimension keys to an object
{ "value": "<short answer or null>", "rationale": "<one sentence>" }.
Dimensions to fill: ${JSON.stringify(input.missingKeys)}

Rules:
- If the posting does not mention the field, return "value": null.
- Never invent numbers, company names, or reporting relationships.
- Prefer null over guessing.`;
}

export const groqMetrics = {
  retries429: 0,
  failures: 0,
  successes: 0
};

async function groqCall(apiKey: string, model: string, prompt: string): Promise<any> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });
  return { res, data: res.ok ? await res.json() : null, status: res.status };
}

async function enrichWithGroq(input: EnrichInput): Promise<EnrichPatch | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null; // No key = deterministic-only run.

  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
  const prompt = buildPrompt(input);

  try {
    let { res, data, status } = await groqCall(apiKey, model, prompt);

    if (status === 429) {
      // Rate-limited — wait 10 s and retry once.
      console.warn("[enrich:groq] Rate-limited (429) — retrying in 10 s");
      groqMetrics.retries429++;
      await new Promise((r) => setTimeout(r, 10_000));
      ({ res, data, status } = await groqCall(apiKey, model, prompt));
    }

    if (!res.ok) throw new Error(`Groq status ${status}`);

    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error("Groq returned empty response");

    // Log token usage if available.
    if (data.usage) {
      console.info(
        `[enrich:groq] tokens — prompt:${data.usage.prompt_tokens} completion:${data.usage.completion_tokens}`
      );
    }

    groqMetrics.successes++;
    return JSON.parse(text) as EnrichPatch;
  } catch (err: any) {
    console.warn(`[enrich:groq] LLM fallback failed: ${err.message}`);
    groqMetrics.failures++;
    return null;
  }
}

export const groqProvider: EnrichmentProvider = {
  id: `groq:${process.env.GROQ_MODEL || DEFAULT_MODEL}`,
  async enrich(input: EnrichInput) {
    return enrichWithGroq(input);
  },
};
