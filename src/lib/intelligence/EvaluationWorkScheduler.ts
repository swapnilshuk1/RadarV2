import { createHash } from 'node:crypto';
import type { DatabaseAdapter } from '@/data/database';
import { STAGED_POLICY_VERSION } from '@/data/sqlite/repositories/SqliteStagedEvaluationStore';
export interface EvaluationWorkIdentity { tenantId:string; personId:string; searchPlanId:string; canonicalJobId:string; opportunityVersion:string; evaluationContextFingerprint:string; }
/** The sole durable queue writer for admitted and backfilled opportunities. */
export class EvaluationWorkScheduler {
  constructor(private readonly db:DatabaseAdapter) {}
  async ensureWork(input:EvaluationWorkIdentity):Promise<{jobId:string;queued:boolean;requirementStatus:string}>{
    const existed=await this.db.one<{id:string}>(`SELECT id FROM evaluation_jobs WHERE tenant_id=? AND search_plan_id=? AND canonical_job_id=? AND opportunity_version=? AND evaluation_context_fingerprint=?`,[input.tenantId,input.searchPlanId,input.canonicalJobId,input.opportunityVersion,input.evaluationContextFingerprint]);
    const context=await this.db.one<{policy_version:string}>(`SELECT policy_version FROM evaluation_contexts WHERE context_fingerprint=? AND tenant_id=? AND person_id=?`,[input.evaluationContextFingerprint,input.tenantId,input.personId]);
    if(!context) throw new Error('EVALUATION_CONTEXT_MISSING');
    const staged=context.policy_version===STAGED_POLICY_VERSION;
    const enrichment=await this.db.one<{status:string}>(`SELECT status FROM enrichment_jobs WHERE canonical_job_id=? AND opportunity_version=? AND pipeline_version='1.0.0' LIMIT 1`,[input.canonicalJobId,input.opportunityVersion]);
    const ready=enrichment?.status==='COMPLETE'; const requirementStatus=ready?'READY':'WAITING_ENRICHMENT'; const jobStatus=ready?(staged?'staged_pending':'pending'):(staged?'staged_waiting_enrichment':'waiting_enrichment'); const suffix=createHash('sha256').update(input.evaluationContextFingerprint).digest('hex').slice(0,12);
    const jobId=`evaljob_${input.tenantId}_${input.searchPlanId}_${input.canonicalJobId}_${input.opportunityVersion}_${suffix}`.replace(/[^a-zA-Z0-9_-]/g,'_'); const reqId=`evalreq_${input.tenantId}_${input.searchPlanId}_${input.canonicalJobId}_${input.opportunityVersion}_${suffix}`.replace(/[^a-zA-Z0-9_-]/g,'_');
    await this.db.transaction(async tx=>{
      await tx.execute(`INSERT INTO evaluation_requirements (id,tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,required_enrichment_pipeline_version,evaluation_context_fingerprint,status) VALUES (?,?,?,?,?,?,'1.0.0',?,?) ON CONFLICT(tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint) DO UPDATE SET status=CASE WHEN evaluation_requirements.status IN ('SATISFIED','FAILED') THEN evaluation_requirements.status ELSE excluded.status END,blocked_reason=CASE WHEN evaluation_requirements.status IN ('SATISFIED','FAILED') THEN evaluation_requirements.blocked_reason ELSE NULL END`,[reqId,input.tenantId,input.personId,input.searchPlanId,input.canonicalJobId,input.opportunityVersion,input.evaluationContextFingerprint,requirementStatus]);
      await tx.execute(`INSERT INTO evaluation_jobs (id,tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,status,attempts,max_attempts,next_attempt_at) VALUES (?,?,?,?,?,?,?, ?,0,3,CURRENT_TIMESTAMP) ON CONFLICT(tenant_id,search_plan_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint) DO UPDATE SET status=? WHERE evaluation_jobs.status IN ('waiting_enrichment','staged_waiting_enrichment') AND ? IN ('pending','staged_pending')`,[jobId,input.tenantId,input.personId,input.searchPlanId,input.canonicalJobId,input.opportunityVersion,input.evaluationContextFingerprint,jobStatus,jobStatus,jobStatus]);
    });
    return {jobId,queued:ready&&!existed,requirementStatus};
  }
}
