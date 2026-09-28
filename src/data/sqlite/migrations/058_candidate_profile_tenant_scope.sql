-- Candidate profile data is tenant/person owned.  Historical ownership is
-- deterministically derived from people or the owning candidate document.

ALTER TABLE candidate_documents ADD COLUMN tenant_id TEXT;
UPDATE candidate_documents
SET tenant_id = (SELECT tenant_id FROM people WHERE people.id = candidate_documents.person_id);

ALTER TABLE evidence_graphs ADD COLUMN tenant_id TEXT;
UPDATE evidence_graphs
SET tenant_id = (SELECT tenant_id FROM candidate_documents WHERE candidate_documents.id = evidence_graphs.document_id);

ALTER TABLE document_contents ADD COLUMN tenant_id TEXT;
ALTER TABLE document_contents ADD COLUMN person_id TEXT;
UPDATE document_contents
SET tenant_id = (SELECT tenant_id FROM candidate_documents WHERE candidate_documents.id = document_contents.document_id),
    person_id = (SELECT person_id FROM candidate_documents WHERE candidate_documents.id = document_contents.document_id);

ALTER TABLE career_intents ADD COLUMN tenant_id TEXT;
UPDATE career_intents
SET tenant_id = (SELECT tenant_id FROM people WHERE people.id = career_intents.person_id);

ALTER TABLE candidate_document_jobs ADD COLUMN tenant_id TEXT;
UPDATE candidate_document_jobs
SET tenant_id = (SELECT tenant_id FROM candidate_documents WHERE candidate_documents.id = candidate_document_jobs.document_id);

CREATE TABLE candidate_profile_scope_backfill_guard (id INTEGER CHECK (id = 0));
INSERT INTO candidate_profile_scope_backfill_guard(id)
SELECT 1
WHERE EXISTS (SELECT 1 FROM candidate_documents WHERE tenant_id IS NULL)
   OR EXISTS (SELECT 1 FROM evidence_graphs WHERE tenant_id IS NULL)
   OR EXISTS (SELECT 1 FROM document_contents WHERE tenant_id IS NULL OR person_id IS NULL)
   OR EXISTS (SELECT 1 FROM career_intents WHERE tenant_id IS NULL)
   OR EXISTS (SELECT 1 FROM candidate_document_jobs WHERE tenant_id IS NULL)
   OR EXISTS (SELECT 1 FROM profile_projection_source_bindings b LEFT JOIN people p ON p.id = b.person_id WHERE p.tenant_id IS NULL)
   OR EXISTS (SELECT 1 FROM evidence_graphs eg JOIN candidate_documents cd ON cd.id=eg.document_id WHERE eg.person_id<>cd.person_id OR eg.tenant_id<>cd.tenant_id)
   OR EXISTS (SELECT 1 FROM candidate_document_jobs j JOIN candidate_documents cd ON cd.id=j.document_id WHERE j.person_id<>cd.person_id OR j.tenant_id<>cd.tenant_id)
   OR EXISTS (SELECT 1 FROM profile_projection_source_bindings b JOIN candidate_documents cd ON cd.id=b.document_id JOIN evidence_graphs eg ON eg.id=b.evidence_graph_id WHERE b.person_id<>cd.person_id OR b.person_id<>eg.person_id OR cd.person_id<>eg.person_id OR cd.tenant_id<>eg.tenant_id OR b.person_id NOT IN (SELECT id FROM people WHERE tenant_id=cd.tenant_id));
DROP TABLE candidate_profile_scope_backfill_guard;

ALTER TABLE profile_projection_source_bindings RENAME TO profile_projection_source_bindings_legacy_058;
CREATE TABLE profile_projection_source_bindings (
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  profile_version TEXT NOT NULL,
  document_id TEXT NOT NULL,
  evidence_graph_id TEXT NOT NULL,
  document_text_hash TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, person_id, profile_version, document_id),
  UNIQUE (tenant_id, person_id, profile_version, evidence_graph_id),
  FOREIGN KEY (person_id) REFERENCES people(id),
  FOREIGN KEY (document_id) REFERENCES candidate_documents(id),
  FOREIGN KEY (evidence_graph_id) REFERENCES evidence_graphs(id)
);
INSERT INTO profile_projection_source_bindings(
  tenant_id,person_id,profile_version,document_id,evidence_graph_id,document_text_hash,created_at
)
SELECT p.tenant_id,b.person_id,b.profile_version,b.document_id,b.evidence_graph_id,b.document_text_hash,b.created_at
FROM profile_projection_source_bindings_legacy_058 b
JOIN people p ON p.id = b.person_id;
DROP TABLE profile_projection_source_bindings_legacy_058;

