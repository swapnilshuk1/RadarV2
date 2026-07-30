-- Migration 006: Governed Executive Knowledge Base (EKB) Schema
-- Created for RADAR v2 Phase 5

-- ============================================================================
-- 1. PIPELINE TABLES (DRAFT / STAGING / WORK-IN-PROGRESS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ekb_pipeline_raw_observations (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  source_type TEXT NOT NULL,          -- 'CANDIDATE_CV' | 'JOB_DESCRIPTION' | 'RECRUITER_FEEDBACK'
  raw_term TEXT NOT NULL,
  normalized_stem TEXT NOT NULL,
  context_snippet TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ekb_pipeline_candidate_capabilities (
  id TEXT PRIMARY KEY,
  suggested_name TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  discipline_id TEXT NOT NULL,
  maturity_stage TEXT NOT NULL,       -- 'OBSERVED' | 'CANDIDATE' | 'VERIFIED'
  observation_count INTEGER DEFAULT 1,
  compiler_confidence REAL DEFAULT 0.0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ekb_pipeline_proposals (
  id TEXT PRIMARY KEY,
  proposal_type TEXT NOT NULL,        -- 'NEW_CAPABILITY' | 'NEW_ALIAS' | 'RELATIONSHIP_DRIFT'
  proposal_json TEXT NOT NULL,
  status TEXT NOT NULL,               -- 'PENDING' | 'NORMALIZED' | 'COMPILED' | 'REJECTED'
  rejection_reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 2. RUNTIME CANONICAL TABLES (PUBLISHED RELEASES ONLY)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ekb_published_versions (
  id TEXT PRIMARY KEY,                -- e.g. '14.2.1'
  major INTEGER NOT NULL,
  minor INTEGER NOT NULL,
  patch INTEGER NOT NULL,
  status TEXT NOT NULL,               -- 'STAGING' | 'QUALITY_TESTED' | 'PROMOTED' | 'PUBLISHED' | 'DEPRECATED'
  quality_report_json TEXT NOT NULL,
  promoted_by TEXT,
  published_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ekb_published_capabilities (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  discipline_id TEXT NOT NULL,
  description TEXT,
  FOREIGN KEY (version_id) REFERENCES ekb_published_versions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ekb_published_aliases (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  alias_term TEXT NOT NULL,
  normalized_stem TEXT NOT NULL,
  FOREIGN KEY (capability_id) REFERENCES ekb_published_capabilities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ekb_published_embeddings (
  capability_id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  vector_json TEXT NOT NULL,          -- JSON array of float dimensions
  model_identifier TEXT NOT NULL,
  FOREIGN KEY (capability_id) REFERENCES ekb_published_capabilities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ekb_published_relationships (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  source_capability_id TEXT NOT NULL,
  target_capability_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,        -- 'SUPPORTS' | 'DRIVES' | 'ENABLES' | 'TRANSITIONS_TO'
  statistical_cost REAL NOT NULL,     -- 0.05 to 0.80
  confidence REAL NOT NULL,
  derived_from TEXT NOT NULL,         -- e.g. '412 executive transitions'
  algorithm_version TEXT NOT NULL,    -- e.g. 'MobilityModel v3'
  last_recomputed DATETIME NOT NULL,
  FOREIGN KEY (version_id) REFERENCES ekb_published_versions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ekb_evidence_provenance (
  id TEXT PRIMARY KEY,
  capability_id TEXT NOT NULL,
  cv_count INTEGER DEFAULT 0,
  jd_count INTEGER DEFAULT 0,
  recruiter_count INTEGER DEFAULT 0,
  compiler_confidence REAL NOT NULL,
  version_id TEXT NOT NULL,
  FOREIGN KEY (capability_id) REFERENCES ekb_published_capabilities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ekb_temporal_evidence (
  id TEXT PRIMARY KEY,
  capability_id TEXT NOT NULL,
  year_month TEXT NOT NULL,           -- e.g. '2026-07'
  cv_frequency INTEGER DEFAULT 0,
  jd_frequency INTEGER DEFAULT 0,
  recruiter_frequency INTEGER DEFAULT 0,
  extraction_confidence REAL NOT NULL,
  evidence_confidence REAL NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (capability_id) REFERENCES ekb_published_capabilities(id) ON DELETE CASCADE
);
