-- 048_staged_intelligence_evaluations.sql
-- Additive staged-intelligence persistence. Legacy intrinsic materializations remain untouched.
CREATE TABLE IF NOT EXISTS profile_projection_source_bindings (
  person_id TEXT NOT NULL, profile_version TEXT NOT NULL, document_id TEXT NOT NULL,
  evidence_graph_id TEXT NOT NULL, document_text_hash TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (person_id, profile_version, document_id),
  UNIQUE (person_id, profile_version, evidence_graph_id),
  FOREIGN KEY (person_id) REFERENCES people(id),
  FOREIGN KEY (document_id) REFERENCES candidate_documents(id),
  FOREIGN KEY (evidence_graph_id) REFERENCES evidence_graphs(id)
);
CREATE INDEX IF NOT EXISTS idx_projection_source_binding_exact ON profile_projection_source_bindings(person_id, profile_version);
CREATE TABLE IF NOT EXISTS staged_source_evidence_cache (
  source_fingerprint TEXT NOT NULL, extraction_contract_version TEXT NOT NULL,
  model_id TEXT NOT NULL, model_version TEXT NOT NULL, source_json TEXT NOT NULL,
  claims_json TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_fingerprint, extraction_contract_version, model_id, model_version)
);
CREATE TABLE IF NOT EXISTS staged_evaluations (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, person_id TEXT NOT NULL,
  canonical_job_id TEXT NOT NULL, opportunity_version TEXT NOT NULL, job_hash TEXT NOT NULL,
  evaluation_context_fingerprint TEXT NOT NULL, profile_version TEXT NOT NULL,
  policy_version TEXT NOT NULL, ontology_version TEXT NOT NULL, ontology_fingerprint TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL, source_fingerprints_json TEXT NOT NULL,
  model_id TEXT NOT NULL, model_version TEXT NOT NULL, contract_version TEXT NOT NULL,
  evaluation_state TEXT NOT NULL CHECK(evaluation_state IN ('COMPLETED', 'INPUT_UNAVAILABLE')),
  decision TEXT CHECK(decision IN ('PURSUE', 'CONSIDER', 'PASS')),
  screening_viability TEXT CHECK(screening_viability IN ('STRONG', 'PLAUSIBLE', 'FRAGILE', 'BLOCKED')),
  blocked_reason TEXT, evaluation_json TEXT NOT NULL, evaluated_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_staged_evaluations_scope ON staged_evaluations(tenant_id, person_id, decision, evaluated_at DESC);
