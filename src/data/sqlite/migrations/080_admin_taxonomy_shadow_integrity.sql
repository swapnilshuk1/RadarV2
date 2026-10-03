-- Shadow evidence is append-only, like the revisions it certifies.
CREATE TRIGGER taxonomy_shadow_no_update BEFORE UPDATE ON taxonomy_shadow_runs
BEGIN SELECT RAISE(ABORT, 'TAXONOMY_SHADOW_IMMUTABLE'); END;
CREATE TRIGGER taxonomy_shadow_no_delete BEFORE DELETE ON taxonomy_shadow_runs
BEGIN SELECT RAISE(ABORT, 'TAXONOMY_SHADOW_IMMUTABLE'); END;
