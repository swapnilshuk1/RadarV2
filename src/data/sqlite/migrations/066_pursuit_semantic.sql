-- 066: Pursuit semantic correction (schema only).
-- Classification of existing claims is a separate backfill; NULL is valid and
-- falls back to the deterministic classifier at runtime. No model dependency.
ALTER TABLE candidate_claims ADD COLUMN semantic_claim_type TEXT;
ALTER TABLE candidate_claims ADD COLUMN render_state TEXT;
ALTER TABLE candidate_claims ADD COLUMN classification_version TEXT;
ALTER TABLE candidate_claims ADD COLUMN classified_at TEXT;
CREATE INDEX IF NOT EXISTS idx_candidate_claims_semantic
  ON candidate_claims (tenant_id, person_id, semantic_claim_type);

-- Reasoning inputs (fingerprints, versions, dimensions, mappings, positioning)
-- so every strategy version stays explainable after regeneration.
ALTER TABLE pursuit_theses ADD COLUMN semantic_json TEXT;
