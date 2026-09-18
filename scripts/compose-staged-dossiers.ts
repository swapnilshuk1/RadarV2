import {selectStagedDossierWork} from '../src/lib/intelligence/staged/dossierBackfillSelection';
import { getDatabaseAdapter } from '../src/data/database';
import { ModelProviderUnavailableError } from '../src/lib/model/provider-unavailable';
import { loadBedrockCredentials } from '../src/lib/model/bedrock-credentials';
import { createBedrockGlmResearchModel } from '../src/lib/model/bedrock-glm-research-model';
import { ProductionStagedDossierService } from '../src/lib/intelligence/staged/ProductionStagedDossierService';
import { RICH_DOSSIER_VERSION } from '../src/data/sqlite/repositories/SqliteRichDossierStore';
import { StagedServingPublisher } from '../src/lib/intelligence/staged/StagedServingPublisher';

const option=(name:string)=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const context=option('context');
if(!context)throw new Error('EXPLICIT_CONTEXT_REQUIRED');
const limit=Number(option('limit')||'1');
const shards=Number(option('shards')||'1'),shard=Number(option('shard')||'0');
if(!Number.isSafeInteger(limit)||limit<1)throw new Error('LIMIT_INVALID');
if(!Number.isSafeInteger(shards)||shards<1||!Number.isSafeInteger(shard)||shard<0||shard>=shards)throw new Error('SHARD_INVALID');
const publishOnly=process.argv.includes('--publish-only');
const publish=publishOnly||process.argv.includes('--publish');
const job=option('job');
if(!publishOnly)loadBedrockCredentials();
const db=getDatabaseAdapter();
const rows=await selectStagedDossierWork(db,{context,limit,shards,shard,job,publish,publishOnly});
const service=publishOnly?null:new ProductionStagedDossierService(db,createBedrockGlmResearchModel());
let failures=0;
for(const row of rows) {
  const identity={tenantId:row.tenant_id,personId:row.person_id,canonicalJobId:row.canonical_job_id,opportunityVersion:row.opportunity_version,evaluationContextFingerprint:context,profileVersion:row.profile_version};
  try {
    if(service){
      console.log(JSON.stringify({job:row.canonical_job_id,status:'composing'}));
      await service.compose(identity,stage=>console.log(JSON.stringify({job:row.canonical_job_id,stage})));
    }
    if(publish)await new StagedServingPublisher(db).publish(identity);
    console.log(JSON.stringify({job:row.canonical_job_id,status:publish?'dossier_published':'dossier_completed'}));
  }catch(error){
    if(error instanceof ModelProviderUnavailableError)throw error;
    failures+=1;
    console.error(JSON.stringify({job:row.canonical_job_id,status:'dossier_failed',error:error instanceof Error?error.message:String(error)}));
  }
}
console.log(JSON.stringify({selected:rows.length,completed:rows.length-failures,failures,shard,shards,presentationVersion:RICH_DOSSIER_VERSION}));
if(failures)process.exitCode=1;
