import { describe, expect, it } from 'vitest';
import { BedrockConverseJsonModel } from '../../src/lib/model/bedrock-converse-model';
import { extractValidatedSourceClaims, EmptySourceEvidenceError } from '../../src/dossier/evidence';
import { bedrockJsonSchema } from '../../src/dossier/bedrock-schema';
import { stagedScreeningAdjudicationSchema } from '../../src/dossier/staged-screening';
import type { ReasoningModel } from '../../src/dossier/contracts';
import { ModelProviderUnavailableError } from '../../src/lib/model/provider-unavailable';
import { BedrockMantleJsonModel } from '../../src/lib/model/bedrock-mantle-model';
import { parseMantleKey } from '../../src/lib/model/bedrock-credentials';
import { createBedrockGlmResearchModel } from '../../src/lib/model/bedrock-glm-research-model';

describe('Bedrock Mantle JSON transport',()=>{
  const reply=(text:string,finish='stop')=>new Response(JSON.stringify({choices:[{finish_reason:finish,message:{content:text}}],usage:{prompt_tokens:13,completion_tokens:2,total_tokens:15}}));
  it('routes the production factory through Mantle with independent checkpoint identity',()=>{
    const model=createBedrockGlmResearchModel();
    expect(model).toBeInstanceOf(BedrockMantleJsonModel);expect(model.version).toBe('zai.glm-5');
    expect(model.configurationFingerprint).not.toBe(new BedrockConverseJsonModel('zai.glm-5',async()=>'key').configurationFingerprint);
  });
  it('loads a raw key or labelled download and rejects ambiguity',()=>{
    const key='fake-test-key-'.repeat(5);
    expect(parseMantleKey(key)).toBe(key);
    expect(parseMantleKey(`Long term API key\n12345678-1234-1234-1234-123456789abc\n${key}\n`)).toBe(key);
    expect(()=>parseMantleKey('No credential here')).toThrow('INVALID');
    expect(()=>parseMantleKey(`${key}\n${key}`)).toThrow('INVALID');
  });
  it('sends native JSON schema and normalizes usage without credentials in the payload',async()=>{
    let body:any;let target='';
    const model=new BedrockMantleJsonModel('zai.glm-5',async()=>'test-secret',async(url,init)=>{
      target=String(url);body=JSON.parse(String(init?.body));
      expect(init?.headers).toMatchObject({Authorization:'Bearer test-secret'});
      expect(init?.body).not.toContain('test-secret');return reply('{"ok":true}');
    });
    const schema=bedrockJsonSchema(stagedScreeningAdjudicationSchema);
    expect(await model.generate('Instruction',{frozen:true},schema)).toEqual({ok:true});
    expect(target).toBe('https://bedrock-mantle.us-east-1.api.aws/v1/chat/completions');
    expect(body).toMatchObject({model:'zai.glm-5',stream:false,max_tokens:12288,response_format:{type:'json_schema',json_schema:{strict:true,schema}}});
    expect(body.messages[1].content).toBe('{"frozen":true}');
    expect(model.lastUsage).toMatchObject({inputTokens:13,outputTokens:2,totalTokens:15});
  });
  it.each([400,401,403,429,503])('defers HTTP %s to the durable scheduler without immediate retries',async(status)=>{
    let calls=0;
    const model=new BedrockMantleJsonModel('zai.glm-5',async()=>'secret',async()=>{calls++;return new Response('private body',{status,headers:{'retry-after':'42'}});});
    const failure=await model.generate('Instruction',{}).catch(e=>e);
    expect(failure).toBeInstanceOf(ModelProviderUnavailableError);expect(failure.httpStatus).toBe(status);
    expect(failure.message).not.toMatch(/secret|private/);expect(calls).toBe(1);
    if(status===429||status===503)expect(failure.retryAfterMs).toBe(42000);
  });
  it.each([['{"ok":true}','length'],['broken','stop'],['','stop']])('rejects incomplete or malformed output even if it parses',async(text,finish)=>{
    const model=new BedrockMantleJsonModel('zai.glm-5',async()=>'secret',async()=>reply(text,finish));
    await expect(model.generate('Instruction',{})).rejects.toBeInstanceOf(ModelProviderUnavailableError);
  });
  it('clears previous usage when the next request fails',async()=>{
    let calls=0;
    const model=new BedrockMantleJsonModel('zai.glm-5',async()=>'secret',async()=>++calls===1?reply('{"ok":true}'):new Response('',{status:429}));
    await model.generate('Instruction',{});expect(model.lastUsage?.totalTokens).toBe(15);
    await expect(model.generate('Instruction',{})).rejects.toThrow();expect(model.lastUsage).toBeUndefined();
  });
});

