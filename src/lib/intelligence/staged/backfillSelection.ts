import type { DatabaseAdapter } from '@/data/database';

/** Repeated bounded passes advance without reselecting queued or terminal work. */
export async function selectUnscheduledStagedCandidates(db: DatabaseAdapter, input: {
  tenantId:string; personId:string; searchPlanId:string; contextFingerprint:string; limit:number; canonicalJobId?:string;
  readyOnly?:boolean; excludeSourceVersion?:string;
}) {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1) throw new Error('BACKFILL_LIMIT_INVALID');
  return db.many<{canonical_job_id:string;opportunity_version:string}>(`
    SELECT spc.canonical_job_id,spc.opportunity_version FROM search_plan_candidates spc
    JOIN opportunity_versions ov ON ov.canonical_job_id=spc.canonical_job_id AND ov.id=spc.opportunity_version
    WHERE spc.tenant_id=? AND spc.person_id=? AND spc.search_plan_id=?
      AND spc.attention_decision='CANDIDATE' AND ov.lifecycle_state='ACTIVE' AND ov.acquisition_status='ACQUIRED'
      AND NOT EXISTS (SELECT 1 FROM staged_evaluations se WHERE se.tenant_id=spc.tenant_id AND se.person_id=spc.person_id
        AND se.canonical_job_id=spc.canonical_job_id AND se.opportunity_version=spc.opportunity_version AND se.evaluation_context_fingerprint=?)
      AND NOT EXISTS (SELECT 1 FROM evaluation_requirements er WHERE er.tenant_id=spc.tenant_id AND er.person_id=spc.person_id
        AND er.search_plan_id=spc.search_plan_id AND er.canonical_job_id=spc.canonical_job_id AND er.opportunity_version=spc.opportunity_version AND er.evaluation_context_fingerprint=?)
      AND NOT EXISTS (SELECT 1 FROM evaluation_jobs ej WHERE ej.tenant_id=spc.tenant_id AND ej.person_id=spc.person_id
        AND ej.search_plan_id=spc.search_plan_id AND ej.canonical_job_id=spc.canonical_job_id AND ej.opportunity_version=spc.opportunity_version AND ej.evaluation_context_fingerprint=?)
      ${input.canonicalJobId ? 'AND spc.canonical_job_id=?' : ''}
      ${input.readyOnly ? "AND EXISTS (SELECT 1 FROM enrichment_jobs en WHERE en.canonical_job_id=spc.canonical_job_id AND en.opportunity_version=spc.opportunity_version AND en.pipeline_version='1.0.0' AND en.status='COMPLETE')" : ''}
      ${input.excludeSourceVersion ? 'AND ov.raw_content<>(SELECT raw_content FROM opportunity_versions WHERE id=?)' : ''}
    ORDER BY spc.canonical_job_id,spc.opportunity_version LIMIT ?`,
    [input.tenantId,input.personId,input.searchPlanId,input.contextFingerprint,input.contextFingerprint,input.contextFingerprint,...(input.canonicalJobId?[input.canonicalJobId]:[]),...(input.excludeSourceVersion?[input.excludeSourceVersion]:[]),input.limit]);
}
