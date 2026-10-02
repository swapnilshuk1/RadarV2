import { randomUUID } from "node:crypto";
import type { DatabaseAdapter } from "../data/database/adapter";

export async function requirePlatformRole(db: DatabaseAdapter, userId: string, write = false) {
  const row = await db.one<{ role: "operator" | "viewer" }>(
    "SELECT role FROM platform_roles WHERE user_id=? AND revoked_at IS NULL",
    [userId],
  );
  if (!row || (write && row.role !== "operator")) throw new Error("PLATFORM_ACCESS_DENIED");
  return row.role;
}

export async function appendAdminAudit(
  db: DatabaseAdapter,
  entry: {
    actor: string;
    action: string;
    tenant?: string;
    target: string;
    reason: string;
    // Callers must supply identifiers / diffs only, never credentials or source payloads.
    detail?: Record<string, unknown>;
  },
) {
  if (!entry.reason.trim()) throw new Error("AUDIT_REASON_REQUIRED");
  await db.execute("INSERT INTO admin_audit_log VALUES(?,?,?,?,?,?,?,?)", [
    randomUUID(),
    Date.now(),
    entry.actor,
    entry.action,
    entry.tenant ?? null,
    entry.target,
    entry.reason,
    JSON.stringify(entry.detail ?? {}),
  ]);
}

