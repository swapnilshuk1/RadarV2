-- Additive shadow knowledge; canonical evaluations/presentations are untouched.
CREATE TABLE IF NOT EXISTS intelligence_company_entities (
 tenant_id TEXT NOT NULL,
 id TEXT NOT NULL,
 normalized_name TEXT NOT NULL,
 official_domain TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (tenant_id,id),
 UNIQUE (tenant_id,normalized_name)
);
CREATE TABLE IF NOT EXISTS intelligence_sources (
 tenant_id TEXT NOT NULL, id TEXT NOT NULL, source_json TEXT NOT NULL,
 PRIMARY KEY (tenant_id,id)
);
CREATE TABLE IF NOT EXISTS intelligence_source_documents (
 tenant_id TEXT NOT NULL,
 source_id TEXT NOT NULL,
 content_hash TEXT NOT NULL,
 content TEXT NOT NULL,
 PRIMARY KEY (tenant_id,source_id),
 FOREIGN KEY(tenant_id,source_id) REFERENCES intelligence_sources(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS intelligence_claims (
 tenant_id TEXT NOT NULL, id TEXT NOT NULL, subject_type TEXT NOT NULL,
 subject_id TEXT NOT NULL, predicate TEXT NOT NULL, claim_json TEXT NOT NULL,
 PRIMARY KEY (tenant_id,id)
);
CREATE INDEX IF NOT EXISTS intelligence_claim_subject ON intelligence_claims(tenant_id,subject_type,subject_id,predicate);
CREATE TABLE IF NOT EXISTS intelligence_claim_edges (
 tenant_id TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
 relation TEXT NOT NULL CHECK(relation IN ('SUPPORTS','CONTRADICTS','DERIVED_FROM','SUPERSEDES')),
 PRIMARY KEY (tenant_id,from_id,to_id,relation),
 FOREIGN KEY(tenant_id,from_id) REFERENCES intelligence_claims(tenant_id,id),
 FOREIGN KEY(tenant_id,to_id) REFERENCES intelligence_claims(tenant_id,id)
);
