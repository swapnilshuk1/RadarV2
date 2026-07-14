import fs from "fs";
import type { PortalName } from "../types";
import { CANDIDATE_PROFILE_JSON } from "../config";

interface EnrichInput {
  title: string;
  company: string;
  location: string;
  snippet: string;
  detailText: string;
  applyUrl: string;
  portal: PortalName;
  missingKeys: string[];
}

// Returned patches are Inferred, not Explicit — the LLM never gets to claim
// verbatim evidence. That contract is enforced in extractor.ts.
type Patch = Record<string, { value: string | null; rationale?: string }>;

let profileCache: string | null = null;
function loadProfile(): string {
  if (profileCache !== null) return profileCache;
  try { profileCache = fs.readFileSync(CANDIDATE_PROFILE_JSON, "utf-8"); }
  catch { profileCache = "{}"; }
  return profileCache;
}

export async function enrichWithLLM(input: EnrichInput): Promise<Patch | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // No key = deterministic-only run. Not an error, just no fallback.
    return null;
  }
  const prompt = buildPrompt(input);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini status ${res.status}`);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("empty response");
    return JSON.parse(text) as Patch;
  } catch (err: any) {
    console.warn(`[enrich] LLM fallback failed: ${err.message}`);
    return null;
  }
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
