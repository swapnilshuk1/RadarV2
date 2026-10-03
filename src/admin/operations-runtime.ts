import { createHash, randomUUID } from "node:crypto";
import type { DatabaseAdapter } from "../data/database/adapter";
import {
  defaultThroughput,
  throughputSchema,
  type ProviderFailure,
  type RuntimeReceipt,
  type WorkIdentity,
} from "./operations-contracts";
import { ModelProviderUnavailableError } from "../lib/model/provider-unavailable";

export async function operationsInstalled(db: DatabaseAdapter) {
  return Boolean(await db.one("SELECT name FROM sqlite_master WHERE name='provider_incidents'"));
}
export async function operationalSettings(db: DatabaseAdapter) {
  if (!(await operationsInstalled(db)))
    return { revision: 0, settings: defaultThroughput, installed: false };
  const row = await db.one<{ revision: number; settings_json: string }>(
    "SELECT revision,settings_json FROM operational_settings WHERE id=1",
  );
  return {
    revision: row!.revision,
    settings: throughputSchema.parse(JSON.parse(row!.settings_json)),
    installed: true,
  };
}
export async function jobConcurrency(
  db: DatabaseAdapter,
  pipeline: WorkIdentity["pipeline"],
  fallback: number,
) {
  const config = await operationalSettings(db);
  loadedOperationalRevision = config.revision;
  const count =
    !config.installed || config.revision === 0
      ? fallback
      : config.settings.profile === "Recovery"
        ? 1
        : config.settings.profile === "Conservative"
          ? Math.max(1, Math.ceil(config.settings[pipeline] / 2))
          : config.settings[pipeline];
  loadedOperationalSettings = {
    pipeline,
    jobConcurrency: count,
    source: config.revision === 0 ? "host" : "admin",
    profile: config.settings.profile,
    providerConcurrency:
      config.settings.profile === "Recovery" ? 1 : config.settings.providerConcurrency,
  };
  return count;
}
let loadedOperationalRevision: number | undefined;
let loadedOperationalSettings: Record<string, unknown> | undefined;
export function effectiveOperationalSettings() {
  return loadedOperationalSettings;
}
export function effectiveOperationalRevision() {
  return loadedOperationalRevision;
}
export async function writeRuntimeReceipt(db: DatabaseAdapter, receipt: RuntimeReceipt) {
  if (!(await operationsInstalled(db))) return;
  await db.execute(
    `INSERT INTO worker_runtime_receipts(instance_id,connection_id,worker_name,runtime_role,release_sha,database_fingerprint,config_revision,generation,credential_version,credential_source,reload_mode,reload_status,error_code,started_at,loaded_at,last_seen_at,effective_settings_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(instance_id,connection_id) DO UPDATE SET
    config_revision=excluded.config_revision,generation=excluded.generation,credential_version=excluded.credential_version,
    credential_source=excluded.credential_source,reload_mode=excluded.reload_mode,reload_status=excluded.reload_status,
    error_code=excluded.error_code,loaded_at=excluded.loaded_at,last_seen_at=excluded.last_seen_at,effective_settings_json=excluded.effective_settings_json`,
    [
      receipt.instanceId,
      receipt.connectionId,
      receipt.workerName,
      receipt.runtimeRole,
      receipt.releaseSha,
      receipt.databaseFingerprint,
      receipt.configRevision,
      receipt.generation,
      receipt.credentialVersion,
      receipt.credentialSource,
      receipt.reloadMode,
      receipt.reloadStatus,
      receipt.errorCode,
      receipt.startedAt,
      receipt.loadedAt,
      receipt.lastSeenAt,
      JSON.stringify(receipt.effectiveSettings ?? {}),
    ],
  );
}
const ranks: Record<string, number> = { Info: 0, Warning: 1, High: 2, Critical: 3 };
export async function enqueueIncidentNotification(
  db: DatabaseAdapter,
  incidentId: string,
  event: "opened" | "resolved",
) {
  const incident = await db.one<{ severity: string; provider: string; failure_class: string }>(
    "SELECT severity,provider,failure_class FROM provider_incidents WHERE id=?",
    [incidentId],
  );
  let openedSuperseded = 0;
  if (incident && event === "resolved") {
    const cancelled = await db.execute(
      `UPDATE notification_deliveries SET status='cancelled',error_code='INCIDENT_RESOLVED_BEFORE_DELIVERY',
        lease_token=NULL,lease_until=NULL
        WHERE incident_id=? AND event='opened' AND status IN ('queued','retry','sending')`,
      [incidentId],
    );
    openedSuperseded = cancelled.rowsAffected;
  }
  const destination = await db.one<{
    url: string;
    secret_envelope: string;
    minimum_severity: string;
    send_recovery: number;
    revision: number;
  }>("SELECT * FROM operational_webhooks WHERE id=1");
  if (
    !incident ||
    !destination ||
    ranks[incident.severity] < ranks[destination.minimum_severity] ||
    (event === "resolved" && !destination.send_recovery)
  )
    return;
  const id = randomUUID();
  const affected = await db.one<{ n: number }>(
    "SELECT COUNT(*) n FROM provider_incident_jobs WHERE incident_id=?",
    [incidentId],
  );
  await db.execute(
    `INSERT INTO notification_deliveries(id,incident_id,event,destination_url,secret_envelope,payload_json,next_attempt_at,destination_revision)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(incident_id,event,destination_url) DO NOTHING`,
    [
      id,
      incidentId,
      event,
      destination.url,
      destination.secret_envelope,
      JSON.stringify({
        eventId: `${incidentId}:${event}`,
        incidentId,
        event,
        summary:
          event === "resolved" && openedSuperseded > 0
            ? "Incident resolved while its opening alert was pending; an in-flight request may still arrive."
            : undefined,
        supersededOpenedDeliveries: openedSuperseded,
        provider: incident.provider,
        severity: incident.severity,
        failureClass: incident.failure_class,
        affectedJobs: affected?.n ?? 0,
        destinationRevision: destination.revision,
      }),
      Date.now(),
      destination.revision,
    ],
  );
}
/** All persisted error detail is application-owned; never accept provider bodies. */
export async function observeProviderFailure(
  db: DatabaseAdapter,
  input: {
    connectionId: string;
    provider: string;
    generation: number;
    failure: ProviderFailure;
    deployment: string;
    releaseSha?: string;
    status?: number;
    retryAfterMs?: number;
    work?: WorkIdentity;
  },
  now = Date.now(),
) {
  if (!(await operationsInstalled(db))) return null;
  return db.transaction(async (tx) => {
    if (input.connectionId === "tavily:platform") {
      const active = await tx.one<{ generation: number }>(
        "SELECT generation FROM admin_search_connection WHERE id=1",
      );
      if (active?.generation !== input.generation) return null; // A late response from a superseded version cannot disable its replacement.
    }
    const correlation = createHash("sha256")
      .update(JSON.stringify([input.provider, input.connectionId, input.failure, input.deployment]))
      .digest("hex");
    const existing = await tx.one<{ id: string; first_seen: number; occurrences: number }>(
      "SELECT id,first_seen,occurrences FROM provider_incidents WHERE correlation_key=? AND state!='resolved'",
      [correlation],
    );
    const id = existing?.id ?? randomUUID();
    const errorCode = `${input.failure.toUpperCase()}${input.status ? `_HTTP_${input.status}` : ""}`;
    const severity =
      input.failure === "credential" || input.failure === "vault"
        ? "Critical"
        : input.failure === "quota_exhausted"
          ? "High"
          : ["timeout", "transport", "invalid_response"].includes(input.failure) &&
              (!existing || existing.occurrences < 2)
            ? "Info"
            : "Warning";
    if (existing)
      await tx.execute(
        "UPDATE provider_incidents SET last_seen=?,occurrences=occurrences+1,error_code=?,severity=?,last_release_sha=? WHERE id=?",
        [
          now,
          errorCode,
          severity,
          input.releaseSha ?? process.env.RADAR_RELEASE_SHA ?? "development",
          id,
        ],
      );
    else {
      const previous = await tx.one<{ id: string }>(
        "SELECT id FROM provider_incidents WHERE correlation_key=? ORDER BY first_seen DESC LIMIT 1",
        [correlation],
      );
      await tx.execute(
        `INSERT INTO provider_incidents(id,correlation_key,provider,connection_id,generation,failure_class,severity,state,recurrence_of,first_seen,last_seen,error_code,first_release_sha,last_release_sha)
        VALUES(?,?,?,?,?,?,?,'open',?,?,?,?,?,?)`,
        [
          id,
          correlation,
          input.provider,
          input.connectionId,
          input.generation,
          input.failure,
          severity,
          previous?.id ?? null,
          now,
          now,
          errorCode,
          input.releaseSha ?? process.env.RADAR_RELEASE_SHA ?? "development",
          input.releaseSha ?? process.env.RADAR_RELEASE_SHA ?? "development",
        ],
      );
    }
    await tx.execute(
      "INSERT INTO provider_incident_observations(id,incident_id,observed_at,error_code,release_sha,database_fingerprint) VALUES(?,?,?,?,?,?)",
      [
        randomUUID(),
        id,
        now,
        errorCode,
        input.releaseSha ?? process.env.RADAR_RELEASE_SHA ?? "development",
        input.deployment,
      ],
    );
    await tx.execute(
      "DELETE FROM provider_incident_observations WHERE incident_id=? AND id NOT IN (SELECT id FROM provider_incident_observations WHERE incident_id=? ORDER BY observed_at DESC LIMIT 100)",
      [id, id],
    );
    if (input.work) await associateIncidentWork(tx, id, input.work);
    const prior = await tx.one<{ failures: number; requires_action: number }>(
      "SELECT failures,requires_action FROM provider_cooldowns WHERE connection_id=?",
      [input.connectionId],
    );
    const delay = Math.max(
      Math.min(900_000, Math.max(0, input.retryAfterMs ?? 0)),
      Math.min(120_000, 30_000 * 2 ** Math.min(prior?.failures ?? 0, 2)),
    );
    const action = ["credential", "quota_exhausted", "vault"].includes(input.failure) ? 1 : 0;
    await tx.execute(
      `INSERT INTO provider_cooldowns(connection_id,generation,blocked_until,requires_action,failures,failure_class,active_incident_id) VALUES(?,?,?,?,1,?,?)
      ON CONFLICT(connection_id) DO UPDATE SET generation=excluded.generation,blocked_until=MAX(blocked_until,excluded.blocked_until),
      active_incident_id=CASE WHEN requires_action=1 AND excluded.requires_action=0 THEN active_incident_id ELSE excluded.active_incident_id END,
      failure_class=CASE WHEN requires_action=1 AND excluded.requires_action=0 THEN failure_class ELSE excluded.failure_class END,
      requires_action=MAX(requires_action,excluded.requires_action),failures=failures+1`,
      [input.connectionId, input.generation, now + delay, action, input.failure, id],
    );
    await enqueueIncidentNotification(tx, id, "opened");
    return id;
  });
}
export async function associateIncidentWork(
  db: DatabaseAdapter,
  incidentId: string,
  work: WorkIdentity,
) {
  await db.execute(
    "INSERT INTO provider_incident_jobs(incident_id,pipeline,job_id,tenant_id,person_id,canonical_job_id,opportunity_version,context_fingerprint) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
    [
      incidentId,
      work.pipeline,
      work.jobId,
      work.tenantId,
      work.personId,
      work.canonicalJobId,
      work.opportunityVersion,
      work.contextFingerprint,
    ],
  );
}
export async function assertProviderDispatch(
  db: DatabaseAdapter,
  connectionId: string,
  work?: WorkIdentity,
  now = Date.now(),
) {
  if (!(await operationsInstalled(db))) return;
  const row = await db.one<{
    blocked_until: number;
    requires_action: number;
    active_incident_id: string | null;
  }>(
    "SELECT blocked_until,requires_action,active_incident_id FROM provider_cooldowns WHERE connection_id=?",
    [connectionId],
  );
  if (row && (row.requires_action || row.blocked_until > now)) {
    if (work) {
      if (row.active_incident_id) await associateIncidentWork(db, row.active_incident_id, work);
    }
    throw new ModelProviderUnavailableError(
      "PROVIDER_COOLDOWN",
      429,
      Math.max(30_000, row.blocked_until - now),
    );
  }
}
/** Caller timeout must be shorter than TTL. A crash cannot permanently consume a slot. */
export async function acquireProviderCapacity(
  db: DatabaseAdapter,
  connectionId: string,
  owner: string,
  limit: number,
  now = Date.now(),
  ttlMs = 200_000,
  requestsPerMinute?: number,
) {
  if (!(await operationsInstalled(db))) return null;
  return db.transaction(async (tx) => {
    await tx.execute("DELETE FROM provider_capacity_leases WHERE expires_at<=?", [now]);
    await assertProviderDispatch(tx, connectionId, undefined, now);
    const live = await tx.one<{ n: number }>(
      "SELECT COUNT(*) n FROM provider_capacity_leases WHERE connection_id=? AND expires_at>?",
      [connectionId, now],
    );
    if ((live?.n ?? 0) >= limit)
      throw new ModelProviderUnavailableError("PROVIDER_CAPACITY_BUSY", 429, 2000);
    if (requestsPerMinute) {
      await tx.execute(
        "INSERT INTO provider_rate_windows VALUES(?,?,0) ON CONFLICT(connection_id) DO NOTHING",
        [connectionId, now],
      );
      await tx.execute(
        "UPDATE provider_rate_windows SET window_start=?,requests=0 WHERE connection_id=? AND window_start<=?",
        [now, connectionId, now - 60_000],
      );
      const used = await tx.execute(
        "UPDATE provider_rate_windows SET requests=requests+1 WHERE connection_id=? AND requests<?",
        [connectionId, requestsPerMinute],
      );
      if (!used.rowsAffected)
        throw new ModelProviderUnavailableError("PROVIDER_RATE_BUSY", 429, 60_000);
    }
    const token = randomUUID();
    await tx.execute("INSERT INTO provider_capacity_leases VALUES(?,?,?,?)", [
      token,
      connectionId,
      owner,
      now + ttlMs,
    ]);
    return token;
  });
}
export async function releaseProviderCapacity(
  db: DatabaseAdapter,
  token: string | null,
  owner: string,
) {
  if (token)
    await db.execute(
      "DELETE FROM provider_capacity_leases WHERE token=? AND owner=? AND expires_at>?",
      [token, owner, Date.now()],
    );
}
export async function renewProviderCapacity(
  db: DatabaseAdapter,
  token: string | null,
  owner: string,
  now = Date.now(),
) {
  if (!token) return true;
  const changed = await db.execute(
    "UPDATE provider_capacity_leases SET expires_at=? WHERE token=? AND owner=? AND expires_at>?",
    [now + 200000, token, owner, now],
  );
  return changed.rowsAffected > 0;
}
export async function providerSucceeded(
  db: DatabaseAdapter,
  connectionId: string,
  generation: number,
  startedAt = Date.now(),
) {
  if (!(await operationsInstalled(db))) return;
  return db.transaction(async (tx) => {
    const changed = await tx.execute(
      "UPDATE provider_cooldowns SET blocked_until=0,failures=0,last_success_at=? WHERE connection_id=? AND generation=? AND requires_action=0 AND NOT EXISTS (SELECT 1 FROM provider_incidents WHERE connection_id=? AND state!='resolved' AND last_seen>=?)",
      [Date.now(), connectionId, generation, connectionId, startedAt],
    );
    if (connectionId === "tavily:platform")
      await tx.execute(
        "UPDATE provider_credential_lifecycle SET last_success_at=? WHERE credential_id=(SELECT active_id FROM admin_search_connection WHERE id=1 AND generation=?)",
        [Date.now(), generation],
      );
    if (changed.rowsAffected && connectionId !== "tavily:platform")
      await tx.execute(
        "UPDATE provider_incidents SET state='recovering' WHERE connection_id=? AND state!='resolved'",
        [connectionId],
      );
  });
}

/** A bounded canary may bypass a hold, but a newer failure must retain it. */
export async function confirmProviderRecovery(
  db: DatabaseAdapter,
  connectionId: string,
  generation: number,
  startedAt: number,
) {
  return db.transaction(async (tx) => {
    const newer = await tx.one(
      "SELECT id FROM provider_incidents WHERE connection_id=? AND state!='resolved' AND last_seen>=?",
      [connectionId, startedAt],
    );
    if (newer) return false;
    if (connectionId === "tavily:platform") {
      const active = await tx.one<{ generation: number }>(
        "SELECT generation FROM admin_search_connection WHERE id=1",
      );
      if (active?.generation !== generation) return false;
    }
    await tx.execute(
      "UPDATE provider_cooldowns SET blocked_until=0,requires_action=0,failures=0,last_success_at=? WHERE connection_id=? AND generation=?",
      [Date.now(), connectionId, generation],
    );
    await tx.execute(
      "UPDATE provider_incidents SET state='recovering' WHERE connection_id=? AND state!='resolved'",
      [connectionId],
    );
    return true;
  });
}
