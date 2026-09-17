import { describe, expect, it } from 'vitest';
import { BedrockMiniMaxJsonModel } from '../../src/lib/model/bedrock-minimax-model';

const successfulResponse = (content: unknown) => new Response(JSON.stringify({
  choices: [{ message: { content: JSON.stringify(content) } }],
}), { status: 200, headers: { 'content-type': 'application/json' } });

describe('Bedrock MiniMax JSON transport', () => {
  it('sends the OpenAI-compatible JSON-object request without exposing its bearer token', async () => {
    const requests: RequestInit[] = [];
    const request: typeof fetch = async (_url, init) => {
      requests.push(init!);
      return successfulResponse({ ok: true });
    };
    const model = new BedrockMiniMaxJsonModel(async () => 'secret-value', request, { endpointType: 'bedrock-mantle' });

    await expect(model.generate('System instruction', { field: 'value' })).resolves.toEqual({ ok: true });

    expect(requests).toHaveLength(1);
    expect(requests[0].headers).toMatchObject({ 'Content-Type': 'application/json', Authorization: 'Bearer secret-value' });
    expect(JSON.parse(String(requests[0].body))).toMatchObject({
      model: 'minimax.minimax-m2.5',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'System instruction' },
        { role: 'user', content: JSON.stringify({ field: 'value' }) },
      ],
    });
  });

  it('retries the identical request after a transient provider status', async () => {
    const bodies: string[] = [];
    let calls = 0;
    const request: typeof fetch = async (_url, init) => {
      calls += 1;
      bodies.push(String(init?.body));
      return calls === 1 ? new Response('', { status: 429 }) : successfulResponse({ accepted: true });
    };
    const model = new BedrockMiniMaxJsonModel(async () => 'secret-value', request);

    await expect(model.generate('Instruction', { stable: true })).resolves.toEqual({ accepted: true });

    expect(calls).toBe(2);
    expect(bodies).toEqual([bodies[0], bodies[0]]);
  });

  it('surfaces ordinary provider statuses without leaking credentials or response bodies', async () => {
    const request: typeof fetch = async () => new Response('credential-bearing provider body', { status: 401 });
    const model = new BedrockMiniMaxJsonModel(async () => 'secret-value', request);

    await expect(model.generate('Instruction', {})).rejects.toThrow('Bedrock provider HTTP 401');
    await expect(model.generate('Instruction', {})).rejects.not.toThrow(/secret-value|credential-bearing provider body/);
  });
});
