import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import type { EnrichInput, EnrichPatch } from "./contract";
import { CANDIDATE_PROFILE_JSON } from "../config";
import { StartRateScheduler } from "./start-rate-scheduler";

// Returned patches are Inferred, not Explicit — the LLM never gets to claim
// verbatim evidence. That contract is enforced in extractor.ts.
type Patch = EnrichPatch;

function emit(input: EnrichInput, type: string, details: Record<string, unknown>) {
  // Diagnostics must not affect enrichment control flow or provider timing.
  void Promise.resolve(input.telemetry?.(type, { atMs: Date.now(), ...details })).catch(
    () => undefined,
  );
}

let profileCache: string | null = null;
function loadProfile(): string {
  if (profileCache !== null) return profileCache;
  try {
    profileCache = fs.readFileSync(CANDIDATE_PROFILE_JSON, "utf-8");
  } catch {
    profileCache = "{}";
  }
  return profileCache;
}

// Cache the access token and its expiry to avoid spawning gcloud on every single request
let adcTokenCache: { token: string; expiresAt: number } | null = null;

async function getADCToken(): Promise<string | null> {
  try {
    if (adcTokenCache && Date.now() < adcTokenCache.expiresAt) {
      return adcTokenCache.token;
    }

    // 1. Direct standard ADC credentials file read
    const candidatePaths = [
      process.env.GOOGLE_APPLICATION_CREDENTIALS,
      process.platform === "win32"
        ? path.join(process.env.APPDATA || "", "gcloud", "application_default_credentials.json")
        : path.join(
            process.env.HOME || "",
            ".config",
            "gcloud",
            "application_default_credentials.json",
          ),
      process.platform === "win32"
        ? path.join(
            process.env.LOCALAPPDATA || "",
            "gcloud",
            "application_default_credentials.json",
          )
        : "",
    ].filter(Boolean) as string[];

    for (const credPath of candidatePaths) {
      if (fs.existsSync(credPath)) {
        try {
          const creds = JSON.parse(fs.readFileSync(credPath, "utf-8"));
          if (creds.client_id && creds.client_secret && creds.refresh_token) {
            const res = await fetch("https://oauth2.googleapis.com/token", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                client_id: creds.client_id,
                client_secret: creds.client_secret,
                refresh_token: creds.refresh_token,
                grant_type: "refresh_token",
              }),
            });
            if (res.ok) {
              const data = (await res.json()) as { access_token?: string; expires_in?: number };
              if (data.access_token) {
                const ttl = ((data.expires_in || 3600) - 300) * 1000;
                adcTokenCache = {
                  token: data.access_token,
                  expiresAt: Date.now() + Math.max(ttl, 60000),
                };
                return data.access_token;
              }
            }
          }
        } catch {}
      }
    }

    // 2. Fallback to gcloud CLI
    let cmd = "gcloud";

    if (process.platform === "win32") {
      const commonPaths = [
        "C:\\Program Files (x86)\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd",
        path.join(
          process.env.USERPROFILE || "",
          "AppData\\Local\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd",
        ),
        path.join(
          process.env.USERPROFILE || "",
          "Downloads\\google-cloud-cli-windows-x86_64\\google-cloud-sdk\\bin\\gcloud.cmd",
        ),
        "C:\\Program Files\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd",
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
    console.warn(`[enrich:gemini] Failed to get ADC token: ${err.message}`);
  }
  return null;
}

const MIN_START_INTERVAL_MS = Number(process.env.GEMINI_MIN_START_INTERVAL_MS ?? "4200");
const MAX_IN_FLIGHT = Number(process.env.GEMINI_MAX_IN_FLIGHT ?? "2");
const startScheduler = new StartRateScheduler(MIN_START_INTERVAL_MS, MAX_IN_FLIGHT);

export async function enrichWithLLM(input: EnrichInput): Promise<Patch | null> {
  try {
    return await executeEnrichWithLLM(input);
  } catch {
    return null;
  }
}

async function executeEnrichWithLLM(input: EnrichInput, retryCount = 0): Promise<Patch | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let url = "";

  if (apiKey) {
    url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  } else {
    const adcToken = await getADCToken();
    if (!adcToken) {
      return null;
    }
    headers["Authorization"] = `Bearer ${adcToken}`;
    const projectId = process.env.GCP_PROJECT_ID || "project-0e166cfc-e3f5-49d7-af6";
    url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent`;
  }

  const prompt = buildPrompt(input);
  const profileChars = loadProfile().length;
  emit(input, "PROVIDER_REQUEST_PREPARED", {
    provider: "gemini",
    model: "gemini-2.5-flash",
    transport: apiKey ? "gemini-api-key" : "vertex-adc",
    candidateProfileChars: profileChars,
    snippetChars: input.snippet.length,
    detailChars: input.detailText.length,
    detailCharsSent: input.detailText.slice(0, 6000).length,
    promptChars: prompt.length,
    missingDimensionCount: input.missingKeys.length,
    missingDimensions: input.missingKeys,
  });
  try {
    emit(input, "PROVIDER_QUEUE_ENTERED", {
      provider: "gemini",
      model: "gemini-2.5-flash",
      queueMode: "start-rate",
      minStartIntervalMs: MIN_START_INTERVAL_MS,
      maxInFlight: MAX_IN_FLIGHT,
    });
    const lease = await startScheduler.acquire();
    emit(input, "PROVIDER_QUEUE_RELEASED", {
      provider: "gemini",
      model: "gemini-2.5-flash",
      queueMode: "start-rate",
      waitMs: lease.queueWaitMs,
      inFlightAtStart: lease.inFlightAtStart,
    });
    const requestStartedAt = Date.now();
    emit(input, "PROVIDER_HTTP_REQUEST_STARTED", {
      provider: "gemini",
      model: "gemini-2.5-flash",
      transport: apiKey ? "gemini-api-key" : "vertex-adc",
    });
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
        }),
      });
    } finally {
      lease.release();
    }
    emit(input, "PROVIDER_HTTP_RESPONSE_RECEIVED", {
      provider: "gemini",
      model: "gemini-2.5-flash",
      transport: apiKey ? "gemini-api-key" : "vertex-adc",
      status: res.status,
      httpDurationMs: Date.now() - requestStartedAt,
    });

    if (res.status === 429) {
      if (retryCount < 3) {
        const backoffMs = (retryCount + 1) * 5000;
        emit(input, "PROVIDER_RETRY_SCHEDULED", {
          provider: "gemini",
          model: "gemini-2.5-flash",
          status: 429,
          retryAttempt: retryCount + 1,
          backoffMs,
        });
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
    emit(input, "PROVIDER_RESPONSE_PARSED", {
      provider: "gemini",
      model: "gemini-2.5-flash",
      outputChars: text.length,
      promptTokens: data.usageMetadata?.promptTokenCount ?? null,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? null,
      totalTokens: data.usageMetadata?.totalTokenCount ?? null,
    });
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
