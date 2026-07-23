-- Migration 004: Rename career_profiles to candidate_projection and add intent table

-- 1. Rename career_profiles to candidate_projection
ALTER TABLE career_profiles RENAME TO candidate_projection;

-- 2. Add claims column to candidate_projection
ALTER TABLE candidate_projection ADD COLUMN claims TEXT;

-- 3. Create the intent table to represent active future targets
CREATE TABLE IF NOT EXISTS intent (
    id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL,
    desired_roles TEXT NOT NULL, -- JSON array of strings
    preferred_locations TEXT NOT NULL, -- JSON array of strings
    salary_band TEXT NOT NULL, -- JSON object
    industries TEXT NOT NULL, -- JSON array of strings
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(candidate_id) REFERENCES people(id)
);
