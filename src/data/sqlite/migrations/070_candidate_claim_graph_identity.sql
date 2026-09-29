-- Each immutable EvidenceGraph owns its own claim generation. A fact ID reused
-- by a later extraction must not update a claim cited by an earlier thesis.
PRAGMA foreign_keys = OFF;

CREATE TABLE candidate_claims_070 (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  statement TEXT NOT NULL,
  claim_type TEXT NOT NULL,
  employer TEXT,
  role_title TEXT,
  metric_baseline TEXT,
  metric_result TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  source_document_id TEXT,
  source_evidence_graph_id TEXT,
  source_fact_id TEXT,
  source_locator TEXT,
  provenance TEXT NOT NULL DEFAULT 'SOURCE_BACKED',
  verification_state TEXT NOT NULL DEFAULT 'EXTRACTED',
  confidence REAL,
  metric_locked INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  semantic_claim_type TEXT,
  render_state TEXT,
  classification_version TEXT,
  classified_at TEXT,
  current_projection INTEGER NOT NULL DEFAULT 1,
  profile_version TEXT,
  source_ordinal INTEGER,
  UNIQUE (tenant_id, person_id, source_evidence_graph_id, source_fact_id)
);

INSERT INTO candidate_claims_070 (
  id,tenant_id,person_id,statement,claim_type,employer,role_title,metric_baseline,
  metric_result,capabilities_json,source_document_id,source_evidence_graph_id,
  source_fact_id,source_locator,provenance,verification_state,confidence,metric_locked,
  created_at,updated_at,semantic_claim_type,render_state,classification_version,
  classified_at,current_projection,profile_version,source_ordinal
)
SELECT
  id,tenant_id,person_id,statement,claim_type,employer,role_title,metric_baseline,
  metric_result,capabilities_json,source_document_id,source_evidence_graph_id,
  source_fact_id,source_locator,provenance,verification_state,confidence,metric_locked,
  created_at,updated_at,semantic_claim_type,render_state,classification_version,
  classified_at,current_projection,profile_version,source_ordinal
FROM candidate_claims;

DROP TABLE candidate_claims;
ALTER TABLE candidate_claims_070 RENAME TO candidate_claims;

CREATE INDEX idx_candidate_claims_scope
  ON candidate_claims(tenant_id, person_id, claim_type);
CREATE INDEX idx_candidate_claims_document
  ON candidate_claims(source_document_id);
CREATE INDEX idx_candidate_claims_semantic
  ON candidate_claims(tenant_id, person_id, semantic_claim_type);
CREATE INDEX idx_candidate_claims_current
  ON candidate_claims(tenant_id, person_id, current_projection);

CREATE TRIGGER candidate_claims_scope_required_insert
BEFORE INSERT ON candidate_claims
WHEN NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.person_id AND tenant_id = NEW.tenant_id)
BEGIN SELECT RAISE(ABORT, 'CANDIDATE_CLAIM_SCOPE_REQUIRED'); END;
CREATE TRIGGER candidate_claims_scope_required_update
BEFORE UPDATE OF tenant_id, person_id ON candidate_claims
BEGIN SELECT RAISE(ABORT, 'CANDIDATE_CLAIM_SCOPE_IMMUTABLE'); END;

PRAGMA foreign_keys = ON;
