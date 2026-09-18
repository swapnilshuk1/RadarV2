import { adcTokenProvider } from './google-adc';
import { GeminiJsonModel } from './json-model';
import { ModelProviderUnavailableError } from './provider-unavailable';

/** Explicit independent dossier reviewer; never substitutes for the staged evaluator. */
export function createGeminiFactualReviewModel(options:{projectId?:string;token?:()=>Promise<string>;request?:typeof fetch}={}) {
  const projectId=(options.projectId??process.env.GCP_PROJECT_ID)?.trim();
  if(!projectId)throw new ModelProviderUnavailableError('GEMINI_REVIEW_PROJECT_UNCONFIGURED');
  const model=new GeminiJsonModel(projectId,options.token??adcTokenProvider(),options.request??fetch,{
    model:'gemini-3.8-flash',location:'global',schemaFormat:'json-schema',
    thinkingLevel:'MEDIUM',maxOutputTokens:16384,timeoutMs:120000,
  });
  const generate=model.generate.bind(model);
  model.generate=async(instruction,input,schema)=>{
    try{return await generate(instruction,input,schema);}
    catch(error){
      // Infrastructure failures must pause durable work, not consume semantic repair attempts.
      if(error instanceof SyntaxError || (error instanceof Error && error.message.startsWith('Model output incomplete:')))throw new ModelProviderUnavailableError('GEMINI_REVIEW_OUTPUT_INCOMPLETE: no factual assessment was accepted',undefined,30_000);
      const httpStatus=error instanceof Error?Number(error.message.match(/HTTP (\d{3})/)?.[1])||undefined:undefined;
      const reason=error instanceof Error&&/ADC|credential/i.test(error.message)?'AUTH':error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'TIMEOUT':error instanceof Error&&error.message==='fetch failed'?'NETWORK':'REQUEST';
      throw new ModelProviderUnavailableError(`GEMINI_REVIEW_PROVIDER_UNAVAILABLE: ${reason}${httpStatus?` (HTTP ${httpStatus})`:''}; verify ADC, project, model access and quota`,httpStatus,error instanceof ModelProviderUnavailableError?error.retryAfterMs:['TIMEOUT','NETWORK'].includes(reason)?30_000:undefined);
    }
  };
  return model;
}
