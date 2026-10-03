import type { DatabaseAdapter } from "../data/database/adapter";
import { getDatabaseTargetIdentity } from "../data/database";
import { CredentialVault } from "../lib/security/CredentialVault";
import { appendAdminAudit, requirePlatformRole } from "./service";
import {
  operationalSettings,
  operationsInstalled,
  enqueueIncidentNotification,
} from "./operations-runtime";
import { operationsMutationSchema, type OperationsMutation } from "./operations-contracts";
import { executeRecovery, previewRecovery } from "./operations-recovery";
import { validateWebhookDestination } from "./notification-worker";
import { resolveBedrockCredential } from "../lib/model/bedrock-credential-resolver";
import { configJobTables } from "./config-store";
import { randomUUID } from "node:crypto";
import { describeBlobStoreConfiguration } from "../lib/storage/blob-store";
import { CRITICAL_MAINTENANCE_BY_WORKER } from "../lib/health/maintenance-receipts";

export async function readOperations(db: DatabaseAdapter, actor: string) {
  const role = await requirePlatformRole(db, actor);
  if (!(await operationsInstalled(db))) return { installed: false as const, role };
  const configuration = await operationalSettings(db);
  const identity = getDatabaseTargetIdentity();
  const queues = [];
  const terminalJobs: Record<string, string | number | null>[] = [];
  for (const [pipeline, table] of Object.entries(configJobTables)) {
    const row = await db.one<{
      waiting: number;
      active: number;
      terminal: number;
      dead_letter: number;
      failed: number;
      needs_attention: number;
      oldest: string | number | null;
    }>(`SELECT
      SUM(status IN ('pending','retry','queued','staged_pending')) waiting,
      SUM(status IN ('processing','staged_processing')) active,
      SUM(status IN ('failed','needs_attention','staged_dead_letter','dead_letter')) terminal,
      SUM(status IN ('staged_dead_letter','dead_letter')) dead_letter,
      SUM(status='failed') failed,
      SUM(status='needs_attention') needs_attention,
      MIN(CASE WHEN status IN ('pending','retry','queued','staged_pending') THEN created_at END) oldest FROM ${table}`);
    queues.push({ pipeline, ...row });
    // Pursuit derives immutable opportunity identity through its owning pursuit.
    const owner = pipeline === "pursuit" ? "p" : "j";
    const join =
      pipeline === "pursuit"
        ? "LEFT JOIN opportunity_pursuits p ON p.id=j.pursuit_id AND p.tenant_id=j.tenant_id AND p.person_id=j.person_id"
        : "";
    const jobs = await db.many<Record<string, string | number | null>>(`SELECT
      j.id job_id,j.tenant_id,j.person_id,j.status,j.created_at,
      ${owner}.canonical_job_id,${owner}.opportunity_version,
      ${owner}.evaluation_context_fingerprint context_fingerprint
      FROM ${table} j ${join}
      WHERE j.status IN ('failed','needs_attention','staged_dead_letter','dead_letter')
      ORDER BY j.created_at DESC,j.id LIMIT 100`);
    terminalJobs.push(
      ...jobs.map((job) => ({
        pipeline,
        ...job,
        recovery:
          job.status === "needs_attention" &&
          (pipeline === "dossier" || pipeline === "factual_review")
            ? "Domain retry entry point available; active scope and fingerprint must validate"
            : "Domain recovery policy required; Operations resume unavailable",
      })),
    );
  }
  const documents = await db.one<{
    waiting: number;
    active: number;
    terminal: number;
    dead_letter: number;
    failed: number;
    needs_attention: number;
    oldest: string | null;
  }>(
    `SELECT SUM(status='pending') waiting,SUM(status='processing') active,SUM(status='dead_letter') terminal,
     SUM(status='dead_letter') dead_letter,0 failed,0 needs_attention,
     MIN(CASE WHEN status='pending' THEN created_at END) oldest FROM candidate_document_jobs`,
  );
  queues.push({ pipeline: "documents", ...documents });
  terminalJobs.push(
    ...(
      await db.many<Record<string, string | number | null>>(
        "SELECT id job_id,tenant_id,person_id,document_id,status,created_at FROM candidate_document_jobs WHERE status='dead_letter' ORDER BY created_at DESC,id LIMIT 100",
      )
    ).map((job) => ({
      pipeline: "documents",
      ...job,
      recovery: "Domain recovery policy required; Operations resume unavailable",
    })),
  );
  const bedrockCredential = await resolveBedrockCredential().catch(() => null);
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
    documents: "documents",
  };
  const workerOnline = (name: string) =>
    workers.some(
      (w) =>
        w.worker_name === name &&
        Date.parse(String(w.last_seen_at)) > Date.now() - 150000 &&
        w.release_sha === (process.env.RADAR_RELEASE_SHA ?? "development") &&
        w.database_fingerprint === identity.fingerprint,
    );
  for (const queue of queues) {
    const workerName = workerNames[queue.pipeline as keyof typeof workerNames];
    const online = workerOnline(workerName);
    if ((queue.waiting ?? 0) > 0 && !online)
      attention.push({
        severity: "High",
        message: `${queue.pipeline}: required worker offline or deployment identity mismatched; ${queue.waiting} waiting`,
        target: "runtime",
      });
    if ((queue.terminal ?? 0) > 0)
      attention.push({
        severity: "High",
        message: `${queue.pipeline}: ${queue.dead_letter ?? 0} dead-letter, ${queue.failed ?? 0} failed, ${queue.needs_attention ?? 0} needs-attention jobs; inspect domain recovery`,
        target: `queue-${queue.pipeline}`,
      });
  }
  const maintenancePending = (await db.one<{
    validation: number;
    host_probes: number;
    reconciliation: number;
    notifications: number;
    retirement: number;
    purge: number;
  }>(
    `SELECT
    (SELECT COUNT(*) FROM admin_search_checks WHERE status IN ('queued','running')) validation,
    (SELECT COUNT(*) FROM provider_host_checks WHERE provider IN ('bedrock','google') AND status IN ('queued','running')) host_probes,
    (SELECT COUNT(*) FROM provider_incidents WHERE connection_id IN ('tavily:platform','bedrock:host','google:host') AND state='recovering') reconciliation,
    (SELECT COUNT(*) FROM notification_deliveries WHERE status IN ('queued','retry','sending')) notifications,
    (SELECT COUNT(*) FROM provider_credential_lifecycle l JOIN admin_search_credentials c ON c.id=l.credential_id
      WHERE l.retired_at IS NULL AND l.unreferenced_at<=? AND NOT EXISTS
      (SELECT 1 FROM admin_search_connection s WHERE s.active_id=c.id OR s.candidate_id=c.id OR s.previous_id=c.id)) retirement,
    (SELECT COUNT(*) FROM provider_credential_lifecycle l WHERE l.retired_at<=? AND l.secret_purged_at IS NULL AND NOT EXISTS
      (SELECT 1 FROM admin_search_connection s WHERE s.active_id=l.credential_id OR s.candidate_id=l.credential_id OR s.previous_id=l.credential_id)) purge`,
    [Date.now() - 30 * 86400000, Date.now() - 30 * 86400000],
  ))!;
  const maintenanceTasks = await db.many<Record<string, string | number | null>>(
    "SELECT * FROM operations_maintenance_tasks ORDER BY last_started_at DESC LIMIT 100",
  );
  const maintenanceByWorker = Object.entries(CRITICAL_MAINTENANCE_BY_WORKER).map(
    ([name, tasks]) => ({
      name,
      online: workerOnline(name),
      healthy: workers.some(
        (w) =>
          w.worker_name === name &&
          w.release_sha === (process.env.RADAR_RELEASE_SHA ?? "development") &&
          w.database_fingerprint === identity.fingerprint &&
          Date.parse(String(w.last_seen_at)) > Date.now() - 150000 &&
          tasks.every((task) =>
            maintenanceTasks.some(
              (r) =>
                r.worker_instance === w.instance_id &&
                r.task === task &&
                r.release_sha === w.release_sha &&
                r.database_fingerprint === w.database_fingerprint &&
                Number(r.last_success_at) > Date.now() - 150000 &&
                r.consecutive_failures === 0,
            ),
          ),
      ),
    }),
  );
  const maintenance = {
    online: maintenanceByWorker.every((worker) => worker.online),
    healthy: maintenanceByWorker.every((worker) => worker.healthy),
    workers: maintenanceByWorker,
    tasks: maintenanceTasks,
    pending: maintenancePending,
  };
  if (maintenanceByWorker.some((worker) => worker.online && !worker.healthy))
    attention.push({
      severity: "High",
      message: "Operations maintenance missing, stale or failing; inspect individual task receipts",
      target: "maintenance",
    });
  if (!maintenance.online && Object.values(maintenance.pending).some((count) => count > 0))
    attention.push({
      severity: "High",
      message:
        "Evaluation maintenance worker unavailable or dossier-review maintenance worker unavailable: pending validation, host probes, retention, reconciliation or notification delivery cannot progress",
      target: "maintenance",
    });
  for (const receipt of receipts)
    if (
      Number(receipt.last_seen_at) > Date.now() - 150000 &&
      receipt.connection_id === "runtime" &&
      Object.entries(workerNames).some(
        ([pipeline, name]) =>
          pipeline in configuration.settings && name === String(receipt.worker_name),
      ) &&
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
    terminalJobs,
    maintenance,
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
        credentialConfigured: Boolean(bedrockCredential),
        source: "host",
        version: bedrockCredential?.version ?? "unavailable",
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
      "SELECT id,incident_id,event,status,attempts,error_code,delivered_at,destination_revision FROM notification_deliveries ORDER BY next_attempt_at DESC LIMIT 30",
    ),
    webhook: await db.one<{
      url: string;
      minimum_severity: string;
      send_recovery: number;
      revision: number;
      pending_deliveries: number;
    }>(`SELECT w.url,w.minimum_severity,w.send_recovery,w.revision,
      (SELECT COUNT(*) FROM notification_deliveries d WHERE d.status IN ('queued','retry','sending')) pending_deliveries
      FROM operational_webhooks w WHERE w.id=1`),
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
  let webhookRevision: number | null = null;
  let webhookPendingCancelled = 0;
  let webhookPendingRequeued = 0;
  return db.transaction(async (tx) => {
    await requirePlatformRole(tx, actor, true);
    if (data.kind === "exclude") {
      const job = await tx.one<Record<string, string | number | null>>(
        "SELECT j.* FROM provider_incident_jobs j JOIN provider_incidents i ON i.id=j.incident_id WHERE j.incident_id=? AND j.pipeline=? AND j.job_id=? AND i.connection_id IN ('tavily:platform','bedrock:host','google:host') AND i.state!='resolved'",
        [data.incidentId, data.pipeline, data.jobId],
      );
      if (!job) throw new Error("RECOVERY_JOB_NOT_IN_INCIDENT");
      if (job.accounted_reason === "OPERATOR_EXCLUDED")
        throw new Error("RECOVERY_JOB_ALREADY_EXCLUDED");
      await tx.execute(
        "UPDATE provider_incident_jobs SET accounted_reason='OPERATOR_EXCLUDED' WHERE incident_id=? AND pipeline=? AND job_id=?",
        [data.incidentId, data.pipeline, data.jobId],
      );
      await appendAdminAudit(tx, {
        actor,
        action: "recovery.exclude",
        tenant: String(job.tenant_id),
        target: data.incidentId,
        reason: data.reason,
        detail: {
          pipeline: data.pipeline,
          jobId: data.jobId,
          tenantId: job.tenant_id,
          personId: job.person_id,
          canonicalJobId: job.canonical_job_id,
          opportunityVersion: job.opportunity_version,
          contextFingerprint: job.context_fingerprint,
        },
      });
      return { ok: true };
    } else if (data.kind === "throughput") {
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
      const prior = await tx.one<{ revision: number }>(
        "SELECT revision FROM operational_webhooks WHERE id=1",
      );
      const revision = (prior?.revision ?? 0) + 1;
      const pending = await tx.many<{ incident_id: string; event: "opened" | "resolved" }>(
        `SELECT DISTINCT d.incident_id,d.event FROM notification_deliveries d
         JOIN provider_incidents i ON i.id=d.incident_id
         WHERE d.destination_revision<? AND d.status IN ('queued','retry','sending')
         AND ((d.event='opened' AND i.state!='resolved') OR (d.event='resolved' AND i.state='resolved'))`,
        [revision],
      );
      const cancelled = prior
        ? await tx.execute(
            `UPDATE notification_deliveries SET status='cancelled',error_code='DESTINATION_ROTATED',
              lease_token=NULL,lease_until=NULL
              WHERE destination_revision<? AND status IN ('queued','retry','sending')`,
            [revision],
          )
        : { rowsAffected: 0 };
      webhookRevision = revision;
      webhookPendingCancelled = cancelled.rowsAffected;
      await tx.execute(
        `INSERT INTO operational_webhooks(id,url,secret_envelope,minimum_severity,send_recovery,updated_at,updated_by,revision)
          VALUES(1,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url,
          secret_envelope=excluded.secret_envelope,minimum_severity=excluded.minimum_severity,
          send_recovery=excluded.send_recovery,updated_at=excluded.updated_at,
          updated_by=excluded.updated_by,revision=excluded.revision`,
        [data.url, envelope, data.severity, data.recovery ? 1 : 0, Date.now(), actor, revision],
      );
      for (const delivery of pending) {
        await enqueueIncidentNotification(tx, delivery.incident_id, delivery.event);
      }
      webhookPendingRequeued = (await tx.one<{ n: number }>(
        "SELECT COUNT(*) n FROM notification_deliveries WHERE destination_revision=? AND status='queued'",
        [revision],
      ))!.n;
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
                revision: webhookRevision,
                pendingCancelled: webhookPendingCancelled,
                pendingRequeued: webhookPendingRequeued,
              }
            : {},
    });
    return { ok: true };
  });
}
