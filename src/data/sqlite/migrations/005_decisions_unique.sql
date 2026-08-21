-- Migration 005: Add unique index on decisions(person_id, opportunity_id) for upserts
CREATE UNIQUE INDEX IF NOT EXISTS idx_decisions_person_op ON decisions(person_id, opportunity_id);


