import type { DatabaseAdapter } from "../data/database/adapter";
import { appendAdminAudit, requirePlatformRole } from "./service";
import {
  quotaDimensions,
  validateQuota,
  validateProtectionMutation,
  type ProtectionMutation,
  type TenantQuota,
} from "./protection-contracts";
export async function applyProtectionMutation(
  db: DatabaseAdapter,
  actor: string,
  input: ProtectionMutation,
) {
  const data = validateProtectionMutation(input);
  return db.transaction(async (tx) => {
    await requirePlatformRole(tx, actor, true);
    const tenant = "tenant" in data ? data.tenant : undefined;
    if (tenant && !(await tx.one("SELECT id FROM tenants WHERE id=?", [tenant])))
      throw new Error("UNKNOWN_TENANT");
    if (["quota", "override"].includes(data.kind) && !tenant) throw new Error("TENANT_REQUIRED");
    if (data.kind === "quota") {
      const q = validateQuota(data.quota);
      const before = await tx.one("SELECT * FROM tenant_quotas WHERE tenant_id=?", [data.tenant]);
      const keys = [...quotaDimensions, "job_input_tokens", "job_output_tokens"] as const;
      await tx.execute(
        `INSERT INTO tenant_quotas(tenant_id,${keys.join(",")},updated_at,updated_by) VALUES(${Array(12).fill("?").join(",")})
        ON CONFLICT(tenant_id) DO UPDATE SET ${keys.map((k) => `${k}=excluded.${k}`).join(",")},updated_at=excluded.updated_at,updated_by=excluded.updated_by`,
        [data.tenant, ...keys.map((k) => q[k]), Date.now(), actor],
      );
      await tx.execute(
        "DELETE FROM quota_deferrals WHERE tenant_id=? AND reason NOT IN ('PAUSED','JOB_TOKEN_CEILING','INVALID_OUTPUT_RETRY_STORM')",
        [data.tenant],
      );
      if (
        before &&
        (q.job_input_tokens > Number((before as TenantQuota).job_input_tokens) ||
          q.job_output_tokens > Number((before as TenantQuota).job_output_tokens))
      )
        await tx.execute(
          "DELETE FROM quota_deferrals WHERE tenant_id=? AND reason='JOB_TOKEN_CEILING'",
          [data.tenant],
        );
      await appendAdminAudit(tx, {
        actor: actor,
        action: "quota.set",
        tenant: data.tenant,
        target: data.tenant,
        reason: data.reason,
        detail: { before, after: q },
      });
    } else if (data.kind === "override") {
      if (!(await tx.one("SELECT tenant_id FROM tenant_quotas WHERE tenant_id=?", [data.tenant])))
        throw new Error("CONFIGURE_QUOTAS_FIRST");
      const before = await tx.one(
        "SELECT * FROM tenant_quota_overrides WHERE tenant_id=? AND dimension=?",
        [data.tenant, data.dimension],
      );
      await tx.execute(
        `INSERT INTO tenant_quota_overrides VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,dimension) DO UPDATE SET
       limit_value=excluded.limit_value,expires_at=excluded.expires_at,reason=excluded.reason,actor_id=excluded.actor_id`,
        [data.tenant, data.dimension, data.limit, data.expires, data.reason, actor],
      );
      await tx.execute(
        "DELETE FROM quota_deferrals WHERE tenant_id=? AND reason NOT IN ('PAUSED','JOB_TOKEN_CEILING','INVALID_OUTPUT_RETRY_STORM')",
        [data.tenant],
      );
      await appendAdminAudit(tx, {
        actor: actor,
        action: "quota.override",
        tenant: data.tenant,
        target: data.dimension,
        reason: data.reason,
        detail: { before, limit: data.limit, expires: data.expires },
      });
    } else if (data.kind === "pause") {
      const scope = tenant ?? "*";
      const before = await tx.one(
        "SELECT * FROM pipeline_controls WHERE scope_key=? AND pipeline=?",
        [scope, data.pipeline],
      );
      await tx.execute(
        `INSERT INTO pipeline_controls VALUES(?,?,?,?,?,?) ON CONFLICT(scope_key,pipeline) DO UPDATE SET
       paused=excluded.paused,reason=excluded.reason,actor_id=excluded.actor_id,updated_at=excluded.updated_at`,
        [scope, data.pipeline, data.paused ? 1 : 0, data.reason, actor, Date.now()],
      );
      if (!data.paused)
        await tx.execute(
          `DELETE FROM quota_deferrals WHERE reason='PAUSED' ${tenant ? "AND tenant_id=?" : ""}`,
          tenant ? [tenant] : [],
        );
      await appendAdminAudit(tx, {
        actor: actor,
        action: data.paused ? "pipeline.pause" : "pipeline.resume",
        tenant,
        target: data.pipeline,
        reason: data.reason,
        detail: { before, after: { scope, pipeline: data.pipeline, paused: data.paused } },
      });
    } else if (data.kind === "resume_job") {
      const before = await tx.one(
        "SELECT * FROM quota_deferrals WHERE tenant_id=? AND pipeline=? AND job_id=?",
        [data.tenant, data.pipeline, data.jobId],
      );
      if (!before) throw new Error("JOB_NOT_DEFERRED");
      await tx.execute(
        "UPDATE quota_jobs SET invalid_reviewed_at=?,invalid_reviewed_count=(SELECT COUNT(*) FROM quota_calls c WHERE c.pipeline=quota_jobs.pipeline AND c.job_id=quota_jobs.job_id AND c.status='invalid_output') WHERE tenant_id=? AND pipeline=? AND job_id=?",
        [Date.now(), data.tenant, data.pipeline, data.jobId],
      );
      await tx.execute(
        "DELETE FROM quota_deferrals WHERE tenant_id=? AND pipeline=? AND job_id=?",
        [data.tenant, data.pipeline, data.jobId],
      );
      await appendAdminAudit(tx, {
        actor,
        action: "job.resume",
        tenant: data.tenant,
        target: `${data.pipeline}:${data.jobId}`,
        reason: data.reason,
        detail: { before, tokenSpendPreserved: true },
      });
    } else {
      const entry = await tx.one<{ tenant_id: string }>(
        "SELECT tenant_id FROM admin_alerts WHERE id=?",
        [data.alertId],
      );
      if (!entry) throw new Error("UNKNOWN_ALERT");
      await tx.execute("UPDATE admin_alerts SET acknowledged_at=?,acknowledged_by=? WHERE id=?", [
        Date.now(),
        actor,
        data.alertId,
      ]);
      await appendAdminAudit(tx, {
        actor: actor,
        action: "alert.acknowledge",
        tenant: entry.tenant_id,
        target: data.alertId,
        reason: data.reason,
      });
    }
    return { ok: true };
  });
}
