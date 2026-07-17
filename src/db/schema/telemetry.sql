-- Acquisition Telemetry Domain (Sprint 4)

CREATE TABLE IF NOT EXISTS execution_plans (
    id TEXT PRIMARY KEY,
    strategy_id TEXT NOT NULL,
    catalog_version_id TEXT NOT NULL,
    planner_version TEXT NOT NULL,
    planner_config_json TEXT NOT NULL,
    budget_json TEXT NOT NULL,
    definitions_selected_json TEXT NOT NULL,
    expected_runtime_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS search_sessions (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES execution_plans(id),
    mode TEXT NOT NULL, -- 'daily', 'discovery'
    started_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS search_executions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES search_sessions(id),
    definition_id TEXT NOT NULL, -- The exact immutable search executed
    page INTEGER NOT NULL,
    runtime_ms INTEGER NOT NULL,
    
    -- Consumption
    cards_found INTEGER NOT NULL DEFAULT 0,
    llm_tokens INTEGER NOT NULL DEFAULT 0,
    browser_minutes REAL NOT NULL DEFAULT 0.0,
    
    -- Cost
    usd_llm REAL NOT NULL DEFAULT 0.0,
    usd_browser REAL NOT NULL DEFAULT 0.0,

    -- Yield
    duplicates INTEGER NOT NULL DEFAULT 0,
    new_jobs INTEGER NOT NULL DEFAULT 0,
    qualified INTEGER NOT NULL DEFAULT 0,

    -- Downstream Outcomes (Sprint 6 Prep)
    saved INTEGER NOT NULL DEFAULT 0,
    recommended INTEGER NOT NULL DEFAULT 0,
    clicked INTEGER NOT NULL DEFAULT 0,
    applied INTEGER NOT NULL DEFAULT 0,
    interviewed INTEGER NOT NULL DEFAULT 0,
    offer INTEGER NOT NULL DEFAULT 0,
    
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS opportunity_discoveries (
    id TEXT PRIMARY KEY,
    opportunity_id TEXT NOT NULL, -- Links to the unified Opportunity
    first_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    first_portal TEXT NOT NULL,
    first_definition TEXT NOT NULL,
    times_seen INTEGER NOT NULL DEFAULT 1,
    days_until_duplicate REAL,
    
    execution_id TEXT NOT NULL REFERENCES search_executions(id),
    source_name TEXT NOT NULL,
    discovery_rank INTEGER, -- e.g., 1st to find it, 2nd to find it
    discovery_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(opportunity_id, source_name)
);
