import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  toStrictStructuredOutputTransportRequest,
  type LlmStructuredExtractionClient,
  type LlmStructuredRequest,
  type LlmStructuredResponse,
} from "../../src/lib/intelligence/extraction/LlmExperimentalExtractionProvider";

export const GEMINI_ADC_TRANSPORT_VERSION = "gate1b-batch04/gemini-adc-transport-v1";

export interface GeminiTransportAttempt {
  readonly attemptId: string;
  readonly requestIdentity: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly status: number | null;
  readonly transportRetry: number;
  readonly rawResponseText?: string;
  readonly error?: string;
}

export interface GeminiAdcTransportOptions {
  readonly projectId: string;
  readonly location: string;
  readonly timeoutMs: number;
  readonly maxTransportRetries: number;
  readonly minimumIntervalMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly tokenProvider?: () => Promise<string>;
}

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function adcCredentialPaths(): string[] {
  return [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    process.platform === "win32" ? path.join(process.env.APPDATA ?? "", "gcloud", "application_default_credentials.json") : path.join(process.env.HOME ?? "", ".config", "gcloud", "application_default_credentials.json"),
    process.platform === "win32" ? path.join(process.env.LOCALAPPDATA ?? "", "gcloud", "application_default_credentials.json") : "",
  ].filter((candidate): candidate is string => Boolean(candidate));
}

async function defaultAdcToken(): Promise<string> {
  for (const candidate of adcCredentialPaths()) {
    if (!fs.existsSync(candidate)) continue;
    const credential = JSON.parse(fs.readFileSync(candidate, "utf8")) as { client_id?: string; client_secret?: string; refresh_token?: string };
    if (!credential.client_id || !credential.client_secret || !credential.refresh_token) continue;
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...credential, grant_type: "refresh_token" }),
    });
    const payload = await response.json() as { access_token?: string };
    if (response.ok && payload.access_token) return payload.access_token;
  }
  try {
    const executable = process.platform === "win32" ? "gcloud.cmd" : "gcloud";
    const token = execFileSync(executable, ["auth", "application-default", "print-access-token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (token) return token;
  } catch { /* fall through to a non-secret actionable error */ }
  throw new Error("Gemini ADC is unavailable. Supply Google Application Default Credentials or GOOGLE_APPLICATION_CREDENTIALS.");
}

/** Batch-04-only adapter. It preserves Batch 03's transport-neutral request and never joins production wiring. */
export class GeminiAdcStructuredExtractionClient implements LlmStructuredExtractionClient {
  readonly attempts: GeminiTransportAttempt[] = [];
  private readonly fetchImpl: typeof fetch;
  private readonly tokenProvider: () => Promise<string>;
  private lastStartedAt = 0;

  constructor(private readonly options: GeminiAdcTransportOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.tokenProvider = options.tokenProvider ?? defaultAdcToken;
  }

  async generate(request: LlmStructuredRequest): Promise<LlmStructuredResponse> {
    const wait = this.lastStartedAt + (this.options.minimumIntervalMs ?? 4_200) - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastStartedAt = Date.now();
    const mapped = toStrictStructuredOutputTransportRequest(request);
    const endpoint = `https://${this.options.location}-aiplatform.googleapis.com/v1/projects/${this.options.projectId}/locations/${this.options.location}/publishers/google/models/${encodeURIComponent(request.model)}:generateContent`;
    const requestIdentity = crypto.createHash("sha256").update(`${mapped.metadata.cacheKey}\n${request.model}\n${GEMINI_ADC_TRANSPORT_VERSION}`).digest("hex");
    let finalError: Error | undefined;
    for (let retry = 0; retry <= this.options.maxTransportRetries; retry += 1) {
      const startedAt = new Date().toISOString();
      let recorded = false;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        const token = await this.tokenProvider();
        const response = await this.fetchImpl(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: mapped.input }] }],
            generationConfig: {
              responseMimeType: "application/json",
              responseJsonSchema: mapped.text.format.schema,
              ...mapped.generationParameters,
            },
          }),
        });
        const rawResponseText = await response.text();
        this.attempts.push({ attemptId: `${requestIdentity}:${retry}`, requestIdentity, startedAt, endedAt: new Date().toISOString(), status: response.status, transportRetry: retry, rawResponseText });
        recorded = true;
        if (!response.ok) {
          finalError = new Error(`Gemini Vertex request failed with HTTP ${response.status}.`);
          if ((response.status === 429 || response.status >= 500) && retry < this.options.maxTransportRetries) { await sleep(1_000 * (retry + 1)); continue; }
          throw finalError;
        }
        const payload = JSON.parse(rawResponseText) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } };
        const outputText = payload.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!outputText) throw new Error("Gemini Vertex response contained no structured text candidate.");
        return {
          outputText,
          responseId: requestIdentity,
          model: request.model,
          usage: { inputTokens: payload.usageMetadata?.promptTokenCount, outputTokens: payload.usageMetadata?.candidatesTokenCount, totalTokens: payload.usageMetadata?.totalTokenCount },
        };
      } catch (error) {
        clearTimeout(timer);
        if (error instanceof Error && finalError === undefined) finalError = error;
        if (!recorded) this.attempts.push({ attemptId: `${requestIdentity}:${retry}`, requestIdentity, startedAt, endedAt: new Date().toISOString(), status: null, transportRetry: retry, error: error instanceof Error ? error.message : String(error) });
        if (retry < this.options.maxTransportRetries) { await sleep(1_000 * (retry + 1)); continue; }
      } finally { clearTimeout(timer); }
    }
    throw finalError ?? new Error("Gemini Vertex request failed without an error detail.");
  }
}
