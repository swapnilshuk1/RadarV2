import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import type {DatabaseAdapter} from '@/data/database';
import type {AcquisitionAttempt,ContextProvider,EvidenceSource,SliceInput} from '@/dossier/contracts';
import {ModelProviderUnavailableError} from '../../model/provider-unavailable';
import {CONTEXT_ACQUISITION_POLICY as policy} from './contextAcquisitionPolicy';
import {CompanyWebsiteProvider} from '@/dossier/context';

function publicHttps(value:string):URL {
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||isIP(url.hostname)||!url.hostname.includes('.')||url.hostname.endsWith('.localhost')||url.hostname.endsWith('.local'))throw new Error('CONTEXT_PUBLIC_HTTPS_REQUIRED');
  return url;
}
/** Uses verified company identity plus bounded web search; never sends candidate sources. */
export class ProductionContextProvider implements ContextProvider {
  readonly id=policy.version;
  constructor(private readonly db:DatabaseAdapter,private readonly tenantId:string,private readonly request:typeof fetch=fetch,private readonly searchKey=process.env.TAVILY_API_KEY){}
  async acquire(opportunity:SliceInput['opportunity'],fields:readonly string[]){
    if(!this.searchKey?.trim())throw new ModelProviderUnavailableError('CONTEXT_SEARCH_CONFIGURATION_REQUIRED');
    const sources:EvidenceSource[]=[];const attempts:AcquisitionAttempt[]=[];
    const record=(provider:string,operation:'retrieve'|'search',ids:string[],detail:string)=>{
      attempts.push(...fields.map(field=>({provider,field,operation,status:ids.length?'RETRIEVED' as const:provider==='context-web-search'?'NO_RESULTS' as const:'UNAVAILABLE' as const,sourceIds:ids,detail})));
    };
    const name=opportunity.company.trim().toLocaleLowerCase().replace(/\s+/g,' ');
    const entity=await this.db.one<{official_domain:string|null}>(`SELECT official_domain FROM intelligence_company_entities WHERE tenant_id=? AND normalized_name=?`,[this.tenantId,name]);
    if(entity?.official_domain){
      try{
        const url=publicHttps(entity.official_domain.includes('://')?entity.official_domain:`https://${entity.official_domain}`).origin;
        const result=await new CompanyWebsiteProvider([{url,title:`${opportunity.company} — official website`}],this.request).acquire(opportunity,fields);
        sources.push(...result.sources);attempts.push(...result.attempts);
      }catch{record('company-website','retrieve',[],'Verified company website could not be retrieved.');}
    }else record('company-website','retrieve',[],'No verified official domain is bound to this company identity.');
    {
      try{
        // The job title pulls search toward syndicated vacancies rather than company evidence.
        const response=await this.request('https://api.tavily.com/search',{method:'POST',redirect:'error',signal:AbortSignal.timeout(25_000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.searchKey}`},body:JSON.stringify({query:`${opportunity.company} ${policy.querySuffix}`,search_depth:policy.searchDepth,max_results:policy.maxResults,include_raw_content:'text',include_answer:false})});
        if(!response.ok)throw new Error(`CONTEXT_SEARCH_HTTP_${response.status}`);
        const payload=await response.json() as {results?:Array<{url?:string;title?:string;raw_content?:string|null;content?:string}>};
        if(!Array.isArray(payload.results))throw new Error('CONTEXT_SEARCH_RESPONSE_INVALID');
        const found:EvidenceSource[]=[];
        for(const result of Array.isArray(payload.results)?payload.results:[]){
          if(typeof result.url!=='string')continue;
          let url:URL;try{url=publicHttps(result.url);}catch{continue;}
          const content=typeof result.raw_content==='string'?result.raw_content:result.content;
          if(typeof content!=='string'||!content.trim())continue;
          const text=content.trim().slice(0,policy.maxSourceCharacters);
          found.push({id:`context-${createHash('sha256').update(url.href+text).digest('hex').slice(0,16)}`,plane:'CONTEXT',title:result.title||url.hostname,locator:url.href,text,capturedAt:new Date().toISOString(),attribution:'INDEPENDENT'});
        }
        sources.push(...found);record('context-web-search','search',found.map(source=>source.id),'Retrieved web evidence; company identity and relevance must be checked before using its claims. Retrieval does not establish that any requested field is answered.');
      }catch(error){throw new ModelProviderUnavailableError(error instanceof Error&&/^CONTEXT_SEARCH_HTTP_\d+$/.test(error.message)?error.message:'CONTEXT_SEARCH_UNAVAILABLE');}
    }
    return {sources:[...new Map(sources.map(source=>[source.id,source])).values()],attempts};
  }
}
