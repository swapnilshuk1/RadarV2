/** Model transport is injectable: extraction/narration do not depend on one vendor. */
export interface JsonModel {
  readonly id: string;
  readonly version: string;
  generate(instruction: string, input: unknown, responseSchema?: Record<string, unknown>): Promise<unknown>;
}

export class GeminiJsonModel implements JsonModel {
  readonly id = 'vertex-gemini';
  readonly version: string;
  constructor(private projectId: string, private token: () => Promise<string>, private request: typeof fetch = fetch,
    private options: { model?: string; maxOutputTokens?: number; temperature?: number; timeoutMs?: number; thinkingLevel?: 'LOW'|'MEDIUM'|'HIGH' } = {}) {
    this.version = options.model ?? 'gemini-2.5-flash';
    if (!/^[a-z0-9.-]+$/.test(this.version)) throw new Error('Valid Vertex model identifier required');
    if (!/^[a-z][a-z0-9-]+$/.test(projectId)) throw new Error('Explicit Google Cloud project required');
  }
  async generate(instruction: string, input: unknown, responseSchema?: Record<string, unknown>): Promise<unknown> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await this.request(`https://us-central1-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/us-central1/publishers/google/models/${this.version}:generateContent`, {
      method: 'POST', signal: AbortSignal.timeout(this.options.timeoutMs ?? 90000),
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemInstruction: {parts:[{text:instruction}]}, contents:[{role:'user',parts:[{text:JSON.stringify(input)}]}], generationConfig:{...(this.version.startsWith('gemini-3') ? {} : {temperature:this.options.temperature ?? 0}),responseMimeType:'application/json',...(responseSchema ? {responseSchema} : {}),maxOutputTokens:this.options.maxOutputTokens ?? 8192,...(this.version.startsWith('gemini-3') ? {thinkingConfig:{thinkingLevel:this.options.thinkingLevel ?? 'MEDIUM'}} : {thinkingConfig:{thinkingBudget:0}})} }),
      });
      // Do not include credential-bearing request details or provider bodies in logs.
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await new Promise(resolve => setTimeout(resolve, Number.isFinite(retryAfter) ? retryAfter * 1000 : 1500 * (attempt + 1)));
        continue;
      }
      if (!response.ok) throw new Error(`Model provider HTTP ${response.status}`);
      const payload = await response.json() as { candidates?:Array<{ finishReason?:string; content?:{parts?:Array<{text?:string}>} }> };
      const candidate = payload.candidates?.[0];
      if (candidate?.finishReason !== 'STOP') throw new Error(`Model output incomplete: ${candidate?.finishReason ?? 'EMPTY'}`);
      return JSON.parse(candidate.content?.parts?.map(p=>p.text ?? '').join('') ?? '');
    }
    throw new Error('Model provider rate limit persisted after three attempts');
  }
}
