-- Preserve immutable first-claim period separately from token reservation month.
ALTER TABLE quota_jobs ADD COLUMN first_month TEXT NOT NULL DEFAULT '';
UPDATE quota_jobs SET first_month=substr(day,1,7);
ALTER TABLE quota_jobs ADD COLUMN invalid_reviewed_count INTEGER NOT NULL DEFAULT 0;
UPDATE quota_jobs SET invalid_reviewed_count=(SELECT COUNT(*) FROM quota_calls c
 WHERE c.pipeline=quota_jobs.pipeline AND c.job_id=quota_jobs.job_id
 AND c.status='invalid_output' AND c.started_at<=quota_jobs.invalid_reviewed_at);
CREATE INDEX quota_calls_job_status ON quota_calls(tenant_id,pipeline,job_id,status);
CREATE INDEX quota_calls_month ON quota_calls(tenant_id,month);
CREATE TABLE quota_legacy_leases (
 pipeline TEXT NOT NULL, job_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
 lease_token TEXT NOT NULL, lease_until INTEGER NOT NULL,
 PRIMARY KEY(pipeline,job_id)
);
-- Grandfather only actual processing leases that predate migration/activation.
INSERT INTO quota_legacy_leases SELECT 'evaluation',id,tenant_id,lease_token,
 CAST((julianday(locked_at)-2440587.5)*86400000 AS INTEGER)+300000
 FROM evaluation_jobs j WHERE status='staged_processing' AND lease_token IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM quota_jobs q WHERE q.pipeline='evaluation' AND q.job_id=j.id);
INSERT INTO quota_legacy_leases SELECT 'dossier',id,tenant_id,lease_token,lease_until
 FROM dossier_composition_jobs j WHERE status='processing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM quota_jobs q WHERE q.pipeline='dossier' AND q.job_id=j.id);
INSERT INTO quota_legacy_leases SELECT 'factual_review',id,tenant_id,lease_token,lease_until
 FROM dossier_review_jobs j WHERE status='processing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM quota_jobs q WHERE q.pipeline='factual_review' AND q.job_id=j.id);
INSERT INTO quota_legacy_leases SELECT 'pursuit',id,tenant_id,lease_token,
 CAST((julianday(lease_expires_at)-2440587.5)*86400000 AS INTEGER)
 FROM pursuit_preparation_jobs j WHERE status='processing' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM quota_jobs q WHERE q.pipeline='pursuit' AND q.job_id=j.id);
