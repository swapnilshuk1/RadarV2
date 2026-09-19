import { createHash } from 'node:crypto';
import type { JsonModel } from './json-model';
import { ModelProviderUnavailableError, providerRetryAfterMs } from './provider-unavailable';

/** Bedrock Mantle Chat Completions adapter. Domain schemas/validators stay authoritative. */
export class BedrockMantleJsonModel implements JsonModel {
  readonly id = 'bedrock-mantle';
  readonly schemaFormat = 'json-schema' as const;
  readonly configurationFingerprint: string;
  lastUsage: { inputTokens?: number; outputTokens?: number; totalTokens?: number; cachedInputTokens?: number; reasoningTokens?: number } | undefined;

  constructor(
    readonly version: string,
    private readonly apiKey: () => Promise<string>,
    private readonly request: typeof fetch = fetch,
    private readonly options: { region?: string; timeoutMs?: number; maxOutputTokens?: number } = {},
  ) {
    this.configurationFingerprint = createHash('sha256').update(JSON.stringify({
      transport: 'bedrock-mantle-chat-v1', model: version, region: options.region ?? 'us-east-1',
      maxOutputTokens: options.maxOutputTokens ?? 12288, structuredOutput: 'json_schema-strict',
    })).digest('hex');
  }

  async generate(instruction: string, input: unknown, responseSchema?: Record<string, unknown>): Promise<unknown> {
    this.lastUsage = undefined;
    try {
      const response = await this.request(`https://bedrock-mantle.${this.options.region ?? 'us-east-1'}.api.aws/v1/chat/completions`, {
        method: 'POST', signal: AbortSignal.timeout(this.options.timeoutMs ?? 240_000),
        headers: { Authorization: `Bearer ${await this.apiKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.version, stream: false,
          messages: [{ role: 'system', content: instruction }, { role: 'user', content: JSON.stringify(input) }],
          max_tokens: this.options.maxOutputTokens ?? 12288,
          response_format: responseSchema
            ? { type: 'json_schema', json_schema: { name: 'radar_research', strict: true, schema: responseSchema } }
            : { type: 'json_object' },
        }),
      });
      if (!response.ok) {
        const retry = response.status === 429 || response.status >= 500 ? await providerRetryAfterMs(response) : undefined;
        throw new ModelProviderUnavailableError(`Bedrock Mantle provider HTTP ${response.status}`, response.status, retry);
      }
      const payload = await response.json() as {
        choices?: Array<{ finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } };
      };
      if (payload.usage) this.lastUsage = {
        inputTokens: payload.usage.prompt_tokens, outputTokens: payload.usage.completion_tokens, totalTokens: payload.usage.total_tokens,
        cachedInputTokens: payload.usage.prompt_tokens_details?.cached_tokens, reasoningTokens: payload.usage.completion_tokens_details?.reasoning_tokens,
      };
      const choice = payload.choices?.[0];
      if (payload.choices?.length !== 1 || choice?.finish_reason !== 'stop' || choice.message?.refusal || typeof choice.message?.content !== 'string' || !choice.message.content.trim()) {
        throw new ModelProviderUnavailableError('Bedrock Mantle output incomplete or refused; no proposal accepted', undefined, 30_000);
      }
      try { return JSON.parse(choice.message.content); }
      catch { throw new ModelProviderUnavailableError('Bedrock Mantle returned invalid JSON; no proposal accepted', undefined, 30_000); }
    } catch (error) {
      if (error instanceof ModelProviderUnavailableError) throw error;
      const credential = error instanceof Error && error.message.startsWith('BEDROCK_MANTLE_');
      throw new ModelProviderUnavailableError(credential ? 'Bedrock Mantle credential unavailable' : 'Bedrock Mantle transport failure', undefined, credential ? undefined : 30_000);
    }
  }
}
