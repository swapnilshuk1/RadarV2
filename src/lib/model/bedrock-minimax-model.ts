import type { JsonModel } from './json-model';
export class BedrockMiniMaxJsonModel implements JsonModel {
  readonly id='bedrock-minimax'; readonly version='minimax.minimax-m2.5'; readonly endpointType='bedrock-runtime';
  constructor(private apiKey:()=>Promise<string>, private request:typeof fetch=fetch, private options:{region?:string;timeoutMs?:number;maxOutputTokens?:number}={}){}
  async generate(instruction:string,input:unknown,responseSchema?:Record<string,unknown>):Promise<unknown>{
    const body={model:this.version,messages:[{role:'system',content:instruction},{role:'user',content:JSON.stringify(input)}],max_tokens:this.options.maxOutputTokens??8192,response_format:responseSchema?{type:'json_schema',json_schema:{name:'radar_research',strict:true,schema:responseSchema}}:{type:'json_object'}};
    let failure:unknown;
    for(let attempt=0;attempt<3;attempt++){try{const response=await this.request(`https://bedrock-runtime.${this.options.region??'us-east-1'}.amazonaws.com/openai/v1/chat/completions`,{method:'POST',signal:AbortSignal.timeout(this.options.timeoutMs??120000),headers:{Authorization:`Bearer ${await this.apiKey()}`,'Content-Type':'application/json'},body:JSON.stringify(body)});if(response.status===429||response.status>=500){failure=new Error(`Bedrock transport HTTP ${response.status}`);continue}if(!response.ok)throw new Error(`Bedrock provider HTTP ${response.status}`);const payload=await response.json() as any;const content=payload.choices?.[0]?.message?.content;if(typeof content!=='string')throw new Error('Bedrock provider returned no JSON content');return JSON.parse(content)}catch(error){failure=error;const message=error instanceof Error?error.message:'';if(attempt===2||!/(abort|timeout|fetch|transport)/i.test(message))throw new Error('Bedrock transport request failed')}}
    throw failure instanceof Error?failure:new Error('Bedrock transport failed');
  }
}