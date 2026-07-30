-- 011_document_contents_and_intent.sql
-- Tables for document_contents (raw text & SHA-256 text_hash) and versioned career_intents (ADR-012)

CREATE TABLE IF NOT EXISTS document_contents (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL UNIQUE,
    raw_text TEXT NOT NULL,
    text_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(document_id) REFERENCES candidate_documents(id)
);

CREATE INDEX IF NOT EXISTS idx_doc_contents_hash ON document_contents(text_hash);
CREATE INDEX IF NOT EXISTS idx_doc_contents_doc ON document_contents(document_id);

CREATE TABLE IF NOT EXISTS career_intents (
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

CREATE INDEX IF NOT EXISTS idx_career_intents_person ON career_intents(person_id);
