CREATE INDEX idx_acq_freshness ON acquisition_ledger (freshness_state);

CREATE INDEX idx_acq_portal_state ON acquisition_ledger (source_portal, state);

CREATE INDEX idx_acq_state_lease ON acquisition_ledger (state, lease_expires_at);

CREATE INDEX idx_assess_rec_sig ON assessment_records(evaluation_signature);

CREATE INDEX idx_auth_sessions_user
  ON auth_sessions(user_id);

CREATE INDEX idx_candidate_documents_hash ON candidate_documents(document_hash);

CREATE INDEX idx_candidate_documents_person ON candidate_documents(person_id);

CREATE INDEX idx_candidate_evaluations_input_hash
  ON candidate_evaluations (person_id, evaluation_input_hash);

CREATE INDEX idx_canonical_decisions_person 
  ON canonical_decisions(tenant_id, person_id);

CREATE INDEX idx_canonical_opps_source
    ON canonical_opportunities(source, source_job_id);

CREATE INDEX idx_career_intents_person ON career_intents(person_id);

CREATE INDEX idx_credential_audit_logs_lookup 
    ON credential_audit_logs(tenant_id, credential_id, created_at);

CREATE UNIQUE INDEX idx_decisions_person_op ON decisions(person_id, opportunity_id);

CREATE INDEX idx_doc_contents_doc ON document_contents(document_id);

CREATE INDEX idx_doc_contents_hash ON document_contents(text_hash);

CREATE INDEX idx_dossier_views_sig ON dossier_views(evaluation_signature);

CREATE INDEX idx_eval_contexts_tenant_person
    ON evaluation_contexts(tenant_id, person_id);

CREATE INDEX idx_eval_jobs_claim_lease 
    ON evaluation_jobs(status, locked_at);

CREATE INDEX idx_eval_jobs_status_next_attempt 
    ON evaluation_jobs(status, next_attempt_at);

CREATE INDEX idx_eval_sig_hash ON evaluation_signatures(evaluation_signature);

CREATE INDEX idx_eval_sig_job_candidate ON evaluation_signatures(job_hash, candidate_id);

CREATE INDEX idx_evidence_graphs_document ON evidence_graphs(document_id);

CREATE INDEX idx_evidence_graphs_person ON evidence_graphs(person_id);

CREATE INDEX idx_mat_eval_opp_ver
    ON materialized_evaluations(canonical_job_id, opportunity_version);

CREATE INDEX idx_mat_eval_tenant_person
    ON materialized_evaluations(tenant_id, person_id);

CREATE INDEX idx_materialized_eval_state
    ON materialized_evaluations(tenant_id, person_id, evaluation_state);

CREATE INDEX idx_opp_versions_canonical
    ON opportunity_versions(canonical_job_id);

CREATE INDEX idx_people_tenant_id ON people(tenant_id);

CREATE UNIQUE INDEX idx_people_tenant_lineage ON people(id, tenant_id);

CREATE UNIQUE INDEX idx_recovery_queue_active_version
    ON recovery_queue(opportunity_version_id)
    WHERE status IN ('PENDING', 'PROCESSING');

CREATE INDEX idx_recovery_queue_opp
    ON recovery_queue(canonical_job_id, opportunity_version_id);

CREATE INDEX idx_recovery_queue_status_next
    ON recovery_queue(status, next_attempt_at);

CREATE INDEX idx_search_plan_candidates_plan
    ON search_plan_candidates(search_plan_id);

CREATE INDEX idx_search_plan_candidates_tenant_person
    ON search_plan_candidates(tenant_id, person_id);

CREATE INDEX idx_search_plan_snapshots_tenant_person
    ON search_plan_snapshots(tenant_id, person_id);

CREATE UNIQUE INDEX idx_search_plans_lineage ON search_plans(id, tenant_id, person_id);

CREATE INDEX idx_search_plans_tenant_person
    ON search_plans(tenant_id, person_id);

CREATE INDEX idx_source_credentials_status 
    ON source_credentials(status);

CREATE INDEX idx_source_credentials_tenant_source 
    ON source_credentials(tenant_id, source, status);

CREATE TABLE _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migration_name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

CREATE TABLE _test_contract (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        val INTEGER
      );

