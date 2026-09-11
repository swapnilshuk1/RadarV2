-- Migration 044: First-class derived presentation persistence table
-- Decouples presentation artifacts from materialized_evaluations.evaluation_json.
-- PRIMARY KEY ensures one active presentation per presentation_version under an identity.
-- source_evaluation_fingerprint is NULL for source-only presentations and NOT part of PK,
-- allowing clean overwrite when an evaluated presentation becomes available.

CREATE TABLE IF NOT EXISTS materialized_dossier_presentations (
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  canonical_job_id TEXT NOT NULL,
  opportunity_version TEXT NOT NULL,
  evaluation_context_fingerprint TEXT NOT NULL,
  presentation_version TEXT NOT NULL,
  source_evaluation_fingerprint TEXT,
  presentation_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (
    tenant_id,
    person_id,
    canonical_job_id,
    opportunity_version,
    evaluation_context_fingerprint,
    presentation_version
  )
);

CREATE INDEX IF NOT EXISTS idx_mat_dossier_pres_identity
  ON materialized_dossier_presentations (
    tenant_id,
    person_id,
    canonical_job_id,
    opportunity_version,
    evaluation_context_fingerprint,
    presentation_version
  );
