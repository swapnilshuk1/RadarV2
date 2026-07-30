-- ============================================================================
-- Migration 008: Formal Profile & Projection queryable columns
-- ============================================================================

-- Add candidate_state to people (missed in 007)
ALTER TABLE people ADD COLUMN candidate_state TEXT;

-- Enhance career_profiles to store the canonical projection and queryable scalar values
CREATE TABLE IF NOT EXISTS career_profiles (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people(id),
    timeline TEXT NOT NULL,
    skills TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE career_profiles ADD COLUMN projection_json TEXT;
ALTER TABLE career_profiles ADD COLUMN projection_generated_at DATETIME;
ALTER TABLE career_profiles ADD COLUMN current_title TEXT;
ALTER TABLE career_profiles ADD COLUMN years_experience INTEGER;
ALTER TABLE career_profiles ADD COLUMN archetype TEXT;
ALTER TABLE career_profiles ADD COLUMN preferred_work_model TEXT;