CREATE TABLE acquisition_ledger (
          id TEXT PRIMARY KEY,
          canonical_job_id TEXT NOT NULL,
          source_portal TEXT NOT NULL,
          source_job_id TEXT NOT NULL,
          canonical_url TEXT NOT NULL,
          title TEXT NOT NULL,
          company_name TEXT NOT NULL,
          location TEXT,
          state TEXT NOT NULL DEFAULT 'DISCOVERED',
          terminal_state TEXT,
          claimed_by TEXT,
          claimed_at TEXT,
          lease_expires_at TEXT,
          attempt_count INTEGER DEFAULT 0,
          last_failure_class TEXT,
          last_acquisition_method TEXT,
          acquisition_quality TEXT,
          validation_confidence TEXT,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          last_acquired_at TEXT,
          freshness_state TEXT DEFAULT 'NEW',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CONSTRAINT uq_portal_canonical UNIQUE (source_portal, canonical_job_id)
        );

CREATE TABLE active_evaluation_contexts (
    tenant_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    search_plan_id TEXT NOT NULL,
    context_fingerprint TEXT NOT NULL,
    activated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    activated_by TEXT NOT NULL,
    PRIMARY KEY (tenant_id, person_id, search_plan_id),
    FOREIGN KEY (context_fingerprint, tenant_id, person_id, search_plan_id) 
        REFERENCES evaluation_context_scopes(context_fingerprint, tenant_id, person_id, search_plan_id)
);

CREATE TABLE assessment_records (
    id TEXT PRIMARY KEY,
    evaluation_signature TEXT NOT NULL UNIQUE,
    job_hash TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    record_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (evaluation_signature) REFERENCES evaluation_signatures(evaluation_signature) ON DELETE CASCADE
);

CREATE TABLE assessments (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL UNIQUE,
    capability_score REAL NOT NULL,
    career_growth_score REAL NOT NULL,
    leadership_scope_score REAL NOT NULL,
    compensation_score REAL NOT NULL,
    industry_alignment_score REAL NOT NULL,
    location_fit_score REAL NOT NULL,
    lifestyle_score REAL NOT NULL,
    confidence_score REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
    meta_extractor_version TEXT,
    meta_prompt_version TEXT,
    meta_model TEXT,
    meta_run_id TEXT,
    meta_timestamp DATETIME,
    FOREIGN KEY(match_id) REFERENCES matches(id)
);

CREATE TABLE auth_sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL   -- Unix timestamp (seconds)
);

CREATE TABLE calibration_runs (
        id TEXT PRIMARY KEY,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        policy_version TEXT,
        profile_hash TEXT,
        corpus_hash TEXT,
        volatility REAL,
        excellent_count INTEGER,
        good_count INTEGER,
        average_count INTEGER,
        weak_count INTEGER,
        insufficient_count INTEGER,
        avg_score REAL,
        avg_confidence REAL
      );

CREATE TABLE candidate_documents (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    storage_uri TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    document_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'UPLOADED',
    stage TEXT NOT NULL DEFAULT 'DOCUMENT_UPLOADED',
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(person_id) REFERENCES people(id)
);

CREATE TABLE candidate_evaluations (
              person_id              TEXT NOT NULL,
              job_hash               TEXT NOT NULL,
              policy_version         TEXT NOT NULL,
              evaluation_input_hash  TEXT NOT NULL,
              engine_verdict         TEXT NOT NULL CHECK(engine_verdict IN ('PURSUE', 'CONSIDER', 'PASS')),
              engine_quality_score   REAL NOT NULL,
              user_decision_override TEXT CHECK(user_decision_override IN ('PURSUE', 'CONSIDER', 'PASS')),
              effective_decision     TEXT NOT NULL CHECK(effective_decision IN ('PURSUE', 'CONSIDER', 'PASS')),
              quality_score          REAL NOT NULL,
              evaluation_status      TEXT NOT NULL DEFAULT 'COMPLETE' CHECK(evaluation_status IN ('COMPLETE', 'SPARSE_SPEC', 'DEFERRED', 'FAILED')),
              evaluation_json        TEXT NOT NULL,
              updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
              PRIMARY KEY (person_id, job_hash)
            );

CREATE TABLE "candidate_projection" (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    timeline TEXT NOT NULL, -- JSON array
    skills TEXT NOT NULL, -- JSON array
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
    meta_extractor_version TEXT,
    meta_prompt_version TEXT,
    meta_model TEXT,
    meta_run_id TEXT,
    meta_timestamp DATETIME, claims TEXT,
    FOREIGN KEY(person_id) REFERENCES people(id)
);

