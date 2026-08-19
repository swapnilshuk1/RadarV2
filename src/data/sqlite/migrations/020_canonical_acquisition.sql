-- Migration 020: Canonical Acquisition & Search Plan Gating (Phase M4.1)

-- Remediation: Establish unique ownership lineages for existing tables to support composite FKs
CREATE UNIQUE INDEX IF NOT EXISTS idx_people_tenant_lineage ON people(id, tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_search_plans_lineage ON search_plans(id, tenant_id, person_id);

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
    id TEXT PRIMARY KEY, -- deterministic version identity
    canonical_job_id TEXT NOT NULL REFERENCES canonical_opportunities(id) ON DELETE CASCADE,
    content_hash TEXT NOT NULL,
    job_title TEXT NOT NULL,
    company_name TEXT,
    location TEXT,
    employment_type TEXT,
    raw_content TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(canonical_job_id, content_hash),
    UNIQUE(canonical_job_id, id) -- Required for search_plan_candidates composite FK
);

CREATE INDEX IF NOT EXISTS idx_opp_versions_canonical
    ON opportunity_versions(canonical_job_id);

-- 3. Search Plan Candidates (Tenant-Scoped Attention Projection)
CREATE TABLE IF NOT EXISTS search_plan_candidates (
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

CREATE INDEX IF NOT EXISTS idx_search_plan_candidates_plan
    ON search_plan_candidates(search_plan_id);

CREATE INDEX IF NOT EXISTS idx_search_plan_candidates_tenant_person
    ON search_plan_candidates(tenant_id, person_id);
