-- Migration 001: Canonical Knowledge Graph Schema (ADR-001)

CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    migration_name TEXT NOT NULL UNIQUE,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 1. GLOBAL LAYER (Owned by the System)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sources (
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

CREATE TABLE IF NOT EXISTS companies (
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

CREATE TABLE IF NOT EXISTS opportunities (
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

CREATE TABLE IF NOT EXISTS documents (
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

CREATE TABLE IF NOT EXISTS evidence (
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

CREATE TABLE IF NOT EXISTS facts (
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

CREATE TABLE IF NOT EXISTS fact_evidence (
    fact_id TEXT NOT NULL,
    evidence_id TEXT NOT NULL,
    PRIMARY KEY (fact_id, evidence_id),
    FOREIGN KEY(fact_id) REFERENCES facts(id),
    FOREIGN KEY(evidence_id) REFERENCES evidence(id)
);

CREATE TABLE IF NOT EXISTS claims (
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

CREATE TABLE IF NOT EXISTS claim_facts (
    claim_id TEXT NOT NULL,
    fact_id TEXT NOT NULL,
    PRIMARY KEY (claim_id, fact_id),
    FOREIGN KEY(claim_id) REFERENCES claims(id),
    FOREIGN KEY(fact_id) REFERENCES facts(id)
);

-- ============================================================================
-- 2. USER-SCOPED LAYER (Owned by the Person)
-- ============================================================================

CREATE TABLE IF NOT EXISTS people (
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
);

CREATE TABLE IF NOT EXISTS career_profiles (
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
    meta_timestamp DATETIME,
    FOREIGN KEY(person_id) REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS resume_versions (
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
    FOREIGN KEY(career_profile_id) REFERENCES career_profiles(id)
);

CREATE TABLE IF NOT EXISTS preference_profiles (
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

CREATE TABLE IF NOT EXISTS matches (
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

CREATE TABLE IF NOT EXISTS match_claims (
    match_id TEXT NOT NULL,
    claim_id TEXT NOT NULL,
    PRIMARY KEY (match_id, claim_id),
    FOREIGN KEY(match_id) REFERENCES matches(id),
    FOREIGN KEY(claim_id) REFERENCES claims(id)
);

CREATE TABLE IF NOT EXISTS assessments (
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

CREATE TABLE IF NOT EXISTS recommendations (
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

CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    opportunity_id TEXT NOT NULL,
    recommendation_id TEXT,
    action TEXT NOT NULL,
    reason TEXT,
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
    FOREIGN KEY(recommendation_id) REFERENCES recommendations(id)
);

CREATE TABLE IF NOT EXISTS outcomes (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    opportunity_id TEXT NOT NULL,
    decision_id TEXT NOT NULL,
    result TEXT NOT NULL,
    outcome_source TEXT NOT NULL,
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
    FOREIGN KEY(decision_id) REFERENCES decisions(id)
);