CREATE TABLE canonical_decisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  canonical_job_id TEXT NOT NULL REFERENCES canonical_opportunities(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('PURSUE', 'CONSIDER', 'PASS')),
  reason TEXT,
  reviewed_fingerprint TEXT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (person_id, tenant_id) REFERENCES people(id, tenant_id),
  UNIQUE(tenant_id, person_id, canonical_job_id)
);

CREATE TABLE canonical_opportunities (
    id TEXT PRIMARY KEY,     source TEXT NOT NULL,
    source_job_id TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    company_name TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source, source_job_id)
);

CREATE TABLE career_intents (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    min_salary_usd INTEGER,
    preferred_locations TEXT, -- JSON array string
    target_titles TEXT,       -- JSON array string
    preferred_work_model TEXT DEFAULT 'ANY',
    travel_tolerance TEXT DEFAULT 'MEDIUM',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(person_id) REFERENCES people(id)
);

CREATE TABLE career_profiles (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people(id),
    timeline TEXT NOT NULL,
    skills TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
, projection_json TEXT, projection_generated_at DATETIME, current_title TEXT, years_experience INTEGER, archetype TEXT, preferred_work_model TEXT);

CREATE TABLE claim_facts (
    claim_id TEXT NOT NULL,
    fact_id TEXT NOT NULL,
    PRIMARY KEY (claim_id, fact_id),
    FOREIGN KEY(claim_id) REFERENCES claims(id),
    FOREIGN KEY(fact_id) REFERENCES facts(id)
);

CREATE TABLE claims (
    id TEXT PRIMARY KEY,
    opportunity_id TEXT NOT NULL,
    statement TEXT NOT NULL,
    confidence REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
    meta_extractor_version TEXT,
    meta_prompt_version TEXT,
    meta_model TEXT,
    meta_run_id TEXT,
    meta_timestamp DATETIME,
    FOREIGN KEY(opportunity_id) REFERENCES opportunities(id)
);

CREATE TABLE companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    industry TEXT,
    hq TEXT,
    size TEXT,
    tech_stack TEXT, -- JSON array
    hiring_velocity REAL,
    growth_signal TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
    meta_extractor_version TEXT,
    meta_prompt_version TEXT,
    meta_model TEXT,
    meta_run_id TEXT,
    meta_timestamp DATETIME
);

CREATE TABLE credential_audit_logs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    credential_id TEXT NOT NULL,
    action TEXT NOT NULL,     actor_user_id TEXT,
    details TEXT,     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON DELETE RESTRICT,

    FOREIGN KEY (credential_id)
        REFERENCES source_credentials(id)
        ON DELETE CASCADE
);

CREATE TABLE decisions (id TEXT PRIMARY KEY, person_id TEXT NOT NULL, opportunity_id TEXT NOT NULL, recommendation_id TEXT, action TEXT NOT NULL, reason TEXT, lifecycle TEXT NOT NULL DEFAULT 'ACTIVE', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, meta_schema_version TEXT, meta_extractor_version TEXT, meta_prompt_version TEXT, meta_model TEXT, meta_run_id TEXT, meta_timestamp DATETIME, reviewed_fingerprint TEXT);

CREATE TABLE document_contents (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL UNIQUE,
    raw_text TEXT NOT NULL,
    text_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(document_id) REFERENCES candidate_documents(id)
);

CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    opportunity_id TEXT,
    payload_type TEXT NOT NULL,
    content TEXT NOT NULL,
    lifecycle TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
    meta_extractor_version TEXT,
    meta_prompt_version TEXT,
    meta_model TEXT,
    meta_run_id TEXT,
    meta_timestamp DATETIME,
    FOREIGN KEY(source_id) REFERENCES sources(id),
    FOREIGN KEY(opportunity_id) REFERENCES opportunities(id)
);

CREATE TABLE dossier_views (
    id TEXT PRIMARY KEY,
    evaluation_signature TEXT NOT NULL UNIQUE,
    job_hash TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    presented_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (evaluation_signature) REFERENCES evaluation_signatures(evaluation_signature) ON DELETE CASCADE
);

