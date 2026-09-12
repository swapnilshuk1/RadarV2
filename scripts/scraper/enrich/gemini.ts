import { execSync } from "child_process";
import fs from "fs";
import path from "path";
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

// Cache the access token and its expiry to avoid spawning gcloud on every single request
let adcTokenCache: { token: string; expiresAt: number } | null = null;

function getADCToken(): string | null {
  try {
    if (adcTokenCache && Date.now() < adcTokenCache.expiresAt) {
      return adcTokenCache.token;
    }

    // Determine the command to run. First try standard path gcloud.
    // If that fails, check common absolute paths on Windows.
    let cmd = "gcloud";
    
    if (process.platform === "win32") {
      const commonPaths = [
        "C:\\Program Files (x86)\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd",
        path.join(process.env.USERPROFILE || "", "AppData\\Local\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd"),
        "C:\\Program Files\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd"
      ];
      for (const p of commonPaths) {
        if (fs.existsSync(p)) {
          cmd = `"${p}"`;
          break;
        }
      }
    }

    const token = execSync(`${cmd} auth application-default print-access-token`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (token) {
      adcTokenCache = {
        token,
        expiresAt: Date.now() + 50 * 60 * 1000, // Cache for 50 minutes
      };
      return token;
    }
  } catch (err: any) {
    console.warn(`[enrich:gemini] Failed to get ADC token from gcloud CLI: ${err.message}`);
  }
  return null;
}

let requestQueue: Promise<any> = Promise.resolve();

export async function enrichWithLLM(input: EnrichInput): Promise<Patch | null> {
  // Queue calls serially to enforce strict 4.1s spacing between Vertex AI calls
  const result = new Promise<Patch | null>((resolve) => {
    requestQueue = requestQueue.then(async () => {
      try {
        const patch = await executeEnrichWithLLM(input);
        resolve(patch);
      } catch (err: any) {
        resolve(null);
      }
    });
  });
  return result;
}

async function executeEnrichWithLLM(input: EnrichInput, retryCount = 0): Promise<Patch | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let url = "";

  if (apiKey) {
    url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  } else {
    const adcToken = getADCToken();
    if (!adcToken) {
      return null;
    }
    headers["Authorization"] = `Bearer ${adcToken}`;
    const projectId = process.env.GCP_PROJECT_ID || "project-0e166cfc-e3f5-49d7-af6";
    url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent`;
    
    // Throttle to stay within Vertex AI's default 15 RPM (1 request / 4.1s) trial quota
    await new Promise(resolve => setTimeout(resolve, 4200));
  }

  const prompt = buildPrompt(input);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
      }),
    });

    if (res.status === 429) {
      if (retryCount < 3) {
        const backoffMs = (retryCount + 1) * 5000;
        await new Promise((r) => setTimeout(r, backoffMs));
        return executeEnrichWithLLM(input, retryCount + 1);
      }
      return null;
    }

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    return JSON.parse(text) as Patch;
  } catch (err: any) {
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
