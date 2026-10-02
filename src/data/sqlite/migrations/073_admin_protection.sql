CREATE TABLE tenant_quotas (
 tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
 reasoning_monthly INTEGER, writing_monthly INTEGER,
 evaluations_daily INTEGER, memos_daily INTEGER, pursuits_monthly INTEGER, scrapes_daily INTEGER,
 concurrent_jobs INTEGER,
 job_input_tokens INTEGER NOT NULL, job_output_tokens INTEGER NOT NULL,
 updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL
);
CREATE TABLE tenant_quota_overrides (
 tenant_id TEXT NOT NULL REFERENCES tenants(id), dimension TEXT NOT NULL,
 limit_value INTEGER NOT NULL CHECK(limit_value>=0), expires_at INTEGER NOT NULL,
 reason TEXT NOT NULL, actor_id TEXT NOT NULL,
 PRIMARY KEY(tenant_id,dimension)
);
CREATE TABLE pipeline_controls (
 scope_key TEXT NOT NULL, pipeline TEXT NOT NULL, paused INTEGER NOT NULL CHECK(paused IN (0,1)),
 reason TEXT NOT NULL, actor_id TEXT NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(scope_key,pipeline)
);
CREATE TABLE quota_jobs (
 pipeline TEXT NOT NULL, job_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
 day TEXT NOT NULL, month TEXT NOT NULL, lane TEXT NOT NULL,
 input_limit INTEGER NOT NULL, output_limit INTEGER NOT NULL,
 input_used INTEGER NOT NULL DEFAULT 0, output_used INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT NOT NULL, lease_until INTEGER NOT NULL,
 closed INTEGER NOT NULL DEFAULT 0, invalid_reviewed_at INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(pipeline,job_id)
);
CREATE INDEX quota_jobs_scope ON quota_jobs(tenant_id,month,lane,closed);
CREATE TABLE quota_calls (
 id TEXT PRIMARY KEY, pipeline TEXT NOT NULL, job_id TEXT NOT NULL, tenant_id TEXT NOT NULL, month TEXT NOT NULL,
 input_reserved INTEGER NOT NULL, output_reserved INTEGER NOT NULL,
 input_charged INTEGER NOT NULL, output_charged INTEGER NOT NULL,
 settled INTEGER NOT NULL DEFAULT 0, unknown_usage INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'running', started_at INTEGER NOT NULL,
 FOREIGN KEY(pipeline,job_id) REFERENCES quota_jobs(pipeline,job_id)
);
CREATE TABLE quota_deferrals (
 pipeline TEXT NOT NULL, job_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
 reason TEXT NOT NULL, retry_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(pipeline,job_id)
);
CREATE TABLE admin_alerts (
 id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL,
 message TEXT NOT NULL, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
 acknowledged_at INTEGER, acknowledged_by TEXT
);