-- Candidate-derived cache entries have no historical owner.  They are derived,
-- safe to regenerate, and must not be retained as an unscoped private cache.
ALTER TABLE staged_source_evidence_cache RENAME TO staged_source_evidence_cache_legacy_058;
CREATE TABLE staged_source_evidence_cache (
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  extraction_contract_version TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  model_configuration_fingerprint TEXT NOT NULL,
  source_json TEXT NOT NULL,
  claims_json TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id,person_id,source_fingerprint,extraction_contract_version,model_id,model_version,model_configuration_fingerprint)
);
DROP TABLE staged_source_evidence_cache_legacy_058;

CREATE INDEX idx_candidate_documents_scope ON candidate_documents(tenant_id, person_id, created_at DESC);
CREATE INDEX idx_evidence_graphs_scope ON evidence_graphs(tenant_id, person_id, created_at DESC);
CREATE INDEX idx_document_contents_scope ON document_contents(tenant_id, person_id, document_id);
CREATE INDEX idx_career_intents_scope ON career_intents(tenant_id, person_id, version DESC);
CREATE INDEX idx_candidate_document_jobs_scope ON candidate_document_jobs(tenant_id, person_id, status, created_at);

CREATE TRIGGER candidate_documents_scope_required_insert
BEFORE INSERT ON candidate_documents
WHEN NEW.tenant_id IS NULL OR NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.person_id AND tenant_id = NEW.tenant_id)
BEGIN SELECT RAISE(ABORT, 'CANDIDATE_DOCUMENT_SCOPE_REQUIRED'); END;
CREATE TRIGGER evidence_graphs_scope_required_insert
BEFORE INSERT ON evidence_graphs
WHEN NEW.tenant_id IS NULL OR NOT EXISTS (SELECT 1 FROM candidate_documents WHERE id = NEW.document_id AND tenant_id = NEW.tenant_id AND person_id = NEW.person_id)
BEGIN SELECT RAISE(ABORT, 'EVIDENCE_GRAPH_SCOPE_REQUIRED'); END;
CREATE TRIGGER document_contents_scope_required_insert
BEFORE INSERT ON document_contents
WHEN NEW.tenant_id IS NULL OR NEW.person_id IS NULL OR NOT EXISTS (SELECT 1 FROM candidate_documents WHERE id = NEW.document_id AND tenant_id = NEW.tenant_id AND person_id = NEW.person_id)
BEGIN SELECT RAISE(ABORT, 'DOCUMENT_CONTENT_SCOPE_REQUIRED'); END;
CREATE TRIGGER career_intents_scope_required_insert
BEFORE INSERT ON career_intents
WHEN NEW.tenant_id IS NULL OR NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.person_id AND tenant_id = NEW.tenant_id)
BEGIN SELECT RAISE(ABORT, 'CAREER_INTENT_SCOPE_REQUIRED'); END;
CREATE TRIGGER candidate_document_jobs_scope_required_insert
BEFORE INSERT ON candidate_document_jobs
WHEN NEW.tenant_id IS NULL OR NOT EXISTS (SELECT 1 FROM candidate_documents WHERE id = NEW.document_id AND tenant_id = NEW.tenant_id AND person_id = NEW.person_id)
BEGIN SELECT RAISE(ABORT, 'CANDIDATE_DOCUMENT_JOB_SCOPE_REQUIRED'); END;

