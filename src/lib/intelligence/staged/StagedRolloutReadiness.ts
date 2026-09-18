import {computeEvaluationContextFingerprint} from '@/lib/domain/evaluation_fingerprint';
import type { DatabaseAdapter } from '@/data/database';
import { SqliteEvaluationContextStore } from '@/data/sqlite/repositories/SqliteEvaluationContextStore';
import {validateSnapshot} from '@/data/sqlite/repositories/SqliteStagedInputStore';
import {stagedDossierHealth} from './stagedDossierHealth';
import type { RecoveryScope } from './MissingEnrichmentRecovery';

export async function stagedRolloutReadiness(db:DatabaseAdapter,scope:RecoveryScope){
  const context=await db.one<{policy_version:string;profile_version:string;search_plan_snapshot_id:string;ontology_version:string;ontology_fingerprint:string}>(`SELECT policy_version,profile_version,search_plan_snapshot_id,ontology_version,ontology_fingerprint FROM evaluation_contexts WHERE context_fingerprint=? AND tenant_id=? AND person_id=?`,[scope.contextFingerprint,scope.tenantId,scope.personId]);
  const contextRequired=context?.policy_version==='staged-v7'||context?.policy_version==='staged-v8';
  const blockers:string[]=[];
  if(!context)blockers.push('CONTEXT_NOT_FOUND');
  if(context?.policy_version==='staged-v8'&&computeEvaluationContextFingerprint({tenantId:scope.tenantId,personId:scope.personId,searchPlanSnapshotId:context.search_plan_snapshot_id,ontologyVersion:context.ontology_version,ontologyFingerprint:context.ontology_fingerprint,policyVersion:context.policy_version,profileVersion:context.profile_version})!==scope.contextFingerprint)blockers.push('CONTEXT_ACQUISITION_POLICY_IDENTITY_MISMATCH');
  if(contextRequired&&!process.env.TAVILY_API_KEY?.trim())blockers.push('CONTEXT_SEARCH_CONFIGURATION_REQUIRED');
  // Existing v7 remains readable; changed acquisition/decision semantics roll out as v8.
  if(context?.policy_version==='staged-v7')blockers.push('NEW_ROLLOUT_REQUIRES_STAGED_V8');
  const rows=await db.many<{canonical_job_id:string;opportunity_version:string;excluded:number}>(`SELECT spc.canonical_job_id,spc.opportunity_version,
    CASE WHEN se.evaluation_state='INPUT_UNAVAILABLE' OR EXISTS(SELECT 1 FROM recovery_queue rq WHERE rq.tenant_id=spc.tenant_id AND rq.canonical_job_id=spc.canonical_job_id AND rq.opportunity_version_id=spc.opportunity_version AND rq.reason='SOURCE_NOT_JOB_DESCRIPTION') THEN 1 ELSE 0 END excluded
    FROM search_plan_candidates spc JOIN opportunity_versions ov ON ov.id=spc.opportunity_version AND ov.canonical_job_id=spc.canonical_job_id
    LEFT JOIN staged_evaluations se ON se.tenant_id=spc.tenant_id AND se.person_id=spc.person_id AND se.canonical_job_id=spc.canonical_job_id AND se.opportunity_version=spc.opportunity_version AND se.evaluation_context_fingerprint=?
    WHERE spc.tenant_id=? AND spc.person_id=? AND spc.search_plan_id=? AND spc.attention_decision='CANDIDATE' AND ov.lifecycle_state='ACTIVE' AND ov.acquisition_status='ACQUIRED'`,[scope.contextFingerprint,scope.tenantId,scope.personId,scope.searchPlanId]);
  let prepared=0,excluded=0,passSkipped=0;
  for(const row of rows){
    if(row.excluded){excluded++;continue;}
    const identity={tenantId:scope.tenantId,personId:scope.personId,canonicalJobId:row.canonical_job_id,opportunityVersion:row.opportunity_version,evaluationContextFingerprint:scope.contextFingerprint,profileVersion:context?.profile_version||''};
    const health=await stagedDossierHealth(db,identity);
    let operational=!contextRequired;
    if(contextRequired){
      const snapshot=await db.one<{input_json:string}>(`SELECT sf.input_json FROM staged_frozen_inputs sf JOIN staged_evaluations se ON se.tenant_id=sf.tenant_id AND se.person_id=sf.person_id AND se.canonical_job_id=sf.canonical_job_id AND se.opportunity_version=sf.opportunity_version AND se.evaluation_context_fingerprint=sf.evaluation_context_fingerprint AND se.input_fingerprint=sf.input_fingerprint WHERE sf.tenant_id=? AND sf.person_id=? AND sf.canonical_job_id=? AND sf.opportunity_version=? AND sf.evaluation_context_fingerprint=?`,[scope.tenantId,scope.personId,row.canonical_job_id,row.opportunity_version,scope.contextFingerprint]);
      try{operational=validateSnapshot(JSON.parse(snapshot?.input_json||'{}')).acquisition.some((a:{provider:string;status:string})=>a.provider==='context-web-search'&&['RETRIEVED','NO_RESULTS'].includes(a.status))===true;}catch{operational=false;}
    }
    if(operational&&health.passSkipped){prepared++;passSkipped++;}
    else if(health.dossier&&health.published&&operational)prepared++;
  }
  const work=await db.one<{n:number}>(`SELECT COUNT(*) n FROM evaluation_jobs WHERE tenant_id=? AND person_id=? AND search_plan_id=? AND evaluation_context_fingerprint=? AND status IN ('staged_pending','staged_processing')`,[scope.tenantId,scope.personId,scope.searchPlanId,scope.contextFingerprint]);
  const result={total:rows.length,prepared,excluded,passSkipped,unprepared:rows.length-prepared-excluded,pending:work?.n||0,blockers};
  return {...result,ready:!blockers.length&&result.total>0&&prepared>0&&result.unprepared===0&&result.pending===0};
}

export async function activateReadyStagedRollout(db:DatabaseAdapter,scope:RecoveryScope,expectedActive:string){
  return db.transaction(async tx=>{
    const current=await tx.one<{context_fingerprint:string}>(`SELECT context_fingerprint FROM active_evaluation_contexts WHERE tenant_id=? AND person_id=? AND search_plan_id=?`,[scope.tenantId,scope.personId,scope.searchPlanId]);
    if(current?.context_fingerprint!==expectedActive)throw new Error('ROLLOUT_ACTIVE_CONTEXT_CHANGED');
    const readiness=await stagedRolloutReadiness(tx,scope);
    if(!readiness.ready)throw new Error('ROLLOUT_COVERAGE_INCOMPLETE');
    if(!await new SqliteEvaluationContextStore(tx).activateContextPointer(scope.contextFingerprint,scope.tenantId,scope.personId,scope.searchPlanId))throw new Error('ROLLOUT_CONTEXT_NOT_BOUND');
    return readiness;
  });
}
