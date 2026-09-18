import {createHash} from 'node:crypto';
import type { JsonModel } from './json-model';
import { ModelProviderUnavailableError,providerRetryAfterMs } from './provider-unavailable';

type BedrockUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };

/** Bedrock Runtime Converse transport shared by model-comparison callers. */
export class BedrockConverseJsonModel implements JsonModel {
  readonly id = 'bedrock-converse';
  readonly version: string;
  readonly configurationFingerprint: string;
  lastUsage: BedrockUsage | undefined;

  constructor(
    model: string,
    private apiKey: () => Promise<string>,
    private request: typeof fetch = fetch,
    private options: { region?: string; timeoutMs?: number; maxOutputTokens?: number } = {},
  ) { this.version = model; this.configurationFingerprint=createHash('sha256').update(JSON.stringify({model,region:options.region??'us-east-1',maxOutputTokens:options.maxOutputTokens??12288})).digest('hex'); }

  async generate(instruction: string, input: unknown, responseSchema?: Record<string, unknown>): Promise<unknown> {
    const requestBody = JSON.stringify({
      system: [{ text: instruction }],
      messages: [{ role: 'user', content: [{ text: JSON.stringify(input) }] }],
      inferenceConfig: { maxTokens: this.options.maxOutputTokens ?? 12288 },
      ...(responseSchema ? { outputConfig: { textFormat: { type: 'json_schema', structure: { jsonSchema: { name: 'radar_research', description: 'RADAR Research contract', schema: JSON.stringify(responseSchema) } } } } } : {}),
    });
    const url = `https://bedrock-runtime.${this.options.region ?? 'us-east-1'}.amazonaws.com/model/${encodeURIComponent(this.version)}/converse`;
    let failure: unknown;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.request(url, {
          method: 'POST',
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 240000),
          headers: { Authorization: `Bearer ${await this.apiKey()}`, 'Content-Type': 'application/json' },
          body: requestBody,
        });
        if (response.status === 429 || response.status >= 500) {
          const delay = await providerRetryAfterMs(response);
          failure = new ModelProviderUnavailableError(response.status >= 500 ? 'Bedrock provider HTTP 5xx' : 'Bedrock provider HTTP 429', response.status,delay);
          if(delay !== undefined)throw failure;
          continue;
        }
        if (response.status === 401 || response.status === 403) throw new ModelProviderUnavailableError(`Bedrock provider HTTP ${response.status}`, response.status);
        if (!response.ok) throw new Error(`Bedrock provider HTTP ${response.status}`);
        const payload = await response.json() as { output?: { message?: { content?: Array<{ text?: string }> } }; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } };
        const content = payload.output?.message?.content?.map(block => block.text ?? '').join('');
        if (!content) throw new Error('Bedrock provider returned no JSON content');
        this.lastUsage = payload.usage;
        try { return JSON.parse(content); } catch { throw new Error('Bedrock provider returned invalid JSON'); }
      } catch (error) {
        if (error instanceof ModelProviderUnavailableError) throw error;
        failure = error;
        const message = error instanceof Error ? error.message : '';
        if (/^Bedrock provider /.test(message)) throw error;
        if (attempt === 2 || !/(abort|timeout|fetch|transport)/i.test(message)) {
          throw new ModelProviderUnavailableError(/abort|timeout/i.test(message) ? 'Bedrock timeout failure' : 'Bedrock network failure',undefined,30_000);
        }
      }
    }
    throw failure instanceof Error ? failure : new Error('Bedrock transport failed');
  }
}