-- ALTER TABLE cannot add NOT NULL ownership columns in-place on SQLite.  These
-- update guards make ownership just as non-mutable as insert ownership.
CREATE TRIGGER candidate_documents_scope_required_update
BEFORE UPDATE OF tenant_id, person_id ON candidate_documents
WHEN NEW.tenant_id IS NULL OR NOT EXISTS (SELECT 1 FROM people WHERE id=NEW.person_id AND tenant_id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT, 'CANDIDATE_DOCUMENT_SCOPE_REQUIRED'); END;
CREATE TRIGGER evidence_graphs_scope_required_update
BEFORE UPDATE OF tenant_id, person_id, document_id ON evidence_graphs
WHEN NEW.tenant_id IS NULL OR NOT EXISTS (SELECT 1 FROM candidate_documents WHERE id=NEW.document_id AND tenant_id=NEW.tenant_id AND person_id=NEW.person_id)
BEGIN SELECT RAISE(ABORT, 'EVIDENCE_GRAPH_SCOPE_REQUIRED'); END;
CREATE TRIGGER document_contents_scope_required_update
BEFORE UPDATE OF tenant_id, person_id, document_id ON document_contents
WHEN NEW.tenant_id IS NULL OR NEW.person_id IS NULL OR NOT EXISTS (SELECT 1 FROM candidate_documents WHERE id=NEW.document_id AND tenant_id=NEW.tenant_id AND person_id=NEW.person_id)
BEGIN SELECT RAISE(ABORT, 'DOCUMENT_CONTENT_SCOPE_REQUIRED'); END;
CREATE TRIGGER career_intents_scope_required_update
BEFORE UPDATE OF tenant_id, person_id ON career_intents
WHEN NEW.tenant_id IS NULL OR NOT EXISTS (SELECT 1 FROM people WHERE id=NEW.person_id AND tenant_id=NEW.tenant_id)
BEGIN SELECT RAISE(ABORT, 'CAREER_INTENT_SCOPE_REQUIRED'); END;
CREATE TRIGGER candidate_document_jobs_scope_required_update
BEFORE UPDATE OF tenant_id, person_id, document_id ON candidate_document_jobs
WHEN NEW.tenant_id IS NULL OR NOT EXISTS (SELECT 1 FROM candidate_documents WHERE id=NEW.document_id AND tenant_id=NEW.tenant_id AND person_id=NEW.person_id)
BEGIN SELECT RAISE(ABORT, 'CANDIDATE_DOCUMENT_JOB_SCOPE_REQUIRED'); END;
CREATE TRIGGER profile_projection_source_bindings_scope_required_insert
BEFORE INSERT ON profile_projection_source_bindings
WHEN NOT EXISTS (SELECT 1 FROM people WHERE id=NEW.person_id AND tenant_id=NEW.tenant_id)
  OR NOT EXISTS (SELECT 1 FROM candidate_documents WHERE id=NEW.document_id AND tenant_id=NEW.tenant_id AND person_id=NEW.person_id)
  OR NOT EXISTS (SELECT 1 FROM evidence_graphs WHERE id=NEW.evidence_graph_id AND document_id=NEW.document_id AND tenant_id=NEW.tenant_id AND person_id=NEW.person_id)
BEGIN SELECT RAISE(ABORT, 'PROFILE_PROJECTION_BINDING_SCOPE_REQUIRED'); END;
CREATE TRIGGER profile_projection_source_bindings_scope_required_update
BEFORE UPDATE OF tenant_id, person_id, document_id, evidence_graph_id ON profile_projection_source_bindings
WHEN NOT EXISTS (SELECT 1 FROM people WHERE id=NEW.person_id AND tenant_id=NEW.tenant_id)
  OR NOT EXISTS (SELECT 1 FROM candidate_documents WHERE id=NEW.document_id AND tenant_id=NEW.tenant_id AND person_id=NEW.person_id)
  OR NOT EXISTS (SELECT 1 FROM evidence_graphs WHERE id=NEW.evidence_graph_id AND document_id=NEW.document_id AND tenant_id=NEW.tenant_id AND person_id=NEW.person_id)
BEGIN SELECT RAISE(ABORT, 'PROFILE_PROJECTION_BINDING_SCOPE_REQUIRED'); END;
