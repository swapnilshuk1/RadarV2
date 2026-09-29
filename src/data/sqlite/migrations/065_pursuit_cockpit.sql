-- 065_pursuit_cockpit.sql
--
-- The Pursuit Cockpit: the execution half of RADAR. Evaluation answers
-- "is this worth pursuing"; these tables answer "given this mandate and this
-- candidate, what is the highest-leverage way to pursue it".
--
-- Architecture contract honoured here:
--   * No parallel candidate document ingestion. candidate_documents and
--     evidence_graphs remain the canonical source of candidate truth;
--     candidate_claims is a searchable provenance-backed projection over them.
--   * Thesis and artifacts are versioned. Regenerating a thesis never silently
--     mutates work the candidate has already edited or sent.
--   * Preference learning is subordinate to truth: it records how the candidate
--     wants facts presented, never what the facts are.

-- ---------------------------------------------------------------------------
-- Evidence Ledger: normalized, provenance-backed projection of candidate truth
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS candidate_claims (
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
  -- Canonical lineage. source_document_id references the existing document
  -- repository; source_locator points at the exact span inside it.
  source_document_id TEXT,
  source_evidence_graph_id TEXT,
  source_fact_id TEXT,
  source_locator TEXT,
  -- SOURCE_BACKED = direct candidate evidence
  -- DERIVED       = defensible synthesis of several source facts
  -- TARGET_CONTEXT= fact about the company/mandate, not the candidate
  provenance TEXT NOT NULL DEFAULT 'SOURCE_BACKED',
  verification_state TEXT NOT NULL DEFAULT 'EXTRACTED',
  confidence REAL,
  metric_locked INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, person_id, source_fact_id)
);

CREATE INDEX IF NOT EXISTS idx_candidate_claims_scope
  ON candidate_claims(tenant_id, person_id, claim_type);
CREATE INDEX IF NOT EXISTS idx_candidate_claims_document
  ON candidate_claims(source_document_id);

-- ---------------------------------------------------------------------------
-- Positioning Archetypes: candidate-owned strategic lenses (not documents)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS candidate_archetypes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  name TEXT NOT NULL,
  positioning_statement TEXT,
  emphasize_json TEXT NOT NULL DEFAULT '[]',
  de_emphasize_json TEXT NOT NULL DEFAULT '[]',
  target_roles_json TEXT NOT NULL DEFAULT '[]',
  tone TEXT,
  pinned_claim_ids_json TEXT NOT NULL DEFAULT '[]',
  anchor_document_ids_json TEXT NOT NULL DEFAULT '[]',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, person_id, name)
);

CREATE INDEX IF NOT EXISTS idx_candidate_archetypes_scope
  ON candidate_archetypes(tenant_id, person_id);

-- ---------------------------------------------------------------------------
-- Pursuits: one candidate x one opportunity, with operational state
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS opportunity_pursuits (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  job_hash TEXT NOT NULL,
  company TEXT,
  role_title TEXT,
  active_archetype_id TEXT,
  active_thesis_id TEXT,
  status TEXT NOT NULL DEFAULT 'PREPARING',
  preparation_state TEXT NOT NULL DEFAULT 'QUEUED',
  preparation_error TEXT,
  next_action TEXT,
  next_action_due TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, person_id, job_hash)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_pursuits_scope
  ON opportunity_pursuits(tenant_id, person_id, status, updated_at DESC);

-- ---------------------------------------------------------------------------
-- Pursuit Thesis: the single strategic anchor, versioned
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pursuit_theses (
  id TEXT PRIMARY KEY,
  pursuit_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  archetype_id TEXT,
  target_mandate TEXT NOT NULL,
  win_theme TEXT NOT NULL,
  recommended_positioning TEXT NOT NULL,
  primary_proof_json TEXT NOT NULL DEFAULT '[]',
  objections_json TEXT NOT NULL DEFAULT '[]',
  narratives_to_avoid_json TEXT NOT NULL DEFAULT '[]',
  target_audience_json TEXT NOT NULL DEFAULT '[]',
  archetype_scores_json TEXT NOT NULL DEFAULT '[]',
  archetype_match_reasoning TEXT,
  route_strategy_json TEXT NOT NULL DEFAULT '[]',
  derivation TEXT NOT NULL DEFAULT 'DETERMINISTIC',
  model_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (pursuit_id, version),
  FOREIGN KEY (pursuit_id) REFERENCES opportunity_pursuits(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Pursuit Artifacts: versioned outputs. Regeneration never overwrites edits.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pursuit_artifacts (
  id TEXT PRIMARY KEY,
  pursuit_id TEXT NOT NULL,
  thesis_id TEXT,
  artifact_type TEXT NOT NULL,
  version INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  rendered_text TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  provenance_flags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (pursuit_id, artifact_type, version),
  FOREIGN KEY (pursuit_id) REFERENCES opportunity_pursuits(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pursuit_artifacts_lookup
  ON pursuit_artifacts(pursuit_id, artifact_type, version DESC);

-- ---------------------------------------------------------------------------
-- Pursuit Activities: lightweight operational history, not an ATS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pursuit_activities (
  id TEXT PRIMARY KEY,
  pursuit_id TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  channel TEXT,
  counterparty TEXT,
  summary TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (pursuit_id) REFERENCES opportunity_pursuits(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pursuit_activities_lookup
  ON pursuit_activities(pursuit_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Preference learning: style and selection only. Never a source of fact.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS candidate_learning_signals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  pursuit_id TEXT,
  archetype_id TEXT,
  signal_type TEXT NOT NULL,
  subject TEXT,
  original_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_candidate_learning_signals_scope
  ON candidate_learning_signals(tenant_id, person_id, signal_type, created_at DESC);