CREATE TABLE ekb_evidence_clusters (
  id TEXT PRIMARY KEY,
  concept_stem TEXT NOT NULL,
  cv_document_count INTEGER DEFAULT 0,
  jd_document_count INTEGER DEFAULT 0,
  recruiter_note_count INTEGER DEFAULT 0,
  sample_snippets_json TEXT NOT NULL,
  adaptive_threshold REAL NOT NULL,    -- Calculated threshold based on rarity & domain
  status TEXT NOT NULL,                -- 'COLLECTING' | 'THRESHOLD_REACHED' | 'PROPOSED'
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ekb_evidence_provenance (
  id TEXT PRIMARY KEY,
  capability_id TEXT NOT NULL,
  cv_count INTEGER DEFAULT 0,
  jd_count INTEGER DEFAULT 0,
  recruiter_count INTEGER DEFAULT 0,
  compiler_confidence REAL NOT NULL,
  version_id TEXT NOT NULL,
  FOREIGN KEY (capability_id) REFERENCES ekb_published_capabilities(id) ON DELETE CASCADE
);

CREATE TABLE ekb_knowledge_debt (
  id TEXT PRIMARY KEY,
  term_or_node TEXT NOT NULL,
  debt_category TEXT NOT NULL,         -- 'COMPILER_REJECTION' | 'AMBIGUOUS_ALIAS' | 'LOW_CONFIDENCE'
  diagnostic_message TEXT NOT NULL,
  document_count INTEGER DEFAULT 1,
  status TEXT NOT NULL,                -- 'ACTIVE' | 'RESOLVED' | 'EXPIRED'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ekb_pipeline_candidate_capabilities (
  id TEXT PRIMARY KEY,
  suggested_name TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  discipline_id TEXT NOT NULL,
  maturity_stage TEXT NOT NULL,       -- 'OBSERVED' | 'CANDIDATE' | 'VERIFIED'
  observation_count INTEGER DEFAULT 1,
  compiler_confidence REAL DEFAULT 0.0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ekb_pipeline_proposals (
  id TEXT PRIMARY KEY,
  proposal_type TEXT NOT NULL,        -- 'NEW_CAPABILITY' | 'NEW_ALIAS' | 'RELATIONSHIP_DRIFT'
  proposal_json TEXT NOT NULL,
  status TEXT NOT NULL,               -- 'PENDING' | 'NORMALIZED' | 'COMPILED' | 'REJECTED'
  rejection_reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ekb_pipeline_raw_observations (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  source_type TEXT NOT NULL,          -- 'CANDIDATE_CV' | 'JOB_DESCRIPTION' | 'RECRUITER_FEEDBACK'
  raw_term TEXT NOT NULL,
  normalized_stem TEXT NOT NULL,
  context_snippet TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ekb_published_aliases (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  alias_term TEXT NOT NULL,
  normalized_stem TEXT NOT NULL,
  FOREIGN KEY (capability_id) REFERENCES ekb_published_capabilities(id) ON DELETE CASCADE
);

CREATE TABLE ekb_published_capabilities (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  discipline_id TEXT NOT NULL,
  description TEXT,
  FOREIGN KEY (version_id) REFERENCES ekb_published_versions(id) ON DELETE CASCADE
);

CREATE TABLE ekb_published_capability_graph (
  version_id TEXT NOT NULL,
  source_capability_id TEXT NOT NULL,
  target_capability_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,        -- 'SUPPORTS' | 'DRIVES' | 'ENABLES'
  cost REAL NOT NULL,
  PRIMARY KEY (version_id, source_capability_id, target_capability_id)
);

CREATE TABLE ekb_published_embeddings (
  capability_id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  vector_json TEXT NOT NULL,          -- JSON array of float dimensions
  model_identifier TEXT NOT NULL,
  FOREIGN KEY (capability_id) REFERENCES ekb_published_capabilities(id) ON DELETE CASCADE
);

CREATE TABLE ekb_published_mobility_graph (
  version_id TEXT NOT NULL,
  source_title TEXT NOT NULL,
  target_title TEXT NOT NULL,
  transition_frequency INTEGER NOT NULL,
  friction_cost REAL NOT NULL,
  PRIMARY KEY (version_id, source_title, target_title)
);

CREATE TABLE ekb_published_platform_graph (
  version_id TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  platform_vendor TEXT NOT NULL,
  product_name TEXT NOT NULL,
  PRIMARY KEY (version_id, capability_id, product_name)
);

CREATE TABLE ekb_published_relationships (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  source_capability_id TEXT NOT NULL,
  target_capability_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,        -- 'SUPPORTS' | 'DRIVES' | 'ENABLES' | 'TRANSITIONS_TO'
  statistical_cost REAL NOT NULL,     -- 0.05 to 0.80
  confidence REAL NOT NULL,
  derived_from TEXT NOT NULL,         -- e.g. '412 executive transitions'
  algorithm_version TEXT NOT NULL,    -- e.g. 'MobilityModel v3'
  last_recomputed DATETIME NOT NULL,
  FOREIGN KEY (version_id) REFERENCES ekb_published_versions(id) ON DELETE CASCADE
);

CREATE TABLE ekb_published_versions (
  id TEXT PRIMARY KEY,                -- e.g. '14.2.1'
  major INTEGER NOT NULL,
  minor INTEGER NOT NULL,
  patch INTEGER NOT NULL,
  status TEXT NOT NULL,               -- 'STAGING' | 'QUALITY_TESTED' | 'PROMOTED' | 'PUBLISHED' | 'DEPRECATED'
  quality_report_json TEXT NOT NULL,
  promoted_by TEXT,
  published_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ekb_release_candidates (
  version_id TEXT PRIMARY KEY,        -- e.g. '14.3.0'
  status TEXT NOT NULL,               -- 'COMPILED' | 'CANDIDATE' | 'PROMOTED' | 'PUBLISHED'
  compilation_report_json TEXT NOT NULL,
  compiled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  published_at DATETIME
);

CREATE TABLE ekb_temporal_evidence (
  id TEXT PRIMARY KEY,
  capability_id TEXT NOT NULL,
  year_month TEXT NOT NULL,           -- e.g. '2026-07'
  cv_frequency INTEGER DEFAULT 0,
  jd_frequency INTEGER DEFAULT 0,
  recruiter_frequency INTEGER DEFAULT 0,
  extraction_confidence REAL NOT NULL,
  evidence_confidence REAL NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (capability_id) REFERENCES ekb_published_capabilities(id) ON DELETE CASCADE
);

CREATE TABLE evaluation_context_scopes (
    context_fingerprint TEXT NOT NULL PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    search_plan_id TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(context_fingerprint, tenant_id, person_id, search_plan_id)
);

CREATE TABLE evaluation_contexts (
    context_fingerprint TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    person_id TEXT NOT NULL REFERENCES people(id),
    search_plan_snapshot_id TEXT NOT NULL REFERENCES search_plan_snapshots(id),
    ontology_version TEXT NOT NULL,
    ontology_fingerprint TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    profile_version TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version)
);

CREATE TABLE evaluation_jobs (
    id TEXT PRIMARY KEY,

    tenant_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    search_plan_id TEXT NOT NULL,

    canonical_job_id TEXT NOT NULL,
    opportunity_version TEXT NOT NULL,
    evaluation_context_fingerprint TEXT NOT NULL,

    status TEXT NOT NULL DEFAULT 'pending', 
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,

    next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    last_error TEXT,

    locked_by TEXT,
    lease_token TEXT,
    locked_at DATETIME,

    completed_at DATETIME,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (person_id, tenant_id)
        REFERENCES people(id, tenant_id),

        FOREIGN KEY (search_plan_id, tenant_id, person_id)
        REFERENCES search_plans(id, tenant_id, person_id)
        ON DELETE CASCADE,

        FOREIGN KEY (canonical_job_id, opportunity_version)
        REFERENCES opportunity_versions(canonical_job_id, id),

        FOREIGN KEY (
        tenant_id,
        person_id,
        search_plan_id,
        canonical_job_id,
        opportunity_version
    )
        REFERENCES search_plan_candidates(
            tenant_id,
            person_id,
            search_plan_id,
            canonical_job_id,
            opportunity_version
        ),

        CONSTRAINT unq_eval_job_context UNIQUE (
        tenant_id,
        search_plan_id,
        canonical_job_id,
        opportunity_version,
        evaluation_context_fingerprint
    )
);

CREATE TABLE evaluation_signatures (
    id TEXT PRIMARY KEY,
    job_hash TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    evaluation_signature TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE evidence (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    text TEXT NOT NULL,
    section TEXT,
    quality_score REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
    meta_extractor_version TEXT,
    meta_prompt_version TEXT,
    meta_model TEXT,
    meta_run_id TEXT,
    meta_timestamp DATETIME,
    FOREIGN KEY(document_id) REFERENCES documents(id)
);

CREATE TABLE evidence_graphs (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    graph_json TEXT NOT NULL,
    extractor_version TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(person_id) REFERENCES people(id),
    FOREIGN KEY(document_id) REFERENCES candidate_documents(id)
);

CREATE TABLE fact_evidence (
    fact_id TEXT NOT NULL,
    evidence_id TEXT NOT NULL,
    PRIMARY KEY (fact_id, evidence_id),
    FOREIGN KEY(fact_id) REFERENCES facts(id),
    FOREIGN KEY(evidence_id) REFERENCES evidence(id)
);

CREATE TABLE facts (
    id TEXT PRIMARY KEY,
    opportunity_id TEXT NOT NULL,
    attribute TEXT NOT NULL,
    value TEXT NOT NULL, -- JSON string
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
    meta_extractor_version TEXT,
    meta_prompt_version TEXT,
    meta_model TEXT,
    meta_run_id TEXT,
    meta_timestamp DATETIME,
    FOREIGN KEY(opportunity_id) REFERENCES opportunities(id)
);

CREATE TABLE intent (
    id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL,
    desired_roles TEXT NOT NULL, -- JSON array of strings
    preferred_locations TEXT NOT NULL, -- JSON array of strings
    salary_band TEXT NOT NULL, -- JSON object
    industries TEXT NOT NULL, -- JSON array of strings
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(candidate_id) REFERENCES people(id)
);

CREATE TABLE match_claims (
    match_id TEXT NOT NULL,
    claim_id TEXT NOT NULL,
    PRIMARY KEY (match_id, claim_id),
    FOREIGN KEY(match_id) REFERENCES matches(id),
    FOREIGN KEY(claim_id) REFERENCES claims(id)
);

CREATE TABLE matches (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    opportunity_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
    meta_extractor_version TEXT,
    meta_prompt_version TEXT,
    meta_model TEXT,
    meta_run_id TEXT,
    meta_timestamp DATETIME,
    FOREIGN KEY(person_id) REFERENCES people(id),
    FOREIGN KEY(opportunity_id) REFERENCES opportunities(id)
);

CREATE TABLE "materialized_evaluations" (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    person_id TEXT NOT NULL REFERENCES people(id),
    canonical_job_id TEXT NOT NULL,
    opportunity_version TEXT NOT NULL,
    evaluation_context_fingerprint TEXT NOT NULL REFERENCES evaluation_contexts(context_fingerprint),
    evaluation_state TEXT NOT NULL DEFAULT 'UNKNOWN',
    decision TEXT CHECK(decision IS NULL OR decision IN ('PURSUE', 'CONSIDER', 'PASS', 'SPARSE_SPEC')),
    quality_score REAL,
    rationale TEXT,
    evidence_ids TEXT,
    evaluation_json TEXT NOT NULL,
    materialized_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
);

CREATE TABLE memberships (
    user_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    role TEXT NOT NULL,
    permissions TEXT NOT NULL,     status TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    revoked_at DATETIME,
    PRIMARY KEY (user_id, tenant_id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(tenant_id) REFERENCES tenants(id)
);

CREATE TABLE oauth_accounts (
  provider         TEXT NOT NULL,  -- 'google'
  provider_user_id TEXT NOT NULL,  -- Google 'sub' claim
  user_id          TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (provider, provider_user_id)
);

CREATE TABLE opportunities (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    canonical_title TEXT NOT NULL,
    location TEXT,
    employment_type TEXT,
    posting_window TEXT,
    fingerprint TEXT NOT NULL UNIQUE,
    lifecycle TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
    meta_extractor_version TEXT,
    meta_prompt_version TEXT,
    meta_model TEXT,
    meta_run_id TEXT,
    meta_timestamp DATETIME,
    FOREIGN KEY(company_id) REFERENCES companies(id)
);

CREATE TABLE opportunity_discoveries (
    id TEXT PRIMARY KEY,
    opportunity_id TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    first_portal TEXT NOT NULL,
    first_definition TEXT NOT NULL,
    discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(opportunity_id, execution_id)
);

CREATE TABLE opportunity_versions (
    id TEXT PRIMARY KEY,     canonical_job_id TEXT NOT NULL REFERENCES canonical_opportunities(id) ON DELETE CASCADE,
    content_hash TEXT NOT NULL,
    job_title TEXT NOT NULL,
    company_name TEXT,
    location TEXT,
    employment_type TEXT,
    raw_content TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, posted_at DATETIME, posted_precision TEXT DEFAULT 'UNKNOWN', acquisition_status TEXT NOT NULL DEFAULT 'UNKNOWN', acquisition_quality TEXT NOT NULL DEFAULT 'UNKNOWN', failure_class TEXT, lifecycle_state TEXT NOT NULL DEFAULT 'UNKNOWN', evidence_state TEXT NOT NULL DEFAULT 'UNVERIFIED',
    UNIQUE(canonical_job_id, content_hash),
    UNIQUE(canonical_job_id, id) );

CREATE TABLE people (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
    meta_extractor_version TEXT,
    meta_prompt_version TEXT,
    meta_model TEXT,
    meta_run_id TEXT,
    meta_timestamp DATETIME
, avatar_url TEXT, onboarded INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT 'user', email_verified INTEGER NOT NULL DEFAULT 0, name TEXT, candidate_state TEXT, onboarding_progress TEXT DEFAULT '{"orientationSeen":false,"evidenceStatus":"pending","intentStatus":"pending","arrivalSeen":false}', tenant_id TEXT REFERENCES tenants(id));

CREATE TABLE policy_comparisons (
        id TEXT PRIMARY KEY,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        champion_policy_id TEXT,
        candidate_policy_id TEXT,
        corpus_hash TEXT,
        profile_hash TEXT,
        stability_index REAL,
        volatility REAL,
        excellent_delta INTEGER,
        good_delta INTEGER,
        average_delta INTEGER,
        weak_delta INTEGER,
        insufficient_delta INTEGER,
        winner TEXT
      );

CREATE TABLE preference_profiles (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    remote BOOLEAN NOT NULL,
    preferred_industries TEXT NOT NULL, -- JSON array
    target_compensation TEXT,
    travel_willingness TEXT,
    company_size TEXT, -- JSON array
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
    meta_extractor_version TEXT,
    meta_prompt_version TEXT,
    meta_model TEXT,
    meta_run_id TEXT,
    meta_timestamp DATETIME,
    FOREIGN KEY(person_id) REFERENCES people(id)
);

CREATE TABLE recommendation_snapshots (
  id TEXT PRIMARY KEY,
  snapshot_hash TEXT NOT NULL,
  person_id TEXT NOT NULL,
  opportunity_id TEXT NOT NULL,
  recommendation_id TEXT NOT NULL,
  
  confidence REAL NOT NULL,
  summary TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  graph_version TEXT NOT NULL,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  
  meta_schema_version TEXT NOT NULL,
  meta_extractor_version TEXT,
  meta_prompt_version TEXT,
  meta_model TEXT,
  meta_run_id TEXT,
  meta_timestamp TEXT NOT NULL
);

CREATE TABLE recommendations (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    opportunity_id TEXT NOT NULL,
    assessment_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    reasons TEXT NOT NULL, -- JSON array
    risks TEXT NOT NULL, -- JSON array
    lifecycle TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
    meta_extractor_version TEXT,
    meta_prompt_version TEXT,
    meta_model TEXT,
    meta_run_id TEXT,
    meta_timestamp DATETIME,
    FOREIGN KEY(person_id) REFERENCES people(id),
    FOREIGN KEY(opportunity_id) REFERENCES opportunities(id),
    FOREIGN KEY(assessment_id) REFERENCES assessments(id)
);

CREATE TABLE recovery_queue (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    canonical_job_id TEXT NOT NULL REFERENCES canonical_opportunities(id) ON DELETE CASCADE,
    opportunity_version_id TEXT NOT NULL REFERENCES opportunity_versions(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    reason TEXT NOT NULL,
    failure_class TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK(status IN ('PENDING', 'PROCESSING', 'RECOVERED', 'EXHAUSTED', 'GENUINELY_SPARSE')),
    next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_attempt_at DATETIME,
    last_error TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE resume_versions (
    id TEXT PRIMARY KEY,
    career_profile_id TEXT NOT NULL,
    type TEXT NOT NULL,
    achievements TEXT NOT NULL, -- JSON array
    custom_statement TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
    meta_extractor_version TEXT,
    meta_prompt_version TEXT,
    meta_model TEXT,
    meta_run_id TEXT,
    meta_timestamp DATETIME,
    FOREIGN KEY(career_profile_id) REFERENCES "candidate_projection"(id)
);

CREATE TABLE search_plan_candidates (
    tenant_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    search_plan_id TEXT NOT NULL,
    canonical_job_id TEXT NOT NULL,
    opportunity_version TEXT NOT NULL,
    attention_decision TEXT NOT NULL CHECK(attention_decision IN ('CANDIDATE', 'NOT_CANDIDATE')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (person_id, tenant_id) REFERENCES people(id, tenant_id),
    FOREIGN KEY (search_plan_id, tenant_id, person_id) REFERENCES search_plans(id, tenant_id, person_id) ON DELETE CASCADE,
    FOREIGN KEY (canonical_job_id, opportunity_version) REFERENCES opportunity_versions(canonical_job_id, id)
);

CREATE TABLE search_plan_snapshots (
    id TEXT PRIMARY KEY,
    search_plan_id TEXT NOT NULL REFERENCES search_plans(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    person_id TEXT NOT NULL REFERENCES people(id),
    snapshot_hash TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(search_plan_id, snapshot_hash)
);

CREATE TABLE search_plans (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    person_id TEXT NOT NULL REFERENCES people(id),
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'archived')),
    criteria_json TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE source_credentials (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    source TEXT NOT NULL,     version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending',     
        encrypted_ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    key_version TEXT NOT NULL,
    
    expires_at DATETIME,
    last_used_at DATETIME,
    last_verified_at DATETIME,
    error_reason TEXT,
    
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (tenant_id)
        REFERENCES tenants(id)
        ON DELETE RESTRICT,

    CONSTRAINT unq_tenant_source_version UNIQUE (tenant_id, source, version)
);

CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    url TEXT,
    name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
    meta_extractor_version TEXT,
    meta_prompt_version TEXT,
    meta_model TEXT,
    meta_run_id TEXT,
    meta_timestamp DATETIME
);

CREATE TABLE tenants (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE timeline_events (
  id TEXT PRIMARY KEY, -- ULID / UUIDv7
  workspace_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  opportunity_id TEXT, -- Optional (e.g. for user-level events)
  
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  
  event_category TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,
  
  recommendation_snapshot_id TEXT, -- Foreign Key
  
  payload_json TEXT NOT NULL, -- Typed JSON payload
  metadata_json TEXT NOT NULL, -- UI context, user agent, etc.

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  
  meta_schema_version TEXT NOT NULL,
  meta_extractor_version TEXT,
  meta_prompt_version TEXT,
  meta_model TEXT,
  meta_run_id TEXT,
  meta_timestamp TEXT NOT NULL
);

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  configuration_version TEXT NOT NULL,
  
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  
  meta_schema_version TEXT NOT NULL,
  meta_extractor_version TEXT,
  meta_prompt_version TEXT,
  meta_model TEXT,
  meta_run_id TEXT,
  meta_timestamp TEXT NOT NULL
);

CREATE TRIGGER validate_evaluation_context_scope_insert
BEFORE INSERT ON evaluation_context_scopes
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'Context scope lineage mismatch')
    WHERE NOT EXISTS (
        SELECT 1
        FROM evaluation_contexts ec
        JOIN search_plan_snapshots sps ON ec.search_plan_snapshot_id = sps.id
        WHERE ec.context_fingerprint = NEW.context_fingerprint
          AND ec.tenant_id = NEW.tenant_id
          AND ec.person_id = NEW.person_id
          AND sps.search_plan_id = NEW.search_plan_id
    );
END;

CREATE TRIGGER validate_evaluation_context_scope_update
BEFORE UPDATE ON evaluation_context_scopes
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'Context scope lineage mismatch')
    WHERE NOT EXISTS (
        SELECT 1
        FROM evaluation_contexts ec
        JOIN search_plan_snapshots sps ON ec.search_plan_snapshot_id = sps.id
        WHERE ec.context_fingerprint = NEW.context_fingerprint
          AND ec.tenant_id = NEW.tenant_id
          AND ec.person_id = NEW.person_id
          AND sps.search_plan_id = NEW.search_plan_id
    );
END;
