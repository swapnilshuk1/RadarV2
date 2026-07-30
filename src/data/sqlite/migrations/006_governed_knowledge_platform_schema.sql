-- Migration 006: Governed Executive Knowledge Platform Schema
-- Created for RADAR v2 Phase 5

-- ============================================================================
-- 1. ASYNCHRONOUS EVIDENCE CLUSTERS & KNOWLEDGE DEBT
-- ============================================================================

CREATE TABLE IF NOT EXISTS ekb_evidence_clusters (
  id TEXT PRIMARY KEY,
  concept_stem TEXT NOT NULL,
  cv_document_count INTEGER DEFAULT 0,
  jd_document_count INTEGER DEFAULT 0,
  recruiter_note_count INTEGER DEFAULT 0,
  sample_snippets_json TEXT NOT NULL,
  adaptive_threshold REAL NOT NULL,    -- Calculated threshold based on rarity & domain
  status TEXT NOT NULL,                -- 'COLLECTING' | 'THRESHOLD_REACHED' | 'PROPOSED'
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ekb_knowledge_debt (
  id TEXT PRIMARY KEY,
  term_or_node TEXT NOT NULL,
  debt_category TEXT NOT NULL,         -- 'COMPILER_REJECTION' | 'AMBIGUOUS_ALIAS' | 'LOW_CONFIDENCE'
  diagnostic_message TEXT NOT NULL,
  document_count INTEGER DEFAULT 1,
  status TEXT NOT NULL,                -- 'ACTIVE' | 'RESOLVED' | 'EXPIRED'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 2. MULTI-LAYERED GRAPH PROJECTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS ekb_published_capability_graph (
  version_id TEXT NOT NULL,
  source_capability_id TEXT NOT NULL,
  target_capability_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,        -- 'SUPPORTS' | 'DRIVES' | 'ENABLES'
  cost REAL NOT NULL,
  PRIMARY KEY (version_id, source_capability_id, target_capability_id)
);

CREATE TABLE IF NOT EXISTS ekb_published_mobility_graph (
  version_id TEXT NOT NULL,
  source_title TEXT NOT NULL,
  target_title TEXT NOT NULL,
  transition_frequency INTEGER NOT NULL,
  friction_cost REAL NOT NULL,
  PRIMARY KEY (version_id, source_title, target_title)
);

CREATE TABLE IF NOT EXISTS ekb_published_platform_graph (
  version_id TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  platform_vendor TEXT NOT NULL,
  product_name TEXT NOT NULL,
  PRIMARY KEY (version_id, capability_id, product_name)
);

-- ============================================================================
-- 3. DECOUPLED RELEASE CADENCE & PROMOTION GATES
-- ============================================================================

CREATE TABLE IF NOT EXISTS ekb_release_candidates (
  version_id TEXT PRIMARY KEY,        -- e.g. '14.3.0'
  status TEXT NOT NULL,               -- 'COMPILED' | 'CANDIDATE' | 'PROMOTED' | 'PUBLISHED'
  compilation_report_json TEXT NOT NULL,
  compiled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  published_at DATETIME
);
