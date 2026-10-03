import type { DatabaseAdapter } from "../data/database/adapter";
import type { WorkIdentity } from "../admin/operations-contracts";
import { configJobTables } from "../admin/config-store";

export type QueueRecoveryOutcome = { outcome: "resumed" | "skipped" | "blocked"; reason: string };
/** Queue-owned recovery: pending operational work only; terminal retry needs its own domain validation. */
export async function resumeOperationalWork(
  db: DatabaseAdapter,
  identity: WorkIdentity,
  execute = true,
): Promise<QueueRecoveryOutcome> {
  if (identity.pipeline === "pursuit")
    return { outcome: "blocked", reason: "PURSUIT_DOMAIN_RETRY_REQUIRED" };
  const table = configJobTables[identity.pipeline];
  return db.transaction(async (tx) => {
    const row = await tx.one<Record<string, string | number | null>>(
      `SELECT * FROM ${table} WHERE id=? AND tenant_id=? AND person_id=? AND canonical_job_id=? AND opportunity_version=? AND evaluation_context_fingerprint=?`,
      [
        identity.jobId,
        identity.tenantId,
        identity.personId,
        identity.canonicalJobId,
        identity.opportunityVersion,
        identity.contextFingerprint,
      ],
    );
    if (!row) return { outcome: "blocked", reason: "IDENTITY_CHANGED" };
    if (
      await tx.one(
        "SELECT scope_key FROM pipeline_controls WHERE paused=1 AND scope_key IN ('*',?) AND pipeline IN ('*',?)",
        [identity.tenantId, identity.pipeline],
      )
    )
      return { outcome: "skipped", reason: "MANUALLY_PAUSED" };
    if (identity.pipeline === "evaluation") {
      const control = await tx.one<{ desired_state: string }>(
        "SELECT desired_state FROM evaluation_runtime_control WHERE tenant_id=? AND person_id=?",
        [identity.tenantId, identity.personId],
      );
      if (control?.desired_state !== "RUNNING")
        return { outcome: "skipped", reason: "MANUALLY_PAUSED" };
      if (
        !(await tx.one(
          "SELECT context_fingerprint FROM active_evaluation_contexts WHERE tenant_id=? AND person_id=? AND search_plan_id=? AND context_fingerprint=?",
          [identity.tenantId, identity.personId, row.search_plan_id, identity.contextFingerprint],
        ))
      )
        return { outcome: "blocked", reason: "CONTEXT_NOT_ACTIVE" };
      if (
        !(await tx.one(
          "SELECT status FROM evaluation_requirements WHERE tenant_id=? AND person_id=? AND search_plan_id=? AND canonical_job_id=? AND opportunity_version=? AND evaluation_context_fingerprint=? AND status='READY'",
          [
            identity.tenantId,
            identity.personId,
            row.search_plan_id,
            identity.canonicalJobId,
            identity.opportunityVersion,
            identity.contextFingerprint,
          ],
        ))
      )
        return { outcome: "blocked", reason: "DEPENDENCY_NOT_READY" };
    }
    if (["completed", "staged_completed"].includes(String(row.status)))
      return { outcome: "skipped", reason: "ALREADY_COMPLETED" };
    if (!["pending", "retry", "staged_pending"].includes(String(row.status)))
      return {
        outcome: "blocked",
        reason: String(row.status).includes("processing")
          ? "CURRENTLY_LEASED"
          : "DOMAIN_RETRY_REQUIRED",
      };
    if (row.lease_token) return { outcome: "blocked", reason: "CURRENTLY_LEASED" };
    if (
      await tx.one(
        "SELECT reason FROM quota_deferrals WHERE pipeline=? AND job_id=? AND retry_at>?",
        [identity.pipeline, identity.jobId, Date.now()],
      )
    )
      return { outcome: "blocked", reason: "QUOTA_OR_POLICY_DEFERRED" };
    if (!execute) return { outcome: "resumed", reason: "ELIGIBLE_CHECKPOINTS_PRESERVED" };
    const due = identity.pipeline === "evaluation" ? "CURRENT_TIMESTAMP" : "?";
    const result = await tx.execute(
      `UPDATE ${table} SET next_attempt_at=${due} WHERE id=? AND tenant_id=? AND person_id=? AND status=? AND lease_token IS NULL`,
      [
        ...(identity.pipeline === "evaluation" ? [] : [Date.now()]),
        identity.jobId,
        identity.tenantId,
        identity.personId,
        row.status,
      ],
    );
    return result.rowsAffected
      ? { outcome: "resumed", reason: "VALID_CHECKPOINTS_PRESERVED" }
      : { outcome: "blocked", reason: "STATE_CHANGED" };
  });
}
