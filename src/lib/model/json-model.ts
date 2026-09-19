import { createHash } from "node:crypto";
import { ModelProviderUnavailableError, providerRetryAfterMs } from "./provider-unavailable";
const providerFailures = new Map<string, number>();
/** Model transport is injectable: extraction/narration do not depend on one vendor. */
export interface JsonModel {
  readonly id: string;
  readonly version: string;
  readonly schemaFormat?: "openapi" | "json-schema";
  generate(
    instruction: string,
    input: unknown,
    responseSchema?: Record<string, unknown>,
  ): Promise<unknown>;
}

export class GeminiJsonModel implements JsonModel {
  readonly id = "vertex-gemini";
  readonly version: string;
  readonly schemaFormat: "openapi" | "json-schema";
  readonly configurationFingerprint: string;
  lastUsage:
    | {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
        totalTokenCount?: number;
        cachedContentTokenCount?: number;
      }
    | undefined;
  constructor(
    private projectId: string,
    private token: () => Promise<string>,
    private request: typeof fetch = fetch,
    private options: {
      model?: string;
      maxOutputTokens?: number;
      temperature?: number;
      timeoutMs?: number;
      thinkingLevel?: "LOW" | "MEDIUM" | "HIGH";
      location?: "us-central1" | "global";
      schemaFormat?: "openapi" | "json-schema";
    } = {},
  ) {
    this.version = options.model ?? "gemini-2.5-flash";
    this.schemaFormat = options.schemaFormat ?? "openapi";
    this.configurationFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          projectId,
          model: this.version,
          location: options.location ?? "us-central1",
          schemaFormat: this.schemaFormat,
          maxOutputTokens: options.maxOutputTokens ?? 8192,
          temperature: options.temperature ?? 0,
          thinkingLevel: options.thinkingLevel ?? "MEDIUM",
        }),
      )
      .digest("hex");
    if (!/^[a-z0-9.-]+$/.test(this.version))
      throw new Error("Valid Vertex model identifier required");
    if (!/^[a-z][a-z0-9-]+$/.test(projectId))
      throw new Error("Explicit Google Cloud project required");
  }
  async generate(
    instruction: string,
    input: unknown,
    responseSchema?: Record<string, unknown>,
  ): Promise<unknown> {
    this.lastUsage = undefined;
    const location = this.options.location ?? "us-central1";
    const host =
      location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;

    const response = await this.request(
      `https://${host}/v1/projects/${this.projectId}/locations/${location}/publishers/google/models/${this.version}:generateContent`,
      {
        method: "POST",
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 90000),
        headers: {
          Authorization: `Bearer ${await this.token()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: instruction }] },
          contents: [{ role: "user", parts: [{ text: JSON.stringify(input) }] }],
          generationConfig: {
            ...(this.version.startsWith("gemini-3")
              ? {}
              : { temperature: this.options.temperature ?? 0 }),
            responseMimeType: "application/json",
            ...(responseSchema
              ? {
                  [this.schemaFormat === "json-schema" ? "responseJsonSchema" : "responseSchema"]:
                    responseSchema,
                }
              : {}),
            maxOutputTokens: this.options.maxOutputTokens ?? 8192,
            ...(this.version.startsWith("gemini-3")
              ? { thinkingConfig: { thinkingLevel: this.options.thinkingLevel ?? "MEDIUM" } }
              : { thinkingConfig: { thinkingBudget: 0 } }),
          },
        }),
      },
    );
    // Do not include credential-bearing request details or provider bodies in logs.
    const delay = !response.ok ? await providerRetryAfterMs(response) : undefined;
    if (!response.ok) {
      const transient = response.status === 429 || response.status >= 500;
      const failures = transient
        ? (providerFailures.get(this.configurationFingerprint) ?? 0) + 1
        : 0;
      if (transient) providerFailures.set(this.configurationFingerprint, failures);
      // One request per attempt. The worker persists this delay and releases its lease.
      const backoff = transient
        ? Math.min(120_000, 30_000 * 2 ** Math.min(failures - 1, 2)) +
          Math.floor(Math.random() * 3000)
        : undefined;
      throw new ModelProviderUnavailableError(
        `Model provider HTTP ${response.status}`,
        response.status,
        delay === undefined ? backoff : Math.max(delay, backoff ?? 0),
      );
    }
    providerFailures.delete(this.configurationFingerprint);
    const payload = (await response.json()) as {
      usageMetadata?: GeminiJsonModel["lastUsage"];
      candidates?: Array<{
        finishReason?: string;
        content?: { parts?: Array<{ text?: string; thought?: boolean }> };
      }>;
    };
    this.lastUsage = payload.usageMetadata;
    const candidate = payload.candidates?.[0];
    if (candidate?.finishReason !== "STOP")
      throw new Error(`Model output incomplete: ${candidate?.finishReason ?? "EMPTY"}`);
    return JSON.parse(
      candidate.content?.parts
        ?.filter((p) => !p.thought)
        .map((p) => p.text ?? "")
        .join("") ?? "",
    );
  }
}
