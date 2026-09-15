import { describe, expect, it } from 'vitest';
import { BedrockConverseJsonModel } from '../../src/lib/model/bedrock-converse-model';

const response = (content: unknown, status = 200) => new Response(JSON.stringify({
  output: { message: { content: [{ text: JSON.stringify(content) }] } },
  usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
}), { status, headers: { 'content-type': 'application/json' } });

describe('Bedrock Converse JSON transport', () => {
  it('sends the common structured request without putting a credential in its body', async () => {
    let url = ''; let init: RequestInit | undefined;
    const request: typeof fetch = async (requestUrl, requestInit) => { url = String(requestUrl); init = requestInit; return response({ ok: true }); };
    const model = new BedrockConverseJsonModel('model-id', async () => 'secret-value', request);

    await expect(model.generate('Instruction', { frozen: true })).resolves.toEqual({ ok: true });
    expect(url).toBe('https://bedrock-runtime.us-east-1.amazonaws.com/model/model-id/converse');
    expect(init?.headers).toMatchObject({ 'x-api-key': 'secret-value', 'Content-Type': 'application/json' });
    const body = JSON.parse(String(init?.body));
    expect(body.system).toEqual([{ text: 'Instruction' }]);
    expect(body.messages[0].content[0].text).toBe(JSON.stringify({ frozen: true }));
    expect(body.outputConfig).toBeUndefined();
    expect(String(init?.body)).not.toContain('secret-value');
    expect(model.lastUsage).toEqual({ inputTokens: 11, outputTokens: 7, totalTokens: 18 });
  });

  it('retries an identical structured request only after a transient provider response', async () => {
    const bodies: string[] = []; let calls = 0;
    const request: typeof fetch = async (_url, init) => { calls += 1; bodies.push(String(init?.body)); return calls === 1 ? new Response('', { status: 503 }) : response({ ok: true }); };
    const model = new BedrockConverseJsonModel('model-id', async () => 'secret-value', request);

    await expect(model.generate('Instruction', { stable: true })).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(bodies).toEqual([bodies[0], bodies[0]]);
  });

  it('preserves ordinary provider status without leaking credential or response body', async () => {
    const request: typeof fetch = async () => new Response('private provider body', { status: 403 });
    const model = new BedrockConverseJsonModel('model-id', async () => 'secret-value', request);
    await expect(model.generate('Instruction', {})).rejects.toThrow('Bedrock provider HTTP 403');
    await expect(model.generate('Instruction', {})).rejects.not.toThrow(/secret-value|private provider body/);
  });
});
