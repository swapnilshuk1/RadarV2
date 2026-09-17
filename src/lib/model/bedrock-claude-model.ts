import type { JsonModel } from './json-model';

type ClaudeUsage = { inputTokens?: number; outputTokens?: number };

export class BedrockClaudeJsonModel implements JsonModel {
  readonly id = 'bedrock-claude';
  readonly version: string;
  lastUsage: ClaudeUsage | undefined;

  constructor(
    private apiKey: () => Promise<string>,
    private request: typeof fetch = fetch,
    private options: { model?: string; region?: string; timeoutMs?: number; maxOutputTokens?: number } = {},
  ) {
    this.version = options.model ?? 'anthropic.claude-sonnet-4-6-v1';
  }

  async generate(instruction: string, input: unknown, _responseSchema?: Record<string, unknown>): Promise<unknown> {
    const requestBody = JSON.stringify({
      model: this.version,
      max_tokens: this.options.maxOutputTokens ?? 12288,
      system: instruction,
      messages: [{ role: 'user', content: JSON.stringify(input) }],
    });
    const url = `https://bedrock-mantle.${this.options.region ?? 'us-east-1'}.api.aws/anthropic/v1/messages`;
    let failure: unknown;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.request(url, {
          method: 'POST',
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 120000),
          headers: {
            'x-api-key': await this.apiKey(),
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: requestBody,
        });
        if (response.status === 429 || response.status >= 500) {
          failure = new Error(response.status >= 500 ? 'Bedrock provider HTTP 5xx' : 'Bedrock provider HTTP 429');
          continue;
        }
        if (!response.ok) throw new Error(`Bedrock provider HTTP ${response.status}`);

        const payload = await response.json() as { content?: Array<{ type?: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
        const content = payload.content?.filter(block => block.type === 'text').map(block => block.text ?? '').join('');
        if (!content) throw new Error('Bedrock provider returned no JSON content');
        this.lastUsage = { inputTokens: payload.usage?.input_tokens, outputTokens: payload.usage?.output_tokens };
        try {
          return JSON.parse(content);
        } catch {
          throw new Error('Bedrock provider returned invalid JSON');
        }
      } catch (error) {
        failure = error;
        const message = error instanceof Error ? error.message : '';
        if (/^Bedrock provider /.test(message)) throw error;
        if (attempt === 2 || !/(abort|timeout|fetch|transport)/i.test(message)) {
          throw new Error(/abort|timeout/i.test(message) ? 'Bedrock timeout failure' : 'Bedrock network failure');
        }
      }
    }

    throw failure instanceof Error ? failure : new Error('Bedrock transport failed');
  }
}