const response = (content: unknown, status = 200) => new Response(JSON.stringify({
  output: { message: { content: [{ text: JSON.stringify(content) }] } },
  usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
}), { status, headers: { 'content-type': 'application/json' } });

describe('Bedrock Converse JSON transport', () => {
  it('stops source repair immediately on provider access failure', async () => {
    let calls=0;
    const model=new BedrockConverseJsonModel('access-failure-test',async()=>'secret',async()=>{calls++;return new Response('',{status:403});});
    await expect(extractValidatedSourceClaims(model,{id:'provider-failure-jd',plane:'JD',title:'Role',locator:'test',text:'Lead growth.',capturedAt:'2026-01-01T00:00:00.000Z',attribution:'JOB_POST'},'JD-1-')).rejects.toBeInstanceOf(ModelProviderUnavailableError);
    expect(calls).toBe(1);
  });
  it('does not spend semantic repairs on a malformed provider JSON response', async () => {
    let calls=0;
    const model=new BedrockConverseJsonModel('malformed-json-test',async()=>'secret',async()=>{calls++;return new Response(JSON.stringify({output:{message:{content:[{text:'{incomplete'}]}}}));});
    await expect(extractValidatedSourceClaims(model,{id:'invalid-json-jd',plane:'JD',title:'Role',locator:'test',text:'Lead growth.',capturedAt:'2026-01-01T00:00:00.000Z',attribution:'JOB_POST'},'JD-1-')).rejects.toBeInstanceOf(ModelProviderUnavailableError);
    expect(calls).toBe(1);
  });
  it('reports empty source extraction distinctly after bounded local repairs', async () => {
    let attempts=0;
    const model:ReasoningModel={id:'empty-source-test',version:'1',async generate(){attempts++;return {claims:[]};}};
    await expect(extractValidatedSourceClaims(model,{id:'empty-jd',plane:'JD',title:'Captured page',locator:'test',text:'Navigation only',capturedAt:'2026-01-01T00:00:00.000Z',attribution:'JOB_POST'},'JD-1-')).rejects.toBeInstanceOf(EmptySourceEvidenceError);
    expect(attempts).toBe(4);
  });
  it('sends the common structured request without putting a credential in its body', async () => {
    let url = ''; let init: RequestInit | undefined;
    const request: typeof fetch = async (requestUrl, requestInit) => { url = String(requestUrl); init = requestInit; return response({ ok: true }); };
    const model = new BedrockConverseJsonModel('model-id', async () => 'secret-value', request);

    await expect(model.generate('Instruction', { frozen: true })).resolves.toEqual({ ok: true });
    expect(url).toBe('https://bedrock-runtime.us-east-1.amazonaws.com/model/model-id/converse');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret-value', 'Content-Type': 'application/json' });
    expect(init?.headers).not.toHaveProperty('x-api-key');
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

  it('projects source-extraction output through standard Bedrock JSON Schema', async () => {
    let responseSchema: Record<string, unknown> | undefined;
    const model: ReasoningModel = {
      id: 'bedrock-converse', version: 'test',
      async generate(_instruction, _input, schema) {
        responseSchema = schema;
        return {
          claims: [{
            id: 'JD-1-model', text: 'Requires operations experience.', state: 'EXPLICIT', confidence: 1,
            plane: 'JD', citations: [{ sourceId: 'jd', spanId: 's0' }], derivedFrom: [],
          }],
        };
      },
    };

    const claims = await extractValidatedSourceClaims(model, {
      id: 'jd', plane: 'JD', title: 'Role', locator: 'test',
      text: 'Requires operations experience.', capturedAt: '2026-01-01T00:00:00.000Z', attribution: 'JOB_POST',
    }, 'JD-1-');

    expect(claims).toHaveLength(1);
    expect(responseSchema).toMatchObject({ type: 'object' });
    expect(JSON.stringify(responseSchema)).not.toContain('"OBJECT"');
  });

  it('projects the current quote-ID screening schema without historical quote-copying fields', () => {
    const projected = bedrockJsonSchema(stagedScreeningAdjudicationSchema);
    expect(projected).toHaveProperty('type', 'object');
    expect(projected).toHaveProperty('properties');
    const properties = projected.properties as Record<string, any>;
    expect(properties.supportQuoteIds).toMatchObject({type:'array',items:{type:'string'}});
    expect(properties).not.toHaveProperty('basisSupport');
    expect(properties).not.toHaveProperty('exactSourceQuote');
    expect(properties).not.toHaveProperty('screeningGate');
  });
});
