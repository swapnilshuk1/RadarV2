-- Migration 024: Add posted_precision to opportunity_versions

-- This tracks whether a posting date is EXACT, RELATIVE_ESTIMATE, LOWER_BOUND, or UNKNOWN
ALTER TABLE opportunity_versions ADD COLUMN posted_precision TEXT DEFAULT 'UNKNOWN';
