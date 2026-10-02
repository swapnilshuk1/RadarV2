import {
  RICH_DOSSIER_FAILURE_VERSION,
  RICH_DOSSIER_VERSION,
} from "@/data/sqlite/repositories/SqliteRichDossierStore";

/** One lifecycle definition for the scoped feed, filters and decision ledger. */
export const acquisitionPipelineStateSql = `CASE
  WHEN EXISTS(SELECT 1 FROM recovery_queue rq WHERE rq.tenant_id=spc.tenant_id AND rq.canonical_job_id=spc.canonical_job_id AND rq.opportunity_version_id=spc.opportunity_version AND rq.reason='SOURCE_NOT_JOB_DESCRIPTION') THEN 'NEEDS_ATTENTION'
  WHEN se.evaluation_state='COMPLETED' AND se.decision='PASS' THEN 'NOT_PURSUED'
  WHEN me.evaluation_state='STAGED_EVALUATED' AND me.decision IN ('PURSUE','CONSIDER')
    AND LENGTH(TRIM(me.evaluation_fingerprint))>0 AND me.quality_score IS NULL
    AND json_valid(me.evaluation_json) AND json_extract(me.evaluation_json,'$.presentationVersion')='${RICH_DOSSIER_VERSION}'
    AND EXISTS(SELECT 1 FROM materialized_dossier_presentations p WHERE p.tenant_id=spc.tenant_id AND p.person_id=spc.person_id
      AND p.canonical_job_id=spc.canonical_job_id AND p.opportunity_version=spc.opportunity_version
      AND p.evaluation_context_fingerprint=me.evaluation_context_fingerprint AND p.presentation_version='${RICH_DOSSIER_VERSION}'
      AND p.source_evaluation_fingerprint=me.evaluation_fingerprint) THEN 'READY'
  WHEN er.status='FAILED' OR ej.status='staged_dead_letter' OR se.evaluation_state='INPUT_UNAVAILABLE'
    OR ov.acquisition_status IN ('CAPTURE_FAILED','RECOVERY_FAILED')
    OR EXISTS(SELECT 1 FROM materialized_dossier_presentations p WHERE p.tenant_id=spc.tenant_id AND p.person_id=spc.person_id
      AND p.canonical_job_id=spc.canonical_job_id AND p.opportunity_version=spc.opportunity_version
      AND p.evaluation_context_fingerprint=COALESCE(se.evaluation_context_fingerprint,er.evaluation_context_fingerprint,me.evaluation_context_fingerprint)
      AND p.presentation_version='${RICH_DOSSIER_FAILURE_VERSION}') THEN 'NEEDS_ATTENTION'
  WHEN spc.attention_decision='NOT_CANDIDATE' THEN 'OUTSIDE_SEARCH'
  WHEN ej.status='staged_processing' THEN 'PROCESSING'
  WHEN ej.status='staged_completed' OR (se.evaluation_state='COMPLETED' AND se.decision IN ('PURSUE','CONSIDER')) THEN 'PREPARING'
  ELSE 'WAITING' END`;
