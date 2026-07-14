-- Migration 001: Initial Canonical Knowledge Graph Schema
-- Multi-User Architecture

-- Operational Tables
CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    migration_name TEXT NOT NULL UNIQUE,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 1. GLOBAL LAYER (Owned by the System)
-- ============================================================================

CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    industry TEXT,
    hq TEXT,
    size TEXT,
    tech_stack TEXT, -- JSON array
    hiring_velocity REAL,
    growth_signal TEXT,
    leadership_changes TEXT,
    technology_adoption TEXT,
    executive_turnover TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
    meta_extractor_version TEXT,
    meta_prompt_version TEXT,
    meta_model TEXT,
    meta_benchmark_version TEXT
);

CREATE TABLE IF NOT EXISTS opportunities (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    canonical_role TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
    meta_extractor_version TEXT,
    meta_prompt_version TEXT,
    meta_model TEXT,
    meta_benchmark_version TEXT,
    FOREIGN KEY(company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS source_listings (
    id TEXT PRIMARY KEY,
    opportunity_id TEXT NOT NULL,
    portal TEXT NOT NULL,
    url TEXT NOT NULL,
    posted_at DATETIME,
    recruiter TEXT,
    salary_metadata TEXT,
    raw_html_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
    FOREIGN KEY(opportunity_id) REFERENCES opportunities(id)
);

CREATE TABLE IF NOT EXISTS extractions (
    id TEXT PRIMARY KEY,
    source_listing_id TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
    meta_extractor_version TEXT,
    FOREIGN KEY(source_listing_id) REFERENCES source_listings(id)
);

CREATE TABLE IF NOT EXISTS evidence (
    id TEXT PRIMARY KEY,
    source_listing_id TEXT NOT NULL,
    text TEXT NOT NULL,
    source_type TEXT NOT NULL,
    quality_score REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
    FOREIGN KEY(source_listing_id) REFERENCES source_listings(id)
);

CREATE TABLE IF NOT EXISTS facts (
    id TEXT PRIMARY KEY,
    opportunity_id TEXT NOT NULL,
    attribute TEXT NOT NULL,
    value TEXT NOT NULL, -- JSON string
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
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
    meta_prompt_version TEXT,
    meta_model TEXT,
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
    meta_schema_version TEXT
);

CREATE TABLE IF NOT EXISTS career_profiles (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    timeline TEXT NOT NULL, -- JSON array
    skills TEXT NOT NULL, -- JSON array
    achievements TEXT NOT NULL, -- JSON array
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
    FOREIGN KEY(person_id) REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS preference_profiles (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    remote BOOLEAN NOT NULL,
    preferred_industries TEXT NOT NULL, -- JSON array
    target_compensation TEXT,
    travel_willingness TEXT,
    company_size TEXT, -- JSON array
    international BOOLEAN NOT NULL,
    startups BOOLEAN NOT NULL,
    public_companies BOOLEAN NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
    FOREIGN KEY(person_id) REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    opportunity_id TEXT NOT NULL,
    capability_score REAL NOT NULL,
    career_progression_score REAL NOT NULL,
    strategic_value_score REAL NOT NULL,
    lifestyle_score REAL NOT NULL,
    overall_confidence REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
    meta_prompt_version TEXT,
    meta_model TEXT,
    FOREIGN KEY(person_id) REFERENCES people(id),
    FOREIGN KEY(opportunity_id) REFERENCES opportunities(id)
);

CREATE TABLE IF NOT EXISTS recommendations (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    opportunity_id TEXT NOT NULL,
    match_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    reasons TEXT NOT NULL, -- JSON array
    risks TEXT NOT NULL, -- JSON array
    unknowns TEXT NOT NULL, -- JSON array
    supporting_claims TEXT NOT NULL, -- JSON array
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
    meta_prompt_version TEXT,
    meta_model TEXT,
    FOREIGN KEY(person_id) REFERENCES people(id),
    FOREIGN KEY(opportunity_id) REFERENCES opportunities(id),
    FOREIGN KEY(match_id) REFERENCES matches(id)
);

CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    opportunity_id TEXT NOT NULL,
    recommendation_id TEXT,
    action TEXT NOT NULL,
    reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
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
    learned_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    meta_schema_version TEXT,
    FOREIGN KEY(person_id) REFERENCES people(id),
    FOREIGN KEY(opportunity_id) REFERENCES opportunities(id),
    FOREIGN KEY(decision_id) REFERENCES decisions(id)
);
