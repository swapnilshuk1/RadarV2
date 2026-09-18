/** Real staged validation against an isolated local SQLite copy. Never opens a remote database. */
import Database from 'better-sqlite3';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {SqliteAdapter} from '../../src/data/database/sqlite';
import {runMigrations} from '../../src/data/sqlite/migrations/runner';
import {SqliteEvaluationContextStore} from '../../src/data/sqlite/repositories/SqliteEvaluationContextStore';
import {SqliteOpportunityQueries} from '../../src/data/sqlite/repositories/SqliteOpportunityQueries';
import {ProductionStagedEvaluationService} from '../../src/lib/intelligence/staged/ProductionStagedEvaluationService';
import {ProductionStagedDossierService} from '../../src/lib/intelligence/staged/ProductionStagedDossierService';
import {StagedServingPublisher} from '../../src/lib/intelligence/staged/StagedServingPublisher';
import {createBedrockGlmResearchModel} from '../../src/lib/model/bedrock-glm-research-model';
import {STAGED_POLICY_VERSION} from '../../src/lib/intelligence/staged/stagedPolicy';
import {resolveServingScope} from '../../src/lib/security/scope-resolver';
import {stagedRolloutReadiness} from '../../src/lib/intelligence/staged/StagedRolloutReadiness';
import {allPassages} from '../../src/dossier/grounding';