/** Bounded replacement reconciles late invocation completions and is idempotent. */
export async function rollupUsage(db: DatabaseAdapter, firstDay: string, lastDay: string) {
  const validDay = (day: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    !Number.isNaN(Date.parse(day)) &&
    new Date(day).toISOString().slice(0, 10) === day;
  if (!validDay(firstDay) || !validDay(lastDay) || firstDay > lastDay)
    throw new Error("INVALID_ROLLUP_WINDOW");
  await db.transaction(async (tx) => {
    await tx.execute("DELETE FROM usage_daily WHERE day BETWEEN ? AND ?", [firstDay, lastDay]);
    await tx.execute(
      `INSERT INTO usage_daily
      SELECT date(started_at/1000,'unixepoch'),tenant_id,pipeline,provider,model_id,
      COUNT(*),SUM(status='completed'),SUM(status IN ('provider_error','transport_error','invalid_output')),
      SUM(status='invalid_output'),SUM(input_tokens IS NOT NULL AND output_tokens IS NOT NULL),
      SUM(COALESCE(input_tokens,0)),SUM(COALESCE(output_tokens,0))
      FROM model_invocations WHERE date(started_at/1000,'unixepoch') BETWEEN ? AND ?
      GROUP BY date(started_at/1000,'unixepoch'),tenant_id,pipeline,provider,model_id`,
      [firstDay, lastDay],
    );
    await tx.execute(
      `INSERT INTO admin_rollup_state VALUES(1,?,?,?)
      ON CONFLICT(id) DO UPDATE SET refreshed_at=excluded.refreshed_at,
      first_day=excluded.first_day,last_day=excluded.last_day`,
      [Date.now(), firstDay, lastDay],
    );
  });
}

export type LedgerRow = Record<string, string | number | null>;
export type AdminSection = { title: string; source: string; rows: LedgerRow[] | null };
export type AdminSnapshot = {
  role: string;
  tenantId?: string;
  firstDay: string;
  lastDay: string;
  rollupAt: number | null;
  tenants: { id: string }[];
  sections: AdminSection[];
};

export async function readAdminSnapshot(
  db: DatabaseAdapter,
  userId: string,
  tenantId?: string,
  days = 7,
): Promise<AdminSnapshot> {
  const role = await requirePlatformRole(db, userId);
  if (![1, 7, 30].includes(days)) throw new Error("INVALID_WINDOW");
  const tenants = await db.many<{ id: string }>("SELECT id FROM tenants ORDER BY id");
  if (tenantId && !tenants.some((t) => t.id === tenantId)) throw new Error("UNKNOWN_TENANT");
  const lastDay = new Date().toISOString().slice(0, 10);
  const firstDay = new Date(Date.parse(lastDay) - (days - 1) * 86400000).toISOString().slice(0, 10);
  const scope = tenantId ? " WHERE tenant_id=?" : "";
  const params = tenantId ? [tenantId] : [];
  const sections: AdminSection[] = [];
  const query = async (
    title: string,
    source: string,
    sql: string,
    args: readonly unknown[] = params,
  ) => {
    // Absent telemetry is unavailable, never a fabricated zero. No raw errors reach the client.
    try {
      sections.push({ title, source, rows: await db.many<LedgerRow>(sql, args) });
    } catch {
      sections.push({ title, source, rows: null });
    }
  };
  const rollup = await db.one<{ refreshed_at: number; first_day: string; last_day: string }>(
    "SELECT refreshed_at,first_day,last_day FROM admin_rollup_state WHERE id=1",
  );
  await query(
    "Usage",
    "usage_daily; UTC calendar days; token totals unavailable if any invocation has unknown usage. Invalid counts are provider/transport schema outcomes, not semantic review quality.",
    `SELECT pipeline,provider,model,SUM(calls) calls,SUM(completed) completed,SUM(failed) failed,
    SUM(invalid) invalid,SUM(measured) measured,
    CASE WHEN SUM(measured)=SUM(calls) THEN SUM(input_tokens) END input_tokens,
    CASE WHEN SUM(measured)=SUM(calls) THEN SUM(output_tokens) END output_tokens
    FROM usage_daily WHERE day BETWEEN ? AND ? ${tenantId ? "AND tenant_id=?" : ""}
    GROUP BY pipeline,provider,model ORDER BY pipeline,provider,model`,
    [firstDay, lastDay, ...params],
  );
  if (!rollup || rollup.first_day > firstDay || rollup.last_day < lastDay) sections[0].rows = null;
  for (const [title, table] of [
    ["Evaluation", "evaluation_jobs"],
    ["Memo composition", "dossier_composition_jobs"],
    ["Factual review", "dossier_review_jobs"],
    ["Acquisition", "scrape_runs"],
    ["Pursuit", "pursuit_preparation_jobs"],
  ])
    await query(
      title,
      `${table}; current persisted status counts, not throughput.`,
      `SELECT status,COUNT(*) jobs FROM ${table}${scope} GROUP BY status ORDER BY status`,
    );
  // Global host data must not be presented as tenant-scoped worker attribution.
  if (!tenantId)
    await query(
      "Workers",
      "worker_heartbeats; last observation per worker/instance. More than 150 seconds old is stale; release SHA is not a configuration revision.",
      `SELECT worker_name,instance_id,release_sha,last_seen_at,
       CASE WHEN (julianday('now')-julianday(last_seen_at))*86400 > 150 THEN 'stale' ELSE 'observed' END observation
       FROM worker_heartbeats ORDER BY worker_name,last_seen_at DESC LIMIT 100`,
      [],
    );
  await query(
    "Tenants",
    "tenants + active memberships; active product users and quotas are not yet measured/configured.",
    `SELECT t.id,t.status,COUNT(m.user_id) members FROM tenants t LEFT JOIN memberships m
      ON m.tenant_id=t.id AND m.status='active' ${tenantId ? "WHERE t.id=?" : ""}
      GROUP BY t.id,t.status ORDER BY t.id`,
  );
  await query(
    "Audit",
    "admin_audit_log; newest 100 events. Tenant scope excludes global events.",
    `SELECT occurred_at,actor_id,action,tenant_id,target,reason,detail_json FROM admin_audit_log${scope} ORDER BY occurred_at DESC,id DESC LIMIT 100`,
  );
  await appendAdminAudit(db, {
    actor: userId,
    action: "console.read",
    tenant: tenantId,
    target: "admin",
    reason: "Opened or refreshed operator console",
    detail: { days },
  });
  return {
    role,
    tenantId,
    firstDay,
    lastDay,
    rollupAt: rollup?.refreshed_at ?? null,
    tenants,
    sections,
  };
}
