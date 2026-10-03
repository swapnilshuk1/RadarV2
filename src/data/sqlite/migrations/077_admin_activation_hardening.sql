ALTER TABLE admin_bench_runs ADD COLUMN expected_environment_json TEXT;
ALTER TABLE admin_bench_runs ADD COLUMN worker_environment_json TEXT;
ALTER TABLE config_revisions ADD COLUMN inherit_revision_id TEXT REFERENCES config_revisions(id);

CREATE TRIGGER admin_bench_environment_identity BEFORE UPDATE ON admin_bench_runs
WHEN NEW.expected_environment_json IS NOT OLD.expected_environment_json OR
 (OLD.status <> 'queued' AND NEW.worker_environment_json IS NOT OLD.worker_environment_json)
BEGIN SELECT RAISE(ABORT, 'BENCH_ENVIRONMENT_IMMUTABLE'); END;

-- A scope epoch protects all protection writes, including absent rows and ABA changes.
CREATE TABLE admin_protection_versions(scope TEXT PRIMARY KEY,version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE admin_quota_defaults(id INTEGER PRIMARY KEY CHECK(id=1),policy_json TEXT NOT NULL);
INSERT INTO admin_quota_defaults VALUES(1,'{"reasoning_monthly":2000000,"writing_monthly":1000000,"evaluations_daily":50,"memos_daily":20,"pursuits_monthly":10,"scrapes_daily":3,"concurrent_jobs":4,"job_input_tokens":500000,"job_output_tokens":100000}');
-- Preserve existing pre-production policies; provision every existing tenant explicitly.
INSERT INTO tenant_quotas(tenant_id,reasoning_monthly,writing_monthly,evaluations_daily,memos_daily,pursuits_monthly,scrapes_daily,concurrent_jobs,job_input_tokens,job_output_tokens,updated_at,updated_by)
SELECT id,NULL,NULL,NULL,NULL,NULL,NULL,NULL,500000,100000,0,'migration-compatibility'
FROM tenants WHERE id NOT IN (SELECT tenant_id FROM tenant_quotas);
CREATE TRIGGER admin_provision_tenant_quota AFTER INSERT ON tenants
BEGIN
 INSERT INTO tenant_quotas(tenant_id,reasoning_monthly,writing_monthly,evaluations_daily,memos_daily,pursuits_monthly,scrapes_daily,concurrent_jobs,job_input_tokens,job_output_tokens,updated_at,updated_by)
 SELECT NEW.id,json_extract(policy_json,'$.reasoning_monthly'),json_extract(policy_json,'$.writing_monthly'),
 json_extract(policy_json,'$.evaluations_daily'),json_extract(policy_json,'$.memos_daily'),
 json_extract(policy_json,'$.pursuits_monthly'),json_extract(policy_json,'$.scrapes_daily'),
 json_extract(policy_json,'$.concurrent_jobs'),json_extract(policy_json,'$.job_input_tokens'),
 json_extract(policy_json,'$.job_output_tokens'),0,'platform-default'
 FROM admin_quota_defaults WHERE id=1;
END;
