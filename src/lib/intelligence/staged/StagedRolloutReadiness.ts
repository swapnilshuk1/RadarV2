import type { DatabaseAdapter } from '@/data/database';
import { SqliteEvaluationContextStore } from '@/data/sqlite/repositories/SqliteEvaluationContextStore';
import { RICH_DOSSIER_VERSION } from '@/data/sqlite/repositories/SqliteRichDossierStore';
import type { RecoveryScope } from './MissingEnrichmentRecovery';

export async function stagedRolloutReadiness(db:DatabaseAdapter,scope:RecoveryScope){
  const counts=await db.one<{total:number;prepared:number;excluded:number;unprepared:number}>(`WITH coverage AS (
    SELECT CASE WHEN se.evaluation_state='INPUT_UNAVAILABLE' OR EXISTS(SELECT 1 FROM recovery_queue rq WHERE rq.tenant_id=spc.tenant_id AND rq.canonical_job_id=spc.canonical_job_id AND rq.opportunity_version_id=spc.opportunity_version AND rq.reason='SOURCE_NOT_JOB_DESCRIPTION') THEN 'EXCLUDED'
      WHEN se.evaluation_state='COMPLETED' AND me.evaluation_state='STAGED_EVALUATED' AND me.decision=se.decision AND me.evaluation_fingerprint IS NOT NULL AND p.source_evaluation_fingerprint=me.evaluation_fingerprint THEN 'PREPARED'
      ELSE 'UNPREPARED' END AS state
    FROM search_plan_candidates spc JOIN opportunity_versions ov ON ov.id=spc.opportunity_version AND ov.canonical_job_id=spc.canonical_job_id
    LEFT JOIN staged_evaluations se ON se.tenant_id=spc.tenant_id AND se.person_id=spc.person_id AND se.canonical_job_id=spc.canonical_job_id AND se.opportunity_version=spc.opportunity_version AND se.evaluation_context_fingerprint=?
    LEFT JOIN materialized_evaluations me ON me.tenant_id=spc.tenant_id AND me.person_id=spc.person_id AND me.canonical_job_id=spc.canonical_job_id AND me.opportunity_version=spc.opportunity_version AND me.evaluation_context_fingerprint=se.evaluation_context_fingerprint
    LEFT JOIN materialized_dossier_presentations p ON p.tenant_id=spc.tenant_id AND p.person_id=spc.person_id AND p.canonical_job_id=spc.canonical_job_id AND p.opportunity_version=spc.opportunity_version AND p.evaluation_context_fingerprint=se.evaluation_context_fingerprint AND p.presentation_version=?
    WHERE spc.tenant_id=? AND spc.person_id=? AND spc.search_plan_id=? AND spc.attention_decision='CANDIDATE' AND ov.lifecycle_state='ACTIVE' AND ov.acquisition_status='ACQUIRED')
    SELECT COUNT(*) total,COALESCE(SUM(state='PREPARED'),0) prepared,COALESCE(SUM(state='EXCLUDED'),0) excluded,COALESCE(SUM(state='UNPREPARED'),0) unprepared FROM coverage`,[scope.contextFingerprint,RICH_DOSSIER_VERSION,scope.tenantId,scope.personId,scope.searchPlanId]);
  const work=await db.one<{n:number}>(`SELECT COUNT(*) n FROM evaluation_jobs WHERE tenant_id=? AND person_id=? AND search_plan_id=? AND evaluation_context_fingerprint=? AND status IN ('staged_pending','staged_processing')`,[scope.tenantId,scope.personId,scope.searchPlanId,scope.contextFingerprint]);
  const result={...counts!,pending:work?.n||0};
  return {...result,ready:result.total>0&&result.prepared>0&&result.unprepared===0&&result.pending===0};
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
