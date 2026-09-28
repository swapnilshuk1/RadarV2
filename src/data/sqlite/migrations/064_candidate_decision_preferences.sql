-- Candidate-authored decision preferences are versioned with career intent.
-- NULL means the candidate has not specified these preferences.
ALTER TABLE career_intents ADD COLUMN decision_preferences_json TEXT;
