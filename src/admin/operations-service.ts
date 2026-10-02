import type { DatabaseAdapter } from "../data/database/adapter";
import { getDatabaseTargetIdentity } from "../data/database";
import { CredentialVault } from "../lib/security/CredentialVault";
import { appendAdminAudit, requirePlatformRole } from "./service";
import { operationalSettings, operationsInstalled } from "./operations-runtime";
import { operationsMutationSchema, type OperationsMutation } from "./operations-contracts";
import { executeRecovery, previewRecovery } from "./operations-recovery";
import { validateWebhookDestination } from "./notification-worker";
import { configJobTables } from "./config-store";
import { randomUUID } from "node:crypto";
import { describeBlobStoreConfiguration } from "../lib/storage/blob-store";

export async function readOperations(db: DatabaseAdapter, actor: string) {
  const role = await requirePlatformRole(db, actor);
  if (!(await operationsInstalled(db))) return { installed: false as const, role };
  const configuration = await operationalSettings(db);
  const identity = getDatabaseTargetIdentity();
  const queues = [];
  for (const [pipeline, table] of Object.entries(configJobTables)) {
    const row = await db.one<{
      waiting: number;
      active: number;
      terminal: number;
      oldest: string | number | null;
    }>(`SELECT
      SUM(status IN ('pending','retry','queued','staged_pending')) waiting,
      SUM(status IN ('processing','staged_processing')) active,
      SUM(status IN ('failed','needs_attention','staged_dead_letter')) terminal,
      MIN(CASE WHEN status IN ('pending','retry','queued','staged_pending') THEN created_at END) oldest FROM ${table}`);
    queues.push({ pipeline, ...row });
  }
  let callbackValid = false;
  try {
    const callback = new URL(process.env.GOOGLE_REDIRECT_URI ?? "");
    const origin = process.env.RADAR_PUBLIC_ORIGIN ?? process.env.APP_URL;
    callbackValid =
      callback.pathname === "/api/auth/callback" &&
      (callback.protocol === "https:" || callback.hostname === "localhost") &&
      Boolean(origin) &&
      callback.origin === new URL(origin!).origin;
  } catch {}
  let vaultAvailable = true;
  try {
    new CredentialVault();
  } catch {
    vaultAvailable = false;
  }
  let storageStatus = "valid";
  try {
    describeBlobStoreConfiguration();
  } catch {
    storageStatus = "invalid";
  }
  const workers = await db.many<Record<string, string | number | null>>(
    "SELECT * FROM worker_heartbeats ORDER BY last_seen_at DESC LIMIT 100",
  );
  const receipts = await db.many<Record<string, string | number | null>>(
    "SELECT * FROM worker_runtime_receipts ORDER BY last_seen_at DESC LIMIT 100",
  );
  const attention: Array<{ severity: string; message: string; target: string }> = [];
  const workerNames = {
    evaluation: "evaluation",
    dossier: "dossier-composition",
    factual_review: "dossier-review",
    pursuit: "pursuit-preparation",
  };
  for (const queue of queues) {
    const workerName = workerNames[queue.pipeline as keyof typeof workerNames];
    const online = workers.some(
      (w) =>
        w.worker_name === workerName &&
        Date.parse(String(w.last_seen_at)) > Date.now() - 150000 &&
        w.release_sha === (process.env.RADAR_RELEASE_SHA ?? "development") &&
        w.database_fingerprint === identity.fingerprint,
    );
    if ((queue.waiting ?? 0) > 0 && !online)
      attention.push({
        severity: "High",
        message: `${queue.pipeline}: required worker offline or deployment identity mismatched; ${queue.waiting} waiting`,
        target: "runtime",
      });
  }
  for (const receipt of receipts)
    if (
      Number(receipt.last_seen_at) > Date.now() - 150000 &&
      receipt.connection_id === "runtime" &&
      Object.values(workerNames).includes(String(receipt.worker_name)) &&
      receipt.config_revision !== `operational:${configuration.revision}`
    )
      attention.push({
        severity: "Warning",
        message: `${receipt.worker_name}: configuration revision ${configuration.revision} not yet loaded`,
        target: "runtime",
      });
  if (
    (process.env.AUTH_SESSION_SECRET?.length ?? 0) < 32 ||
    !process.env.GOOGLE_CLIENT_ID ||
    !process.env.GOOGLE_CLIENT_SECRET ||
    !callbackValid
  )
    attention.push({
      severity: "Critical",
      message: "Authentication bootstrap configuration missing, invalid or unverified",
      target: "runtime",
    });
  if (!vaultAvailable)
    attention.push({
      severity: "Critical",
      message: "Credential encryption key unavailable",
      target: "runtime",
    });
  if (storageStatus === "invalid")
    attention.push({
      severity: "Critical",
      message: "Storage topology invalid",
      target: "runtime",
    });
  return {
    installed: true as const,
    role,
    configuration,
    queues,
    attention,
    deployment: {
      releaseSha: process.env.RADAR_RELEASE_SHA ?? "development",
      databaseFingerprint: identity.fingerprint,
      sessionSecretConfigured: (process.env.AUTH_SESSION_SECRET?.length ?? 0) >= 32,
      oauthConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      callbackValid,
      callbackOriginStatus:
        process.env.RADAR_PUBLIC_ORIGIN || process.env.APP_URL
          ? "checked"
          : "deployment origin unavailable",
      vaultAvailable,
      migrationInstalled: true,
      storageStatus,
      bedrock: {
        credentialConfigured: Boolean(process.env.BEDROCK_MANTLE_API_KEY),
        source: "host",
        version: process.env.RADAR_MODEL_CREDENTIAL_VERSION ?? "unversioned host setting",
        rotation: "deployment-managed",
      },
      adc: {
        projectConfigured: Boolean(process.env.GCP_PROJECT_ID),
        project: process.env.GCP_PROJECT_ID ?? null,
        status: "host-managed; token viability requires worker probe",
      },
    },
    incidents: await db.many<Record<string, string | number | null>>(
      "SELECT i.*,(SELECT COUNT(*) FROM provider_incident_jobs j WHERE j.incident_id=i.id) affected_jobs FROM provider_incidents i ORDER BY (state!='resolved') DESC,last_seen DESC LIMIT 50",
    ),
    linkedJobs: await db.many<Record<string, string | number | null>>(
      "SELECT j.* FROM provider_incident_jobs j JOIN provider_incidents i ON i.id=j.incident_id WHERE i.state!='resolved' ORDER BY i.first_seen LIMIT 500",
    ),
    receipts,
    workers,
    actions: await db.many<Record<string, string | number | null>>(
      "SELECT * FROM recovery_actions ORDER BY created_at DESC LIMIT 30",
    ),
    actionJobs: await db.many<Record<string, string | number | null>>(
      "SELECT rj.* FROM recovery_action_jobs rj JOIN recovery_actions ra ON ra.id=rj.action_id ORDER BY ra.created_at DESC LIMIT 300",
    ),
    deliveries: await db.many<Record<string, string | number | null>>(
      "SELECT id,incident_id,event,status,attempts,error_code,delivered_at FROM notification_deliveries ORDER BY next_attempt_at DESC LIMIT 30",
    ),
    webhook: await db.one<{ url: string; minimum_severity: string; send_recovery: number }>(
      "SELECT url,minimum_severity,send_recovery FROM operational_webhooks WHERE id=1",
    ),
    hostChecks: await db.many<Record<string, string | number | null>>(
      "SELECT id,provider,status,created_at,worker_name,worker_instance,release_sha,database_fingerprint,completed_at,error_code,details_json FROM provider_host_checks ORDER BY created_at DESC LIMIT 20",
    ),
  };
}
export async function mutateOperations(
  db: DatabaseAdapter,
  actor: string,
  input: OperationsMutation,
) {
  const data = operationsMutationSchema.parse(input);
  await requirePlatformRole(db, actor, true);
  if (data.kind === "preview")
    return previewRecovery(db, actor, data.incidentId, data.jobIds, data.reason);
  if (data.kind === "execute") return executeRecovery(db, actor, data.actionId, data.reason);
  const envelope =
    data.kind === "webhook" ? JSON.stringify(new CredentialVault().encrypt(data.secret)) : null;
  if (data.kind === "webhook") await validateWebhookDestination(data.url);
  return db.transaction(async (tx) => {
    await requirePlatformRole(tx, actor, true);
    if (data.kind === "throughput") {
      const changed = await tx.execute(
        "UPDATE operational_settings SET revision=revision+1,settings_json=?,updated_at=?,updated_by=? WHERE id=1 AND revision=?",
        [JSON.stringify(data.settings), Date.now(), actor, data.revision],
      );
      if (!changed.rowsAffected) throw new Error("ADMIN_STATE_CHANGED");
    } else if (data.kind === "acknowledge") {
      if (
        !(
          await tx.execute(
            "UPDATE provider_incidents SET state=CASE WHEN state='open' THEN 'acknowledged' ELSE state END,acknowledged_at=?,acknowledged_by=? WHERE id=? AND state!='resolved'",
            [Date.now(), actor, data.incidentId],
          )
        ).rowsAffected
      )
        throw new Error("INCIDENT_NOT_OPEN");
    } else if (data.kind === "snooze") {
      if (
        !(
          await tx.execute(
            "UPDATE provider_incidents SET snoozed_until=? WHERE id=? AND state!='resolved'",
            [Date.now() + data.minutes * 60000, data.incidentId],
          )
        ).rowsAffected
      )
        throw new Error("INCIDENT_NOT_OPEN");
    } else if (data.kind === "webhook") {
      await tx.execute(
        "INSERT INTO operational_webhooks VALUES(1,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url,secret_envelope=excluded.secret_envelope,minimum_severity=excluded.minimum_severity,send_recovery=excluded.send_recovery,updated_at=excluded.updated_at,updated_by=excluded.updated_by",
        [data.url, envelope, data.severity, data.recovery ? 1 : 0, Date.now(), actor],
      );
    } else if (data.kind === "host_probe") {
      await tx.execute(
        "INSERT INTO provider_host_checks(id,provider,status,created_at,created_by) VALUES(?,?,'queued',?,?)",
        [randomUUID(), data.provider, Date.now(), actor],
      );
    }
    await appendAdminAudit(tx, {
      actor,
      action: `operations.${data.kind}`,
      target: "incidentId" in data ? data.incidentId : "platform",
      reason: data.reason,
      detail:
        data.kind === "throughput"
          ? { revision: data.revision, settings: data.settings }
          : data.kind === "webhook"
            ? {
                destination: new URL(data.url).origin,
                severity: data.severity,
                recovery: data.recovery,
              }
            : {},
    });
    return { ok: true };
  });
}
