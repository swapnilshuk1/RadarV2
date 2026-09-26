import { DatabaseAdapter, getDatabaseAdapter } from '@/data/database';
import { AuthContext, authorizePersonScope } from '@/lib/security/auth';
import { EvaluationWorkScheduler } from './EvaluationWorkScheduler';
export interface EnqueueOptions { adapter?:DatabaseAdapter; }
export interface EnqueueResult {searchPlanId:string;tenantId:string;personId:string;evaluationContextFingerprint:string;candidatesProcessed:number;enqueuedCount:number;skippedCount:number;ignoredNotCandidateCount:number;jobIds:string[];}
/** Enqueues admitted candidates through the shared scheduler. Active context wins; legacy contexts remain supported. */
export async function enqueueEvaluationJobsForPlan(auth:AuthContext,personId:string,searchPlanId:string,options?:EnqueueOptions):Promise<EnqueueResult>{
 const db=options?.adapter||getDatabaseAdapter(); const scope=await authorizePersonScope(auth,personId,db,"write:person");
 const plan=await db.one<{id:string}>(`SELECT id FROM search_plans WHERE id=? AND tenant_id=? AND person_id=?`,[searchPlanId,scope.tenantId,personId]); if(!plan)throw new Error(`[enqueueEvaluationJobs] Search plan '${searchPlanId}' not found or unauthorized`);
 let active=await db.one<{context_fingerprint:string}>(`SELECT context_fingerprint FROM active_evaluation_contexts WHERE tenant_id=? AND person_id=? AND search_plan_id=?`,[scope.tenantId,personId,searchPlanId]);
 if(!active) active=await db.one<{context_fingerprint:string}>(`SELECT ec.context_fingerprint FROM evaluation_contexts ec JOIN search_plan_snapshots sps ON sps.id=ec.search_plan_snapshot_id WHERE sps.search_plan_id=? AND ec.tenant_id=? AND ec.person_id=? ORDER BY ec.created_at DESC,ec.rowid DESC LIMIT 1`,[searchPlanId,scope.tenantId,personId]);
 if(!active)throw new Error(`[enqueueEvaluationJobs] No pre-existing EvaluationContext found for search plan '${searchPlanId}'.`);
 const candidates=await db.many<{canonical_job_id:string;opportunity_version:string;attention_decision:string}>(`SELECT canonical_job_id,opportunity_version,attention_decision FROM search_plan_candidates WHERE search_plan_id=? AND tenant_id=? AND person_id=?`,[searchPlanId,scope.tenantId,personId]); const scheduler=new EvaluationWorkScheduler(db); let enqueuedCount=0,skippedCount=0,ignoredNotCandidateCount=0; const jobIds:string[]=[];
 for(const candidate of candidates){ if(candidate.attention_decision!=='CANDIDATE'){ignoredNotCandidateCount++;continue;} const result=await scheduler.ensureWork({tenantId:scope.tenantId,personId,searchPlanId,canonicalJobId:candidate.canonical_job_id,opportunityVersion:candidate.opportunity_version,evaluationContextFingerprint:active.context_fingerprint}); if(result.queued){enqueuedCount++;jobIds.push(result.jobId)}else skippedCount++; }
 return {searchPlanId,tenantId:scope.tenantId,personId,evaluationContextFingerprint:active.context_fingerprint,candidatesProcessed:candidates.length,enqueuedCount,skippedCount,ignoredNotCandidateCount,jobIds};
}
