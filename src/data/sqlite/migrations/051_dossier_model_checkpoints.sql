-- Durable proposal/review results. Validation still runs on every reuse.
CREATE TABLE IF NOT EXISTS dossier_model_checkpoints (
  scope_fingerprint TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  response_json TEXT NOT NULL,
  response_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (scope_fingerprint, request_fingerprint)
);
