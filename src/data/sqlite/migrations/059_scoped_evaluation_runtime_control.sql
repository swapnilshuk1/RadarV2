DROP TABLE evaluation_runtime_control;
CREATE TABLE evaluation_runtime_control (
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  desired_state TEXT NOT NULL CHECK(desired_state IN ('RUNNING','PAUSED','STOPPED')),
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (tenant_id, person_id),
  FOREIGN KEY (person_id) REFERENCES people(id)
);
