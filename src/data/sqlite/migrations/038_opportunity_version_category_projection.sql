-- Gate 3: Category membership is a rebuildable, version-scoped projection.
-- It is derived from the canonical title plus readable JD at ingestion time so
-- feed filtering never has to scan bulky raw_content after pagination.
ALTER TABLE opportunity_versions ADD COLUMN category_ids TEXT NOT NULL DEFAULT '["all"]';