const option=(name:string)=>process.argv.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3);
const directory=resolve(option('dir')||'.radar/v7-readiness-20260918');
const within=relative(resolve('.radar'),directory);
if(!within||within.startsWith('..')||isAbsolute(within))throw new Error('LOCAL_READINESS_DIRECTORY_REQUIRED');
const mode=option('mode'),file=join(directory,'local.sqlite');
if(!['init','run','report'].includes(mode||''))throw new Error('MODE_REQUIRED: init, run or report');
if(mode==='init'&&existsSync(file))throw new Error('LOCAL_COPY_ALREADY_EXISTS');
if(mode!=='init'&&!existsSync(file))throw new Error('LOCAL_COPY_MISSING');
mkdirSync(directory,{recursive:true});
const native=new Database(file),db=new SqliteAdapter(native);
const exported=JSON.parse(readFileSync(join(directory,'production-input-export.json'),'utf8'));
const scope={tenantId:exported.tables.people[0].tenant_id,personId:exported.tables.people[0].id};
const contexts=new SqliteEvaluationContextStore(db);
const bindingFile=join(directory,'local-context.json');
if(mode==='init'){
 await runMigrations(db);
 native.pragma('foreign_keys = OFF');
 native.transaction(()=>{
  for(const [table,rows] of Object.entries(exported.tables) as [string,Record<string,unknown>[]][]){
   if(!/^[a-z_]+$/.test(table))throw new Error('EXPORT_TABLE_INVALID');
   for(const row of rows){const columns=Object.keys(row);if(columns.some(c=>!/^\w+$/.test(c)))throw new Error('EXPORT_COLUMN_INVALID');
    native.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...Object.values(row));
   }
  }
 })();
 native.pragma('foreign_keys = ON');
 const violations=native.pragma('foreign_key_check');
 if(violations.length)throw new Error(`LOCAL_COPY_FOREIGN_KEYS: ${JSON.stringify(violations)}`);
 const previous=exported.tables.evaluation_contexts[0];
 const context=await contexts.createEvaluationContext(scope,{searchPlanSnapshotId:previous.search_plan_snapshot_id,ontologyVersion:previous.ontology_version,ontologyFingerprint:previous.ontology_fingerprint,policyVersion:STAGED_POLICY_VERSION,profileVersion:previous.profile_version});
 const searchPlanId=exported.tables.search_plans[0].id;
 await contexts.bindEvaluationContextScope(context.contextFingerprint,scope.tenantId,scope.personId,searchPlanId);
 // Local serving authority exercises the real serving DTO; it has no connection to production.
 await contexts.activateContextPointer(context.contextFingerprint,scope.tenantId,scope.personId,searchPlanId);
 const domainsPath=join(directory,'verified-domains.json');
 if(existsSync(domainsPath))for(const entry of JSON.parse(readFileSync(domainsPath,'utf8'))){
  if(!entry.evidenceUrl||!entry.verifiedAt)throw new Error('DOMAIN_VERIFICATION_REQUIRED');
  await db.execute('INSERT INTO intelligence_company_entities(tenant_id,id,normalized_name,official_domain) VALUES(?,?,?,?)',[scope.tenantId,`local-context-${entry.company.toLowerCase().replace(/\W+/g,'-')}`,entry.company.trim().toLowerCase().replace(/\s+/g,' '),entry.domain]);
 }
 writeFileSync(bindingFile,JSON.stringify({context,searchPlanId},null,2),{flag:'wx'});
 console.log(JSON.stringify({status:'LOCAL_INITIALIZED',context:context.contextFingerprint,cases:exported.cohort.length}));
}else{
 const {context,searchPlanId}=JSON.parse(readFileSync(bindingFile,'utf8'));
 if(context.policyVersion!==STAGED_POLICY_VERSION)throw new Error('LOCAL_POLICY_MISMATCH');
 const job=option('job');
 if(mode==='run'){
  if(!job)throw new Error('EXACT_COHORT_JOB_REQUIRED');
  const selected=exported.cohort.filter((r:any)=>r.canonical_job_id===job);
  if(selected.length!==1)throw new Error('JOB_NOT_IN_FROZEN_COHORT');
  const row=selected[0],output=join(directory,job);
  mkdirSync(output,{recursive:true});
  const identity={...scope,canonicalJobId:row.canonical_job_id,opportunityVersion:row.opportunity_version,evaluationContextFingerprint:context.contextFingerprint,profileVersion:context.profileVersion,context};
  const model=createBedrockGlmResearchModel();
  const calls=join(output,`model-calls-${Date.now()}`);mkdirSync(calls);
  const generate=model.generate.bind(model);let callNumber=0;
  model.generate=async(instruction,input,schema)=>{
   const call=++callNumber,start=Date.now();
   console.log(`${new Date().toISOString()} ${row.company_name}: model call ${call} started`);
   try{const result=await generate(instruction,input,schema);writeFileSync(join(calls,`${call}.json`),JSON.stringify({instruction,input,result,usage:model.lastUsage,elapsedMs:Date.now()-start}),{flag:'wx'});console.log(`${new Date().toISOString()} ${row.company_name}: model call ${call} completed`);return result;}
   catch(error){writeFileSync(join(calls,`${call}-failure.json`),JSON.stringify({instruction,input,error:error instanceof Error?error.message:'UNKNOWN',elapsedMs:Date.now()-start}),{flag:'wx'});throw error;}
  };
  const startedAt=Date.now();
  const stages:string[]=[];
  const stage=(value:string)=>{stages.push(value);console.log(`${new Date().toISOString()} ${row.company_name}: ${value}`);};
  try{
   const evaluation=await new ProductionStagedEvaluationService(db,model).evaluate(identity,stage);
   writeFileSync(join(output,'evaluation.json'),JSON.stringify(evaluation,null,2));
   const dossier=await new ProductionStagedDossierService(db,model).compose(identity,stage);
   await new StagedServingPublisher(db).publish(identity);
   const servingScope=(await resolveServingScope(scope.personId,scope.tenantId,db)).scope;
   const sourceJob=exported.tables.canonical_opportunities.find((r:any)=>r.id===job).source_job_id;
   const dto=await new SqliteOpportunityQueries(db).getDossier(servingScope,sourceJob);
   if(!dto||dto.evaluationState!=='EVALUATED'||!dto.richDossier)throw new Error('REAL_SERVING_DTO_MISSING');
   writeFileSync(join(output,'dossier.json'),JSON.stringify(dossier,null,2));
   writeFileSync(join(output,'dto.json'),JSON.stringify(dto,null,2));
   const result={status:'PASS',job,company:row.company_name,verdict:evaluation.decision,screening:evaluation.screeningViability,contextClaims:dossier.evidence.contextualClaims.length,passages:allPassages(dossier).length,elapsedMs:Date.now()-startedAt,stages};
   writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }catch(error){const result={status:'FAILED',job,elapsedMs:Date.now()-startedAt,error:error instanceof Error?error.message:'UNKNOWN',stages};writeFileSync(join(output,`failure-${Date.now()}.json`),JSON.stringify(result,null,2));console.error(JSON.stringify(result));process.exitCode=1;}
 }
 const readiness=await stagedRolloutReadiness(db,{...scope,searchPlanId,contextFingerprint:context.contextFingerprint});
 console.log(JSON.stringify({localOnly:true,context:context.contextFingerprint,...readiness}));
}
native.close();
