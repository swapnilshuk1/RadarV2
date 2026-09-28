CREATE TABLE IF NOT EXISTS corpus_regeneration_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('queued','processing','completed','failed')),
  stage TEXT NOT NULL,
  logs_json TEXT NOT NULL DEFAULT '[]',
  processed_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  locked_by TEXT,
  lease_token TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
