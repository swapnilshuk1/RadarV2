import type { DatabaseAdapter } from '@/data/database';
import type { RecoveryScope } from './MissingEnrichmentRecovery';

/** Explicit operator recovery after provider access has been proved. */
export async function recoverStagedProviderFailures(db:DatabaseAdapter,scope:RecoveryScope,limit:number,execute=false){
  if(!Number.isSafeInteger(limit)||limit<1)throw new Error('RECOVERY_LIMIT_INVALID');
  return db.transaction(async tx=>{
    const rows=await tx.many<{job_id:string;requirement_id:string;enrichment_id:string;canonical_job_id:string;opportunity_version:string;attempts:number;last_error:string;blocked_reason:string}>(`
      SELECT ej.id job_id,er.id requirement_id,en.id enrichment_id,ej.canonical_job_id,ej.opportunity_version,ej.attempts,ej.last_error,er.blocked_reason
      FROM evaluation_jobs ej JOIN evaluation_requirements er ON er.tenant_id=ej.tenant_id AND er.person_id=ej.person_id AND er.search_plan_id=ej.search_plan_id AND er.canonical_job_id=ej.canonical_job_id AND er.opportunity_version=ej.opportunity_version AND er.evaluation_context_fingerprint=ej.evaluation_context_fingerprint
      JOIN evaluation_contexts ec ON ec.context_fingerprint=ej.evaluation_context_fingerprint AND ec.policy_version='staged-v6'
      JOIN enrichment_jobs en ON en.canonical_job_id=ej.canonical_job_id AND en.opportunity_version=ej.opportunity_version AND en.pipeline_version=er.required_enrichment_pipeline_version AND en.status='COMPLETE'
      JOIN opportunity_versions ov ON ov.id=ej.opportunity_version AND ov.canonical_job_id=ej.canonical_job_id AND ov.acquisition_status='ACQUIRED' AND ov.lifecycle_state='ACTIVE'
      JOIN search_plan_candidates spc ON spc.tenant_id=ej.tenant_id AND spc.person_id=ej.person_id AND spc.search_plan_id=ej.search_plan_id AND spc.canonical_job_id=ej.canonical_job_id AND spc.opportunity_version=ej.opportunity_version AND spc.attention_decision='CANDIDATE'
      WHERE ej.tenant_id=? AND ej.person_id=? AND ej.search_plan_id=? AND ej.evaluation_context_fingerprint=?
        AND ej.status='staged_dead_letter' AND er.status='FAILED' AND ej.last_error LIKE '%Bedrock provider HTTP 403%' AND er.blocked_reason LIKE 'EVALUATION_DEAD_LETTER:%Bedrock provider HTTP 403%'
        AND NOT EXISTS(SELECT 1 FROM staged_evaluations se WHERE se.tenant_id=ej.tenant_id AND se.person_id=ej.person_id AND se.canonical_job_id=ej.canonical_job_id AND se.opportunity_version=ej.opportunity_version AND se.evaluation_context_fingerprint=ej.evaluation_context_fingerprint)
        AND NOT EXISTS(SELECT 1 FROM recovery_queue rq WHERE rq.tenant_id=ej.tenant_id AND rq.canonical_job_id=ej.canonical_job_id AND rq.opportunity_version_id=ej.opportunity_version AND rq.reason='SOURCE_NOT_JOB_DESCRIPTION')
      ORDER BY ej.canonical_job_id LIMIT ?`,[scope.tenantId,scope.personId,scope.searchPlanId,scope.contextFingerprint,limit]);
    if(execute)for(const row of rows){
      await tx.execute(`INSERT INTO enrichment_events(job_id,event_type,details) VALUES(?,'EVALUATION_PROVIDER_FAILURE_RECOVERED',?)`,[row.enrichment_id,JSON.stringify({...row,previousJobStatus:'staged_dead_letter',previousRequirementStatus:'FAILED',contextFingerprint:scope.contextFingerprint})]);
      await tx.execute(`UPDATE evaluation_requirements SET status='READY',blocked_reason=NULL,ready_at=CURRENT_TIMESTAMP WHERE id=?`,[row.requirement_id]);
      await tx.execute(`UPDATE evaluation_jobs SET status='staged_pending',attempts=0,last_error=NULL,completed_at=NULL,locked_by=NULL,locked_at=NULL,lease_token=NULL,next_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`,[row.job_id]);
    }
    return rows.map(row=>({jobId:row.job_id,canonicalJobId:row.canonical_job_id,opportunityVersion:row.opportunity_version,recovered:execute}));
  });
}
