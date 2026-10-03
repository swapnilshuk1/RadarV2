-- Additive operator console. Tenant membership never grants platform access.
CREATE TABLE platform_roles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('operator','viewer')),
  granted_at INTEGER NOT NULL,
  granted_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  revoked_at INTEGER
);
CREATE TABLE admin_audit_log (
  id TEXT PRIMARY KEY,
  occurred_at INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  tenant_id TEXT,
  target TEXT NOT NULL,
  reason TEXT NOT NULL,
  detail_json TEXT NOT NULL
);
CREATE INDEX admin_audit_time ON admin_audit_log(occurred_at DESC);
CREATE INDEX admin_audit_tenant ON admin_audit_log(tenant_id,occurred_at DESC);
CREATE TRIGGER admin_audit_no_update BEFORE UPDATE ON admin_audit_log
BEGIN SELECT RAISE(ABORT,'ADMIN_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER admin_audit_no_delete BEFORE DELETE ON admin_audit_log
BEGIN SELECT RAISE(ABORT,'ADMIN_AUDIT_IMMUTABLE'); END;
CREATE TABLE usage_daily (
  day TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  pipeline TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  calls INTEGER NOT NULL,
  completed INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  invalid INTEGER NOT NULL,
  measured INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  PRIMARY KEY(day,tenant_id,pipeline,provider,model)
);
CREATE TABLE admin_rollup_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  refreshed_at INTEGER NOT NULL,
  first_day TEXT NOT NULL,
  last_day TEXT NOT NULL
);
