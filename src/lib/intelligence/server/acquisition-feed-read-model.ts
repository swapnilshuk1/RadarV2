import type {DatabaseAdapter} from '@/data/database';
import type {AcquisitionFeedRow} from '../acquisition-feed';
import {RICH_DOSSIER_FAILURE_VERSION} from '@/data/sqlite/repositories/SqliteRichDossierStore';

/** Scoped read model shared by the authenticated route and integration checks. */
export async function readAcquisitionFeed(db:DatabaseAdapter,scope:{tenantId:string;personId:string},activeContext:{contextFingerprint:string;searchPlanId:string},offset=0){
    const cte=`WITH pipeline AS (
      SELECT co.id,ov.id AS version,co.source_job_id AS jobHash,ov.job_title AS role,
        COALESCE(ov.company_name,co.company_name,'Unknown company') AS company,COALESCE(ov.location,'') AS location,co.source,
        CASE WHEN EXISTS(SELECT 1 FROM recovery_queue rq WHERE rq.tenant_id=spc.tenant_id AND rq.canonical_job_id=spc.canonical_job_id AND rq.opportunity_version_id=spc.opportunity_version AND rq.reason='SOURCE_NOT_JOB_DESCRIPTION') THEN 'NEEDS_ATTENTION'
          WHEN se.evaluation_state='COMPLETED' AND se.decision='PASS' THEN 'NOT_PURSUED'
          WHEN me.evaluation_state IN ('COMPLETE','EVALUATED','STAGED_EVALUATED') AND me.decision IN ('PURSUE','CONSIDER','PASS') AND LENGTH(TRIM(me.evaluation_fingerprint))>0 AND ((me.evaluation_state='STAGED_EVALUATED' AND me.quality_score IS NULL) OR (me.evaluation_state<>'STAGED_EVALUATED' AND me.quality_score BETWEEN 0 AND 100)) THEN 'READY'
          WHEN er.status='FAILED' OR ej.status IN ('dead_letter','staged_dead_letter') OR ov.acquisition_status IN ('CAPTURE_FAILED','RECOVERY_FAILED')
            OR EXISTS(SELECT 1 FROM materialized_dossier_presentations p WHERE p.tenant_id=spc.tenant_id AND p.person_id=spc.person_id AND p.canonical_job_id=spc.canonical_job_id AND p.opportunity_version=spc.opportunity_version AND p.evaluation_context_fingerprint=er.evaluation_context_fingerprint AND p.presentation_version='${RICH_DOSSIER_FAILURE_VERSION}') THEN 'NEEDS_ATTENTION'
          WHEN spc.attention_decision='NOT_CANDIDATE' THEN 'OUTSIDE_SEARCH'
          WHEN ej.status IN ('processing','staged_processing') THEN 'PROCESSING'
          WHEN ej.status='staged_completed' THEN 'PREPARING'
          ELSE 'WAITING' END AS state,COALESCE(me.decision,se.decision) AS decision
      FROM search_plan_candidates spc JOIN canonical_opportunities co ON co.id=spc.canonical_job_id
      JOIN opportunity_versions ov ON ov.id=spc.opportunity_version AND ov.canonical_job_id=spc.canonical_job_id
      LEFT JOIN materialized_evaluations me ON me.tenant_id=spc.tenant_id AND me.person_id=spc.person_id AND me.canonical_job_id=spc.canonical_job_id AND me.opportunity_version=spc.opportunity_version AND me.evaluation_context_fingerprint=?
      LEFT JOIN staged_evaluations se ON se.tenant_id=spc.tenant_id AND se.person_id=spc.person_id AND se.canonical_job_id=spc.canonical_job_id AND se.opportunity_version=spc.opportunity_version AND se.evaluation_context_fingerprint=?
      LEFT JOIN evaluation_requirements er ON er.tenant_id=spc.tenant_id AND er.person_id=spc.person_id AND er.search_plan_id=spc.search_plan_id AND er.canonical_job_id=spc.canonical_job_id AND er.opportunity_version=spc.opportunity_version AND er.evaluation_context_fingerprint=?
      LEFT JOIN evaluation_jobs ej ON ej.tenant_id=spc.tenant_id AND ej.person_id=spc.person_id AND ej.search_plan_id=spc.search_plan_id AND ej.canonical_job_id=spc.canonical_job_id AND ej.opportunity_version=spc.opportunity_version AND ej.evaluation_context_fingerprint=?
      WHERE spc.tenant_id=? AND spc.person_id=? AND spc.search_plan_id=? AND ov.lifecycle_state='ACTIVE')`;
    const args=[activeContext.contextFingerprint,activeContext.contextFingerprint,activeContext.contextFingerprint,activeContext.contextFingerprint,scope.tenantId,scope.personId,activeContext.searchPlanId];
    const [rows,counts,captures]=await Promise.all([
      db.many<AcquisitionFeedRow>(`${cte} SELECT * FROM pipeline ORDER BY id,version LIMIT 100 OFFSET ?`,[...args,offset]),
      db.many<{state:string;count:number}>(`${cte} SELECT state,COUNT(*) AS count FROM pipeline GROUP BY state`,args),
      db.one<{n:number}>(`SELECT COUNT(*) AS n FROM acquisition_ingestion_lineage ail
        JOIN scrape_runs sr ON sr.id=ail.scrape_run_id AND sr.search_plan_id=?
        WHERE ail.tenant_id=? AND ail.person_id=?
          AND NOT EXISTS(SELECT 1 FROM acquisition_ingestion_lineage newer WHERE newer.scrape_run_id=ail.scrape_run_id AND newer.card_id=ail.card_id AND newer.ingestion_attempt>ail.ingestion_attempt)
          AND NOT EXISTS(SELECT 1 FROM search_plan_candidates spc WHERE spc.tenant_id=ail.tenant_id AND spc.person_id=ail.person_id AND spc.search_plan_id=sr.search_plan_id AND spc.canonical_job_id=ail.canonical_job_id AND spc.opportunity_version=ail.opportunity_version)`,[activeContext.searchPlanId,scope.tenantId,scope.personId]),
    ]);
    const total=counts.reduce((sum,row)=>sum+row.count,0);
    return {rows,counts,total,unadmittedCaptures:captures?.n||0,nextOffset:offset+rows.length<total?offset+rows.length:null};
}
