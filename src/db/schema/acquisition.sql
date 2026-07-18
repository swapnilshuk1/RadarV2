-- Acquisition Strategy Domain (Sprint 4)

CREATE TABLE IF NOT EXISTS catalog_versions (
    id TEXT PRIMARY KEY,
    version_string TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS acquisition_campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS acquisition_strategies (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES acquisition_campaigns(id),
    catalog_version_id TEXT NOT NULL REFERENCES catalog_versions(id),
    name TEXT NOT NULL,
    freshness_target_days INTEGER NOT NULL DEFAULT 7,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS acquisition_budgets (
    id TEXT PRIMARY KEY,
    strategy_id TEXT NOT NULL REFERENCES acquisition_strategies(id) ON DELETE CASCADE,
    max_minutes INTEGER,
    max_pages INTEGER,
    max_detail_fetches INTEGER,
    max_browser_sessions INTEGER,
    max_llm_tokens INTEGER,
    max_usd REAL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS search_families (
    id TEXT PRIMARY KEY,
    strategy_id TEXT NOT NULL REFERENCES acquisition_strategies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 1.0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS search_intents (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL REFERENCES search_families(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS query_templates (
    id TEXT PRIMARY KEY,
    intent_id TEXT NOT NULL REFERENCES search_intents(id) ON DELETE CASCADE,
    template TEXT NOT NULL, -- e.g. "{{intent}} in {{location}}"
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- SearchDefinition is IMMUTABLE regarding its search parameters.
-- However, status and priority can be updated via a separate mechanism or we can treat the whole record as mutable for those fields.
-- The user said: "Today you have SearchDefinition immutable. Good. But you also need status ACTIVE, PAUSED, RETIRED, EXPERIMENTAL... Otherwise you'll eventually delete definitions. Never delete."
CREATE TABLE IF NOT EXISTS search_definitions (
    id TEXT PRIMARY KEY,
    intent_id TEXT NOT NULL REFERENCES search_intents(id),
    portal TEXT NOT NULL,
    location TEXT,
    industry TEXT,
    is_remote BOOLEAN NOT NULL DEFAULT 0,
    raw_query TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, PAUSED, RETIRED, EXPERIMENTAL
    maturity TEXT NOT NULL DEFAULT 'Candidate', -- Experimental, Candidate, Stable, Core
    priority INTEGER NOT NULL DEFAULT 50, -- e.g. 100 for CMO
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(intent_id, portal, location, industry, is_remote, raw_query)
);

CREATE TABLE IF NOT EXISTS acquisition_sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL, -- e.g., 'JobBoard', 'CompanySite', 'ExecutiveFirm'
    capabilities_json TEXT NOT NULL, -- JSON array: ["Search", "Detail", "Listing"]
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS opportunity_discoveries (
    id TEXT PRIMARY KEY,
    opportunity_id TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    first_portal TEXT NOT NULL,
    first_definition TEXT NOT NULL,
    discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(opportunity_id, execution_id)
);
