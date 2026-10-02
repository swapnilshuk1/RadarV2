-- Platform-owned discovery taxonomy. Revisions are immutable and only affect
-- search plans activated after publication; each plan snapshots its queries.
CREATE TABLE taxonomy_revisions (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES taxonomy_revisions(id),
  definition_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);
CREATE TABLE taxonomy_active_pointer (
  id INTEGER PRIMARY KEY CHECK(id=1),
  revision_id TEXT NOT NULL REFERENCES taxonomy_revisions(id)
);
CREATE TABLE taxonomy_drafts (
  id INTEGER PRIMARY KEY CHECK(id=1),
  revision_id TEXT NOT NULL REFERENCES taxonomy_revisions(id)
);
CREATE TRIGGER taxonomy_revisions_no_update BEFORE UPDATE ON taxonomy_revisions
BEGIN SELECT RAISE(ABORT,'TAXONOMY_REVISION_IMMUTABLE'); END;
CREATE TRIGGER taxonomy_revisions_no_delete BEFORE DELETE ON taxonomy_revisions
BEGIN SELECT RAISE(ABORT,'TAXONOMY_REVISION_IMMUTABLE'); END;
