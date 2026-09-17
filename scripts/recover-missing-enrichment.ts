import { hostname } from 'node:os';
import { getDatabaseAdapter } from '../src/data/database';
import { getBlobStore } from '../src/lib/storage/blob-store';
import { MissingEnrichmentRecovery } from '../src/lib/intelligence/staged/MissingEnrichmentRecovery';

const option=(name:string)=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const context=option('context');
if(!context)throw new Error('EXPLICIT_CONTEXT_REQUIRED');
const execute=process.argv.includes('--execute');
// Explicit host binding prevents writing a local-only blob for a worker on another host.
if(execute&&option('worker-host')!==hostname())throw new Error(`RECOVERY_WORKER_HOST_REQUIRED: ${hostname()}`);
const db=getDatabaseAdapter();
const scopes=await db.many<{tenant_id:string;person_id:string;search_plan_id:string}>(`SELECT s.tenant_id,s.person_id,s.search_plan_id FROM evaluation_context_scopes s JOIN evaluation_contexts ec ON ec.context_fingerprint=s.context_fingerprint WHERE s.context_fingerprint=? AND ec.policy_version='staged-v6'`,[context]);
if(scopes.length!==1)throw new Error('RECOVERY_SCOPE_MUST_BE_UNAMBIGUOUS');
const row=scopes[0];const scope={tenantId:row.tenant_id,personId:row.person_id,searchPlanId:row.search_plan_id,contextFingerprint:context};
const recovery=new MissingEnrichmentRecovery(db,getBlobStore());
if(process.argv.includes('--release-completed')){
  if(!execute)throw new Error('RECOVERY_RELEASE_REQUIRES_EXECUTE');
  console.log(JSON.stringify({recoveredDependencies:await recovery.recoverCompletedDependencies(scope)}));
}else{
  const versions=await recovery.select(scope,Number(option('limit')||'10'),option('exclude-source-version'));
  for(const version of versions)console.log(JSON.stringify(execute?await recovery.enqueue(version):{dryRun:true,canonicalJobId:version.canonical_job_id,opportunityVersion:version.opportunity_version,chars:version.raw_content.length}));
}
