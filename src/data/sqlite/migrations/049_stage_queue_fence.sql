-- Staged work uses a fenced state family. Legacy binaries only claim pending/processing
-- and therefore cannot execute staged-v1 contexts during a rolling rollout.
UPDATE evaluation_jobs
SET status = 'staged_dead_letter',
    last_error = 'STAGED_CONTEXT_MISROUTED_LEGACY_WORKER',
    completed_at = CURRENT_TIMESTAMP,
    locked_by = NULL,
    lease_token = NULL,
    locked_at = NULL
WHERE status = 'completed'
  AND evaluation_context_fingerprint IN (
    SELECT context_fingerprint FROM evaluation_contexts WHERE policy_version = 'staged-v1'
  )
  AND NOT EXISTS (
    SELECT 1 FROM staged_evaluations se
    WHERE se.tenant_id = evaluation_jobs.tenant_id
      AND se.person_id = evaluation_jobs.person_id
      AND se.canonical_job_id = evaluation_jobs.canonical_job_id
      AND se.opportunity_version = evaluation_jobs.opportunity_version
      AND se.evaluation_context_fingerprint = evaluation_jobs.evaluation_context_fingerprint
  );

UPDATE evaluation_requirements
SET status = 'FAILED',
    blocked_reason = 'STAGED_CONTEXT_MISROUTED_LEGACY_WORKER'
WHERE evaluation_context_fingerprint IN (
    SELECT context_fingerprint FROM evaluation_contexts WHERE policy_version = 'staged-v1'
  )
  AND NOT EXISTS (
    SELECT 1 FROM staged_evaluations se
    WHERE se.tenant_id = evaluation_requirements.tenant_id
      AND se.person_id = evaluation_requirements.person_id
      AND se.canonical_job_id = evaluation_requirements.canonical_job_id
      AND se.opportunity_version = evaluation_requirements.opportunity_version
      AND se.evaluation_context_fingerprint = evaluation_requirements.evaluation_context_fingerprint
  )
  AND EXISTS (
    SELECT 1 FROM evaluation_jobs ej
    WHERE ej.tenant_id = evaluation_requirements.tenant_id
      AND ej.person_id = evaluation_requirements.person_id
      AND ej.search_plan_id = evaluation_requirements.search_plan_id
      AND ej.canonical_job_id = evaluation_requirements.canonical_job_id
      AND ej.opportunity_version = evaluation_requirements.opportunity_version
      AND ej.evaluation_context_fingerprint = evaluation_requirements.evaluation_context_fingerprint
      AND ej.last_error = 'STAGED_CONTEXT_MISROUTED_LEGACY_WORKER'
  );
