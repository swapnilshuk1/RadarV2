-- ============================================================================
-- Sprint 3A: Event Sourcing & CQRS Foundation
-- ============================================================================

-- 1. Create workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  configuration_version TEXT NOT NULL,
  
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  
  meta_schema_version TEXT NOT NULL,
  meta_extractor_version TEXT,
  meta_prompt_version TEXT,
  meta_model TEXT,
  meta_run_id TEXT,
  meta_timestamp TEXT NOT NULL
);

-- 2. Create recommendation_snapshots table
CREATE TABLE IF NOT EXISTS recommendation_snapshots (
  id TEXT PRIMARY KEY,
  snapshot_hash TEXT NOT NULL,
  person_id TEXT NOT NULL,
  opportunity_id TEXT NOT NULL,
  recommendation_id TEXT NOT NULL,
  
  confidence REAL NOT NULL,
  summary TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  graph_version TEXT NOT NULL,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  
  meta_schema_version TEXT NOT NULL,
  meta_extractor_version TEXT,
  meta_prompt_version TEXT,
  meta_model TEXT,
  meta_run_id TEXT,
  meta_timestamp TEXT NOT NULL
);

-- 3. Create timeline_events table (Hybrid Schema)
CREATE TABLE IF NOT EXISTS timeline_events (
  id TEXT PRIMARY KEY, -- ULID / UUIDv7
  workspace_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  opportunity_id TEXT, -- Optional (e.g. for user-level events)
  
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  
  event_category TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,
  
  recommendation_snapshot_id TEXT, -- Foreign Key
  
  payload_json TEXT NOT NULL, -- Typed JSON payload
  metadata_json TEXT NOT NULL, -- UI context, user agent, etc.

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  
  meta_schema_version TEXT NOT NULL,
  meta_extractor_version TEXT,
  meta_prompt_version TEXT,
  meta_model TEXT,
  meta_run_id TEXT,
  meta_timestamp TEXT NOT NULL
);

-- Indexes for Timeline Events (Crucial for Replay & Projections)
CREATE INDEX idx_timeline_events_occurred_at ON timeline_events(occurred_at);
CREATE INDEX idx_timeline_events_aggregate ON timeline_events(aggregate_type, aggregate_id);
CREATE INDEX idx_timeline_events_workspace ON timeline_events(workspace_id);
CREATE INDEX idx_timeline_events_person ON timeline_events(person_id);
CREATE INDEX idx_timeline_events_category ON timeline_events(event_category);
CREATE INDEX idx_timeline_events_type ON timeline_events(event_type);

-- 4. Deprecate mutable tables
DROP TABLE IF EXISTS decisions;
DROP TABLE IF EXISTS outcomes;
