/** Supervised rollout drain: never switches serving until exact dossier coverage is complete. */
import { getDatabaseAdapter } from '../src/data/database';
import { ModelProviderUnavailableError } from '../src/lib/model/provider-unavailable';
import { getBlobStore } from '../src/lib/storage/blob-store';
import { loadBedrockCredentials } from '../src/lib/model/bedrock-credentials';
import { createBedrockGlmResearchModel } from '../src/lib/model/bedrock-glm-research-model';
import { RICH_DOSSIER_VERSION,RICH_DOSSIER_FAILURE_VERSION } from '../src/data/sqlite/repositories/SqliteRichDossierStore';
import { ProductionStagedDossierService } from '../src/lib/intelligence/staged/ProductionStagedDossierService';
import { StagedServingPublisher } from '../src/lib/intelligence/staged/StagedServingPublisher';
import { MissingEnrichmentRecovery } from '../src/lib/intelligence/staged/MissingEnrichmentRecovery';
import { selectUnscheduledStagedCandidates } from '../src/lib/intelligence/staged/backfillSelection';
import { EvaluationWorkScheduler } from '../src/lib/intelligence/EvaluationWorkScheduler';
import { stagedRolloutReadiness,activateReadyStagedRollout } from '../src/lib/intelligence/staged/StagedRolloutReadiness';

const option=(name:string)=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const context=option('context'),expectedActive=option('expected-active');
if(!context||!expectedActive)throw new Error('EXPLICIT_ROLLOUT_CONTEXTS_REQUIRED');
loadBedrockCredentials();
const db=getDatabaseAdapter();
const contexts=await db.many<{tenant_id:string;person_id:string;search_plan_id:string;profile_version:string}>(`SELECT ecs.tenant_id,ecs.person_id,ecs.search_plan_id,ec.profile_version FROM evaluation_context_scopes ecs JOIN evaluation_contexts ec ON ec.context_fingerprint=ecs.context_fingerprint WHERE ecs.context_fingerprint=? AND ec.policy_version='staged-v6'`,[context]);
if(contexts.length!==1)throw new Error('ROLLOUT_SCOPE_MUST_BE_UNAMBIGUOUS');
const binding=contexts[0];const scope={tenantId:binding.tenant_id,personId:binding.person_id,searchPlanId:binding.search_plan_id,contextFingerprint:context};
const composer=new ProductionStagedDossierService(db,createBedrockGlmResearchModel());
const publisher=new StagedServingPublisher(db);
const recovery=new MissingEnrichmentRecovery(db,getBlobStore());
while(true){
  const current=await db.one<{context_fingerprint:string}>(`SELECT context_fingerprint FROM active_evaluation_contexts WHERE tenant_id=? AND person_id=? AND search_plan_id=?`,[scope.tenantId,scope.personId,scope.searchPlanId]);
  if(current?.context_fingerprint!==expectedActive)throw new Error('ROLLOUT_ACTIVE_CONTEXT_CHANGED');
  await recovery.recoverCompletedDependencies(scope);
  const unscheduled=await selectUnscheduledStagedCandidates(db,{...scope,limit:500,readyOnly:true,excludeSourceVersion:option('exclude-source-version')});
  for(const row of unscheduled)await new EvaluationWorkScheduler(db).ensureWork({...scope,canonicalJobId:row.canonical_job_id,opportunityVersion:row.opportunity_version,evaluationContextFingerprint:context});
  const rows=await db.many<{canonical_job_id:string;opportunity_version:string}>(`SELECT se.canonical_job_id,se.opportunity_version FROM staged_evaluations se WHERE se.tenant_id=? AND se.person_id=? AND se.evaluation_context_fingerprint=? AND se.evaluation_state='COMPLETED'
    AND (NOT EXISTS(SELECT 1 FROM materialized_evaluations me WHERE me.tenant_id=se.tenant_id AND me.person_id=se.person_id AND me.canonical_job_id=se.canonical_job_id AND me.opportunity_version=se.opportunity_version AND me.evaluation_context_fingerprint=se.evaluation_context_fingerprint)
      OR NOT EXISTS(SELECT 1 FROM materialized_dossier_presentations p WHERE p.tenant_id=se.tenant_id AND p.person_id=se.person_id AND p.canonical_job_id=se.canonical_job_id AND p.opportunity_version=se.opportunity_version AND p.evaluation_context_fingerprint=se.evaluation_context_fingerprint AND p.presentation_version=? AND json_extract(p.presentation_json,'$.sourceInputFingerprint')=se.input_fingerprint AND p.source_evaluation_fingerprint=json_extract(p.presentation_json,'$.sourceEvaluationFingerprint')))
    AND NOT EXISTS(SELECT 1 FROM materialized_dossier_presentations p WHERE p.tenant_id=se.tenant_id AND p.person_id=se.person_id AND p.canonical_job_id=se.canonical_job_id AND p.opportunity_version=se.opportunity_version AND p.evaluation_context_fingerprint=se.evaluation_context_fingerprint AND p.presentation_version=?)
    ORDER BY CASE se.decision WHEN 'PURSUE' THEN 0 WHEN 'CONSIDER' THEN 1 ELSE 2 END,se.evaluated_at LIMIT 5`,[scope.tenantId,scope.personId,context,RICH_DOSSIER_VERSION,RICH_DOSSIER_FAILURE_VERSION]);
  for(const row of rows){
    const identity={...scope,evaluationContextFingerprint:context,canonicalJobId:row.canonical_job_id,opportunityVersion:row.opportunity_version,profileVersion:binding.profile_version};
    try{await composer.compose(identity);await publisher.publish(identity);console.log(JSON.stringify({job:row.canonical_job_id,status:'published',presentationVersion:RICH_DOSSIER_VERSION}));}
    catch(error){console.error(JSON.stringify({job:row.canonical_job_id,status:'presentation_failed',error:error instanceof Error?error.message:String(error)}));if(error instanceof ModelProviderUnavailableError)throw error;}
  }
  const readiness=await stagedRolloutReadiness(db,scope);console.log(JSON.stringify({context,...readiness}));
  if(readiness.ready){
    if(process.argv.includes('--activate'))console.log(JSON.stringify({status:'activated',context,...await activateReadyStagedRollout(db,scope,expectedActive)}));
    break;
  }
  const enriching=await db.one<{n:number}>(`SELECT COUNT(*) n FROM search_plan_candidates spc JOIN enrichment_jobs en ON en.canonical_job_id=spc.canonical_job_id AND en.opportunity_version=spc.opportunity_version AND en.pipeline_version='1.0.0' WHERE spc.tenant_id=? AND spc.person_id=? AND spc.search_plan_id=? AND spc.attention_decision='CANDIDATE' AND en.status IN ('PENDING','RETRY','LEASED','RUNNING')`,[scope.tenantId,scope.personId,scope.searchPlanId]);
  if(!rows.length&&!readiness.pending&&!enriching?.n){console.error('ROLLOUT_BLOCKED: inspect unavailable presentations and unresolved dependencies; serving preserved');process.exitCode=1;break;}
  if(!rows.length)await new Promise(resolve=>setTimeout(resolve,30_000));
}
