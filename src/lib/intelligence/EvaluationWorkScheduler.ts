import { createHash } from 'node:crypto';
import type { DatabaseAdapter } from '@/data/database';
import { STAGED_POLICY_VERSION } from './staged/stagedPolicy';

export interface EvaluationWorkIdentity {
  tenantId:string;
  personId:string;
  searchPlanId:string;
  canonicalJobId:string;
  opportunityVersion:string;
  evaluationContextFingerprint:string;
}

/** The sole durable queue writer for staged-v8 evaluation work. */
export class EvaluationWorkScheduler {
  constructor(private readonly db:DatabaseAdapter) {}

  async ensureWork(input:EvaluationWorkIdentity):Promise<{jobId:string|null;queued:boolean;requirementStatus:string}>{
    const context=await this.db.one<{policy_version:string}>(
      `SELECT policy_version FROM evaluation_contexts WHERE context_fingerprint=? AND tenant_id=? AND person_id=?`,
      [input.evaluationContextFingerprint,input.tenantId,input.personId],
    );
    if(!context) throw new Error('EVALUATION_CONTEXT_MISSING');
    if(context.policy_version!==STAGED_POLICY_VERSION) throw new Error(`UNSUPPORTED_EVALUATION_POLICY:${context.policy_version}`);

    const enrichment=await this.db.one<{status:string}>(
      `SELECT status FROM enrichment_jobs WHERE canonical_job_id=? AND opportunity_version=? AND pipeline_version='1.0.0' LIMIT 1`,
      [input.canonicalJobId,input.opportunityVersion],
    );
    // Evaluation depends on exact canonical enrichment. If no enrichment work
    // exists, there is nothing durable to wait on and no evaluation obligation
    // should be manufactured. Fresh ingestion owns creation of enrichment work.
    if(!enrichment) return {jobId:null,queued:false,requirementStatus:'NO_ENRICHMENT'};
    const existed=await this.db.one<{id:string}>(
      `SELECT id FROM evaluation_jobs WHERE tenant_id=? AND search_plan_id=? AND canonical_job_id=? AND opportunity_version=? AND evaluation_context_fingerprint=?`,
      [input.tenantId,input.searchPlanId,input.canonicalJobId,input.opportunityVersion,input.evaluationContextFingerprint],
    );
    const ready=enrichment.status==='COMPLETE';
    const failed=enrichment.status==='FAILED';
    const requirementStatus=failed?'FAILED':ready?'READY':'WAITING_ENRICHMENT';
    const jobStatus=failed?'staged_dead_letter':ready?'staged_pending':'staged_waiting_enrichment';
    const suffix=createHash('sha256').update(input.evaluationContextFingerprint).digest('hex').slice(0,12);
    const jobId=`evaljob_${input.tenantId}_${input.searchPlanId}_${input.canonicalJobId}_${input.opportunityVersion}_${suffix}`.replace(/[^a-zA-Z0-9_-]/g,'_');
    const reqId=`evalreq_${input.tenantId}_${input.searchPlanId}_${input.canonicalJobId}_${input.opportunityVersion}_${suffix}`.replace(/[^a-zA-Z0-9_-]/g,'_');

    const effectiveStatus=await this.db.transaction(async tx=>{
      await tx.execute(
        `INSERT INTO evaluation_requirements (id,tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,required_enrichment_pipeline_version,evaluation_context_fingerprint,status)
         VALUES (?,?,?,?,?,?,'1.0.0',?,?)
         ON CONFLICT(tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint)
         DO UPDATE SET status=CASE WHEN evaluation_requirements.status IN ('SATISFIED','FAILED') THEN evaluation_requirements.status ELSE excluded.status END,
                       blocked_reason=CASE WHEN evaluation_requirements.status IN ('SATISFIED','FAILED') THEN evaluation_requirements.blocked_reason ELSE NULL END`,
        [reqId,input.tenantId,input.personId,input.searchPlanId,input.canonicalJobId,input.opportunityVersion,input.evaluationContextFingerprint,requirementStatus],
      );
      const requirement=await tx.one<{status:string}>(
        `SELECT status FROM evaluation_requirements WHERE tenant_id=? AND person_id=? AND search_plan_id=? AND canonical_job_id=? AND opportunity_version=? AND evaluation_context_fingerprint=?`,
        [input.tenantId,input.personId,input.searchPlanId,input.canonicalJobId,input.opportunityVersion,input.evaluationContextFingerprint],
      );
      if(requirement?.status==='FAILED'||requirement?.status==='SATISFIED') return requirement.status;
      await tx.execute(
        `INSERT INTO evaluation_jobs (id,tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,status,attempts,max_attempts,next_attempt_at,last_error)
         VALUES (?,?,?,?,?,?,?, ?,0,3,CURRENT_TIMESTAMP,?)
         ON CONFLICT(tenant_id,search_plan_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint)
         DO UPDATE SET status=CASE
           WHEN excluded.status='staged_pending' AND evaluation_jobs.status='staged_waiting_enrichment' THEN 'staged_pending'
           WHEN excluded.status='staged_dead_letter' THEN 'staged_dead_letter'
           ELSE evaluation_jobs.status END,
           last_error=CASE WHEN excluded.status='staged_dead_letter' THEN 'ENRICHMENT_FAILED' ELSE evaluation_jobs.last_error END`,
        [jobId,input.tenantId,input.personId,input.searchPlanId,input.canonicalJobId,input.opportunityVersion,input.evaluationContextFingerprint,jobStatus,failed?'ENRICHMENT_FAILED':null],
      );
      return requirementStatus;
    });
    return {jobId:existed?.id??jobId,queued:effectiveStatus==='READY'&&!existed,requirementStatus:effectiveStatus};
  }

