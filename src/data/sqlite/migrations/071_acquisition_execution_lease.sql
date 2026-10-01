-- One browser execution authority across every host sharing this database.
CREATE TABLE acquisition_execution_lease (
  id TEXT PRIMARY KEY CHECK (id = 'portal-acquisition'),
  token TEXT NOT NULL,
  lease_until INTEGER NOT NULL
);
ALTER TABLE acquisition_ingress_submissions ADD COLUMN staging_retired_at DATETIME;
