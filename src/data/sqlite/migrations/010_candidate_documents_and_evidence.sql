-- 010_candidate_documents_and_evidence.sql
-- Tables for user candidate documents (CVs) and immutable evidence graphs

CREATE TABLE IF NOT EXISTS candidate_documents (
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

CREATE INDEX IF NOT EXISTS idx_candidate_documents_person ON candidate_documents(person_id);
CREATE INDEX IF NOT EXISTS idx_candidate_documents_hash ON candidate_documents(document_hash);

CREATE TABLE IF NOT EXISTS evidence_graphs (
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

CREATE INDEX IF NOT EXISTS idx_evidence_graphs_person ON evidence_graphs(person_id);
CREATE INDEX IF NOT EXISTS idx_evidence_graphs_document ON evidence_graphs(document_id);
