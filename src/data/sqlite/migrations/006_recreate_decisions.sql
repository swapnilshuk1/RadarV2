-- ============================================================================
-- Migration 006: Recreate decisions table
-- ============================================================================
-- Context: Migration 002 (002_event_sourcing.sql) dropped the decisions table
-- as part of an event-sourcing experiment (DROP TABLE IF EXISTS decisions).
-- Migration 005 (005_decisions_unique.sql) then attempted to create a unique
-- index on the now-missing table — a schema inconsistency.
-- This migration recreates decisions as the canonical user decision store,
-- which the application actively uses via SqliteDecisionSupportStore.
-- ============================================================================

CREATE TABLE IF NOT EXISTS decisions (
  id                TEXT PRIMARY KEY,
  person_id         TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  opportunity_id    TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  action            TEXT NOT NULL CHECK(action IN ('PURSUE', 'CONSIDER', 'PASS')),
  reason            TEXT,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(person_id, opportunity_id)
);

-- Index for fast per-user decision lookups
CREATE INDEX IF NOT EXISTS idx_decisions_person
  ON decisions(person_id);

-- Composite index for the UPSERT conflict target
CREATE INDEX IF NOT EXISTS idx_decisions_person_op
  ON decisions(person_id, opportunity_id);
