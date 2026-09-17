import { describe, expect, it } from 'vitest';
import { BedrockClaudeJsonModel } from '../../src/lib/model/bedrock-claude-model';

const response = (content: unknown, status = 200) => new Response(JSON.stringify({
  content: [{ type: 'text', text: JSON.stringify(content) }],
  usage: { input_tokens: 12, output_tokens: 8 },
}), { status, headers: { 'content-type': 'application/json' } });

describe('Bedrock Mantle Anthropic JSON transport', () => {
  it('maps system and JSON input to the Messages API without exposing the credential in the payload', async () => {
    let url = '';
    let init: RequestInit | undefined;
    const request: typeof fetch = async (requestUrl, requestInit) => {
      url = String(requestUrl);
      init = requestInit;
      return response({ accepted: true });
    };
    const model = new BedrockClaudeJsonModel(async () => 'secret-value', request);

    await expect(model.generate('RADAR instruction', { frozen: true })).resolves.toEqual({ accepted: true });

    expect(url).toBe('https://bedrock-mantle.us-east-1.api.aws/anthropic/v1/messages');
    expect(init?.headers).toMatchObject({ 'x-api-key': 'secret-value', 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'anthropic.claude-sonnet-4-6-v1',
      system: 'RADAR instruction',
      messages: [{ role: 'user', content: JSON.stringify({ frozen: true }) }],
    });
    expect(String(init?.body)).not.toContain('secret-value');
    expect(model.lastUsage).toEqual({ inputTokens: 12, outputTokens: 8 });
  });

  it('retries the identical request after a transient provider response', async () => {
    const bodies: string[] = [];
    let calls = 0;
    const request: typeof fetch = async (_url, init) => {
      calls += 1;
      bodies.push(String(init?.body));
      return calls === 1 ? new Response('', { status: 429 }) : response({ ok: true });
    };
    const model = new BedrockClaudeJsonModel(async () => 'secret-value', request);

    await expect(model.generate('Instruction', { stable: true })).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(bodies).toEqual([bodies[0], bodies[0]]);
  });

  it('retains ordinary provider status without response-body or credential leakage', async () => {
    const request: typeof fetch = async () => new Response('provider body must stay private', { status: 403 });
    const model = new BedrockClaudeJsonModel(async () => 'secret-value', request);

    await expect(model.generate('Instruction', {})).rejects.toThrow('Bedrock provider HTTP 403');
    await expect(model.generate('Instruction', {})).rejects.not.toThrow(/secret-value|provider body must stay private/);
  });
});
