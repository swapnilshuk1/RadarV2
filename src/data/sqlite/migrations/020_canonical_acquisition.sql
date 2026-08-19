-- Migration 020: Canonical Acquisition & Search Plan Gating (Phase M4)

-- 1. Canonical Opportunities (Global Identity)
CREATE TABLE IF NOT EXISTS canonical_opportunities (
    id TEXT PRIMARY KEY, -- SHA256 of Canonical Serialization
    source TEXT NOT NULL,
    source_job_id TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    company_name TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source, source_job_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_opps_source
    ON canonical_opportunities(source, source_job_id);

-- 2. Opportunity Versions (Global Content Versioning)
CREATE TABLE IF NOT EXISTS opportunity_versions (
    id TEXT PRIMARY KEY, -- deterministic hash or ULID
    canonical_job_id TEXT NOT NULL REFERENCES canonical_opportunities(id) ON DELETE CASCADE,
    content_hash TEXT NOT NULL,
    job_title TEXT NOT NULL,
    company_name TEXT,
    location TEXT,
    employment_type TEXT,
    raw_content TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(canonical_job_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_opp_versions_canonical
    ON opportunity_versions(canonical_job_id);

-- 3. Search Plan Candidates (Tenant-Scoped Attention Projection)
CREATE TABLE IF NOT EXISTS search_plan_candidates (
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    person_id TEXT NOT NULL REFERENCES people(id),
    search_plan_id TEXT NOT NULL REFERENCES search_plans(id) ON DELETE CASCADE,
    canonical_job_id TEXT NOT NULL REFERENCES canonical_opportunities(id),
    opportunity_version TEXT NOT NULL REFERENCES opportunity_versions(id),
    attention_decision TEXT NOT NULL CHECK(attention_decision IN ('CANDIDATE', 'NOT_CANDIDATE')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version)
);

CREATE INDEX IF NOT EXISTS idx_search_plan_candidates_plan
    ON search_plan_candidates(search_plan_id);

CREATE INDEX IF NOT EXISTS idx_search_plan_candidates_tenant_person
    ON search_plan_candidates(tenant_id, person_id);
