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
  const destination = await db.one<{
    url: string;
    secret_envelope: string;
    minimum_severity: string;
    send_recovery: number;
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
    `INSERT INTO notification_deliveries(id,incident_id,event,destination_url,secret_envelope,payload_json,next_attempt_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(incident_id,event,destination_url) DO NOTHING`,
    [
      id,
      incidentId,
      event,
      destination.url,
      destination.secret_envelope,
      JSON.stringify({
        eventId: id,
        incidentId,
        event,
        provider: incident.provider,
        severity: incident.severity,
        failureClass: incident.failure_class,
        affectedJobs: affected?.n ?? 0,
      }),
      Date.now(),
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
        "UPDATE provider_incidents SET last_seen=?,occurrences=occurrences+1,error_code=?,severity=? WHERE id=?",
        [now, errorCode, severity, id],
      );
    else {
      const previous = await tx.one<{ id: string }>(
        "SELECT id FROM provider_incidents WHERE correlation_key=? ORDER BY first_seen DESC LIMIT 1",
        [correlation],
      );
      await tx.execute(
        `INSERT INTO provider_incidents(id,correlation_key,provider,connection_id,generation,failure_class,severity,state,recurrence_of,first_seen,last_seen,error_code)
        VALUES(?,?,?,?,?,?,?,'open',?,?,?,?)`,
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
        ],
      );
    }
    await tx.execute("INSERT INTO provider_incident_observations VALUES(?,?,?,?)", [
      randomUUID(),
      id,
      now,
      errorCode,
    ]);
    await tx.execute(
      "DELETE FROM provider_incident_observations WHERE incident_id=? AND id NOT IN (SELECT id FROM provider_incident_observations WHERE incident_id=? ORDER BY observed_at DESC LIMIT 100)",
      [id, id],
    );
    if (input.work) await associateIncidentWork(tx, id, input.work);
    const prior = await tx.one<{ failures: number }>(
      "SELECT failures FROM provider_cooldowns WHERE connection_id=?",
      [input.connectionId],
    );
    const delay = Math.max(
      Math.min(900_000, Math.max(0, input.retryAfterMs ?? 0)),
      Math.min(120_000, 30_000 * 2 ** Math.min(prior?.failures ?? 0, 2)),
    );
    const action = ["credential", "quota_exhausted", "vault"].includes(input.failure) ? 1 : 0;
    await tx.execute(
      `INSERT INTO provider_cooldowns(connection_id,generation,blocked_until,requires_action,failures,failure_class) VALUES(?,?,?,?,1,?)
      ON CONFLICT(connection_id) DO UPDATE SET generation=excluded.generation,blocked_until=MAX(blocked_until,excluded.blocked_until),
      requires_action=MAX(requires_action,excluded.requires_action),failures=failures+1,failure_class=excluded.failure_class`,
      [input.connectionId, input.generation, now + delay, action, input.failure],
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
  const row = await db.one<{ blocked_until: number; requires_action: number }>(
    "SELECT blocked_until,requires_action FROM provider_cooldowns WHERE connection_id=?",
    [connectionId],
  );
  if (row && (row.requires_action || row.blocked_until > now)) {
    if (work) {
      const incident = await db.one<{ id: string }>(
        "SELECT id FROM provider_incidents WHERE connection_id=? AND state!='resolved' ORDER BY first_seen DESC LIMIT 1",
        [connectionId],
      );
      if (incident) await associateIncidentWork(db, incident.id, work);
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
) {
  if (!(await operationsInstalled(db))) return;
  await db.execute(
    "UPDATE provider_cooldowns SET blocked_until=0,failures=0,last_success_at=? WHERE connection_id=? AND generation=? AND requires_action=0",
    [Date.now(), connectionId, generation],
  );
}
