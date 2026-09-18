import {createHash} from 'node:crypto';
/** Model transport is injectable: extraction/narration do not depend on one vendor. */
export interface JsonModel {
  readonly id: string;
  readonly version: string;
  readonly schemaFormat?: 'openapi' | 'json-schema';
  generate(instruction: string, input: unknown, responseSchema?: Record<string, unknown>): Promise<unknown>;
}

export class GeminiJsonModel implements JsonModel {
  readonly id = 'vertex-gemini';
  readonly version: string;
  readonly schemaFormat: 'openapi' | 'json-schema';
  readonly configurationFingerprint: string;
  constructor(private projectId: string, private token: () => Promise<string>, private request: typeof fetch = fetch,
    private options: { model?: string; maxOutputTokens?: number; temperature?: number; timeoutMs?: number; thinkingLevel?: 'LOW'|'MEDIUM'|'HIGH'; location?: 'us-central1'|'global'; schemaFormat?: 'openapi'|'json-schema' } = {}) {
    this.version = options.model ?? 'gemini-2.5-flash';
    this.schemaFormat = options.schemaFormat ?? 'openapi';
    this.configurationFingerprint=createHash('sha256').update(JSON.stringify({projectId,model:this.version,
      location:options.location??'us-central1',schemaFormat:this.schemaFormat,maxOutputTokens:options.maxOutputTokens??8192,
      temperature:options.temperature??0,thinkingLevel:options.thinkingLevel??'MEDIUM'})).digest('hex');
    if (!/^[a-z0-9.-]+$/.test(this.version)) throw new Error('Valid Vertex model identifier required');
    if (!/^[a-z][a-z0-9-]+$/.test(projectId)) throw new Error('Explicit Google Cloud project required');
  }
  async generate(instruction: string, input: unknown, responseSchema?: Record<string, unknown>): Promise<unknown> {
    const location=this.options.location ?? 'us-central1';
    const host=location==='global'?'aiplatform.googleapis.com':`${location}-aiplatform.googleapis.com`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await this.request(`https://${host}/v1/projects/${this.projectId}/locations/${location}/publishers/google/models/${this.version}:generateContent`, {
      method: 'POST', signal: AbortSignal.timeout(this.options.timeoutMs ?? 90000),
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemInstruction: {parts:[{text:instruction}]}, contents:[{role:'user',parts:[{text:JSON.stringify(input)}]}], generationConfig:{...(this.version.startsWith('gemini-3') ? {} : {temperature:this.options.temperature ?? 0}),responseMimeType:'application/json',...(responseSchema ? {[this.schemaFormat==='json-schema'?'responseJsonSchema':'responseSchema']:responseSchema} : {}),maxOutputTokens:this.options.maxOutputTokens ?? 8192,...(this.version.startsWith('gemini-3') ? {thinkingConfig:{thinkingLevel:this.options.thinkingLevel ?? 'MEDIUM'}} : {thinkingConfig:{thinkingBudget:0}})} }),
      });
      // Do not include credential-bearing request details or provider bodies in logs.
      if (response.status === 429 && attempt < 2) {
        const header=response.headers.get('retry-after');
        const seconds=header!==null&&header.trim()!==''?Number(header):NaN;
        const delay=Number.isFinite(seconds)&&seconds>=0?seconds*1000:header?Date.parse(header)-Date.now():NaN;
        // Long quota windows belong to the durable worker pause, not this request.
        if(Number.isFinite(delay)&&delay>30_000)throw new Error('Model provider HTTP 429');
        await new Promise(resolve => setTimeout(resolve, Number.isFinite(delay)&&delay>0?delay:1500*(attempt+1)));
        continue;
      }
      if (!response.ok) throw new Error(`Model provider HTTP ${response.status}`);
      const payload = await response.json() as { candidates?:Array<{ finishReason?:string; content?:{parts?:Array<{text?:string;thought?:boolean}>} }> };
      const candidate = payload.candidates?.[0];
      if (candidate?.finishReason !== 'STOP') throw new Error(`Model output incomplete: ${candidate?.finishReason ?? 'EMPTY'}`);
      return JSON.parse(candidate.content?.parts?.filter(p=>!p.thought).map(p=>p.text ?? '').join('') ?? '');
    }
    throw new Error('Model provider rate limit persisted after three attempts');
  }
}