  async retryRecoverableDeadLetters(
    scope: { tenantId: string; personId: string },
    evaluationContextFingerprint: string,
  ): Promise<number> {
    return this.db.transaction(async tx => {
      await tx.execute(
        `UPDATE evaluation_requirements
         SET status='READY', blocked_reason=NULL,
             ready_at=COALESCE(ready_at,CURRENT_TIMESTAMP), satisfied_at=NULL
         WHERE tenant_id=? AND person_id=? AND evaluation_context_fingerprint=?
           AND status='FAILED'
           AND blocked_reason LIKE 'EVALUATION_DEAD_LETTER:%'
           AND EXISTS (
             SELECT 1 FROM enrichment_jobs ej
             WHERE ej.canonical_job_id=evaluation_requirements.canonical_job_id
               AND ej.opportunity_version=evaluation_requirements.opportunity_version
               AND ej.pipeline_version=evaluation_requirements.required_enrichment_pipeline_version
               AND ej.status='COMPLETE'
           )`,
        [scope.tenantId, scope.personId, evaluationContextFingerprint],
      );
      const reset = await tx.execute(
        `UPDATE evaluation_jobs
         SET status='staged_pending', attempts=0, next_attempt_at=CURRENT_TIMESTAMP,
             last_error=NULL, completed_at=NULL, locked_by=NULL, lease_token=NULL,
             locked_at=NULL, updated_at=CURRENT_TIMESTAMP
         WHERE tenant_id=? AND person_id=? AND evaluation_context_fingerprint=?
           AND status='staged_dead_letter'
           AND EXISTS (
             SELECT 1 FROM evaluation_requirements er
             WHERE er.tenant_id=evaluation_jobs.tenant_id
               AND er.person_id=evaluation_jobs.person_id
               AND er.search_plan_id=evaluation_jobs.search_plan_id
               AND er.canonical_job_id=evaluation_jobs.canonical_job_id
               AND er.opportunity_version=evaluation_jobs.opportunity_version
               AND er.evaluation_context_fingerprint=evaluation_jobs.evaluation_context_fingerprint
               AND er.status='READY'
           )`,
        [scope.tenantId, scope.personId, evaluationContextFingerprint],
      );
      return reset.rowsAffected;
    });
  }

}
