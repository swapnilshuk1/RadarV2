/** Model transport is injectable: extraction/narration do not depend on one vendor. */
export interface JsonModel {
  readonly id: string;
  readonly version: string;
  generate(instruction: string, input: unknown): Promise<unknown>;
}

export class GeminiJsonModel implements JsonModel {
  readonly id = 'vertex-gemini';
  readonly version = 'gemini-2.5-flash';
  constructor(private projectId: string, private token: () => Promise<string>, private request: typeof fetch = fetch) {
    if (!/^[a-z][a-z0-9-]+$/.test(projectId)) throw new Error('Explicit Google Cloud project required');
  }
  async generate(instruction: string, input: unknown): Promise<unknown> {
    const response = await this.request(`https://us-central1-aiplatform.googleapis.com/v1/projects/${this.projectId}/locations/us-central1/publishers/google/models/${this.version}:generateContent`, {
      method: 'POST', signal: AbortSignal.timeout(90000),
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemInstruction: {parts:[{text:instruction}]}, contents:[{role:'user',parts:[{text:JSON.stringify(input)}]}], generationConfig:{temperature:0,responseMimeType:'application/json',maxOutputTokens:8192,thinkingConfig:{thinkingBudget:0}} }),
    });
    // Do not include credential-bearing request details or provider bodies in logs.
    if (!response.ok) throw new Error(`Model provider HTTP ${response.status}`);
    const payload = await response.json() as { candidates?:Array<{ finishReason?:string; content?:{parts?:Array<{text?:string}>} }> };
    const candidate = payload.candidates?.[0];
    if (candidate?.finishReason !== 'STOP') throw new Error(`Model output incomplete: ${candidate?.finishReason ?? 'EMPTY'}`);
    return JSON.parse(candidate.content?.parts?.map(p=>p.text ?? '').join('') ?? '');
  }
}
