-- Migration 003: Create opportunity_discoveries table for pipeline logging
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
