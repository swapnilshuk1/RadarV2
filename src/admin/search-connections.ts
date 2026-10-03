import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { DatabaseAdapter } from "../data/database/adapter";
import { getDatabaseTargetIdentity } from "../data/database";
import { CredentialVault } from "../lib/security/CredentialVault";
import { appendAdminAudit, requirePlatformRole } from "./service";
import {
  searchConnectionMutation,
  type SearchConnectionMutation,
} from "./search-connection-contracts";
import {
  operationsInstalled,
  writeRuntimeReceipt,
  operationalSettings,
  confirmProviderRecovery,
  observeProviderFailure,
} from "./operations-runtime";
import { classifySearchFailure } from "./operations-contracts";
import { probeTavilyCapability } from "../evaluation/tavily-request";
export const TAVILY_CONNECTION = "tavily:platform";
export const RECEIPT_FRESH_MS = 150_000;
type Connection = {
  active_id: string | null;
  candidate_id: string | null;
  previous_id: string | null;
  previous_source: "host" | "managed" | null;
  generation: number;
  revision: number;
  uptake_json: string;
  activated_at: number | null;
};
type Consumer = { instance_id: string; release_sha: string; database_fingerprint: string };
type Worker = { name: string; instance: string; startedAt: number; database: string };
let workerIdentity: Worker | undefined;
export function registerConnectionWorker(name: string, instance: string, database: string) {
  workerIdentity = { name, instance, database, startedAt: Date.now() };
}
export const searchConnectionInstalled = operationsInstalled;
async function connection(db: DatabaseAdapter) {
  const row = await db.one<Connection>("SELECT * FROM admin_search_connection WHERE id=1");
  if (!row) throw new Error("SEARCH_CONNECTION_NOT_INSTALLED");
  return row;
}
async function decrypt(db: DatabaseAdapter, id: string) {
  const row = await db.one<{ envelope_json: string }>(
    "SELECT envelope_json FROM admin_search_credentials WHERE id=?",
    [id],
  );
  if (!row) throw new Error("SEARCH_CREDENTIAL_NOT_FOUND");
  try {
    const value = JSON.parse(new CredentialVault().decrypt(JSON.parse(row.envelope_json)));
    if (value.provider !== "tavily" || typeof value.key !== "string") throw new Error();
    return value.key as string;
  } catch {
    throw new Error("SEARCH_CREDENTIAL_UNREADABLE");
  }
}
export async function requiredSearchConsumers(db: DatabaseAdapter) {
  return db.many<Consumer>(
    "SELECT instance_id,release_sha,database_fingerprint FROM worker_heartbeats WHERE worker_name='evaluation' AND last_seen_at>=? AND release_sha=? AND database_fingerprint=?",
    [
      new Date(Date.now() - RECEIPT_FRESH_MS).toISOString(),
      process.env.RADAR_RELEASE_SHA ?? "development",
      workerIdentity?.database ?? getDatabaseTargetIdentity().fingerprint,
    ],
  );
}
export async function searchUptake(db: DatabaseAdapter) {
  const row = await connection(db);
  const current = await requiredSearchConsumers(db);
  const required = current; // Historical activation cohort stays in uptake_json; fresh replacement instances must load before dispatch.
  const loaded = await db.many<Consumer>(
    "SELECT instance_id,release_sha,database_fingerprint FROM worker_runtime_receipts WHERE connection_id=? AND generation=? AND reload_status='loaded' AND last_seen_at>?",
    [TAVILY_CONNECTION, row.generation, Date.now() - RECEIPT_FRESH_MS],
  );
  const missing = required.filter(
    (c) =>
      !loaded.some(
        (r) =>
          r.instance_id === c.instance_id &&
          r.release_sha === c.release_sha &&
          r.database_fingerprint === c.database_fingerprint,
      ),
  );
  return {
    required: required.length,
    loaded: required.length - missing.length,
    missing: missing.map((c) => c.instance_id),
    ready: required.length > 0 && !missing.length,
  };
}
export async function readSearchConnection(db: DatabaseAdapter, actor: string) {
  const role = await requirePlatformRole(db, actor);
  if (!(await operationsInstalled(db))) return { role, installed: false as const };
  const row = await connection(db);
  return {
    role,
    installed: true as const,
    generation: row.generation,
    revision: row.revision,
    activeId: row.active_id,
    candidateId: row.candidate_id,
    previousId: row.previous_id,
    previousSource: row.previous_source,
    hostConfigured: Boolean(process.env.TAVILY_API_KEY),
    activatedAt: row.activated_at,
    uptake: await searchUptake(db),
    credentials: await db.many<Record<string, string | number | null>>(
      "SELECT c.id,c.created_at,l.activated_at,l.superseded_at,l.unreferenced_at,l.retired_at,l.last_validated_at,l.last_used_at AS last_selected_at,l.last_success_at,l.key_version FROM admin_search_credentials c JOIN provider_credential_lifecycle l ON l.credential_id=c.id ORDER BY c.created_at DESC LIMIT 20",
    ),
    checks: await db.many<Record<string, string | number | null>>(
      "SELECT id,credential_id,source,generation,purpose,status,worker_host,worker_instance,error_code,created_at,completed_at FROM admin_search_checks ORDER BY created_at DESC LIMIT 20",
    ),
    cooldown: await db.one<{
      generation: number;
      blocked_until: number;
      requires_action: number;
      failure_class: string;
      last_success_at: number | null;
    }>(
      "SELECT generation,blocked_until,requires_action,failure_class,last_success_at FROM provider_cooldowns WHERE connection_id=?",
      [TAVILY_CONNECTION],
    ),
  };
}
export async function mutateSearchConnection(
  db: DatabaseAdapter,
  actor: string,
  input: SearchConnectionMutation,
) {
  const data = searchConnectionMutation.parse(input);
  await requirePlatformRole(db, actor, true);
  const envelope =
    data.kind === "candidate"
      ? new CredentialVault().encrypt(JSON.stringify({ provider: "tavily", key: data.key }))
      : null;
  return db.transaction(async (tx) => {
    await requirePlatformRole(tx, actor, true);
    const row = await connection(tx);
    if (row.revision !== data.expectedRevision) throw new Error("ADMIN_STATE_CHANGED");
    const now = Date.now();
    let id = "credentialId" in data ? data.credentialId : null;
    if (data.kind === "candidate" && envelope) {
      id = randomUUID();
      await tx.execute("INSERT INTO admin_search_credentials VALUES(?,?,?,?,?)", [
        id,
        JSON.stringify(envelope),
        "version",
        now,
        actor,
      ]);
      await tx.execute(
        "INSERT INTO provider_credential_lifecycle(credential_id,key_version) VALUES(?,?)",
        [id, envelope.keyVersion],
      );
      await tx.execute(
        "UPDATE admin_search_connection SET candidate_id=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=1",
        [id, now, actor],
      );
    } else if (
      data.kind === "test" ||
      data.kind === "test_host" ||
      data.kind === "confirm_recovered"
    ) {
      if (data.kind === "test_host") id = null;
      if (data.kind === "confirm_recovered") id = row.active_id;
      if (data.kind === "test" && ![row.candidate_id, row.previous_id, row.active_id].includes(id))
        throw new Error("SEARCH_VERSION_NOT_CURRENT");
      if (
        await tx.one(
          "SELECT credential_id FROM provider_credential_lifecycle WHERE credential_id=? AND retired_at IS NOT NULL",
          [id],
        )
      )
        throw new Error("SEARCH_VERSION_RETIRED");
      await tx.execute(
        "INSERT INTO admin_search_checks(id,credential_id,status,created_at,created_by,source,generation,purpose,capability_version) VALUES(?,?,'queued',?,?,?,?,?,1)",
        [
          randomUUID(),
          id,
          now,
          actor,
          id ? "managed" : "host",
          row.generation,
          data.kind === "confirm_recovered" ? "confirm" : "validate",
        ],
      );
    } else if (data.kind === "activate" || data.kind === "rollback") {
      id = data.kind === "rollback" ? row.previous_id : data.credentialId;
      const hostRollback = data.kind === "rollback" && row.previous_source === "host";
      if ((!id && !hostRollback) || (data.kind === "activate" && id !== row.candidate_id))
        throw new Error("SEARCH_CANDIDATE_CHANGED");
      const consumers = await requiredSearchConsumers(tx);
      if (!consumers.length) throw new Error("SEARCH_REQUIRED_WORKER_OFFLINE");
      const proof = await tx.one<Consumer>(
        "SELECT worker_instance AS instance_id,release_sha,database_fingerprint FROM admin_search_checks WHERE credential_id IS ? AND source=? AND capability_version=1 AND status='passed' AND completed_at>? ORDER BY completed_at DESC LIMIT 1",
        [id, id ? "managed" : "host", now - 15 * 60000],
      );
      if (
        !proof ||
        !consumers.some(
          (c) =>
            c.instance_id === proof.instance_id &&
            c.release_sha === proof.release_sha &&
            c.database_fingerprint === proof.database_fingerprint,
        )
      )
        throw new Error("CURRENT_WORKER_CONNECTION_TEST_REQUIRED");
      await tx.execute(
        "UPDATE provider_credential_lifecycle SET superseded_at=? WHERE credential_id=?",
        [now, row.active_id],
      );
      await tx.execute(
        "UPDATE provider_credential_lifecycle SET activated_at=?,superseded_at=NULL WHERE credential_id=? AND retired_at IS NULL",
        [now, id],
      );
      await tx.execute(
        "UPDATE admin_search_connection SET active_id=?,previous_id=?,previous_source=?,candidate_id=NULL,generation=generation+1,revision=revision+1,activated_at=?,uptake_json=?,updated_at=?,updated_by=? WHERE id=1",
        [
          id,
          row.active_id,
          row.active_id ? "managed" : "host",
          now,
          JSON.stringify(consumers),
          now,
          actor,
        ],
      );
      await tx.execute(
        "INSERT INTO provider_cooldowns(connection_id,generation,blocked_until,requires_action,failures,failure_class) VALUES(?,?,0,1,0,'activation_canary') ON CONFLICT(connection_id) DO UPDATE SET generation=excluded.generation,blocked_until=0,requires_action=1,failures=0,last_success_at=NULL,failure_class='activation_canary',active_incident_id=NULL",
        [TAVILY_CONNECTION, row.generation + 1],
      );
      await tx.execute(
        "INSERT INTO admin_search_checks(id,credential_id,status,created_at,created_by,source,generation,purpose,capability_version) VALUES(?,?,'queued',?,?,?,?, 'confirm',1)",
        [randomUUID(), id, now, actor, id ? "managed" : "host", row.generation + 1],
      );
    } else if (data.kind === "retire") {
      if ([row.active_id, row.previous_id, row.candidate_id].includes(id))
        throw new Error("SEARCH_VERSION_STILL_REFERENCED");
      await tx.execute(
        "UPDATE provider_credential_lifecycle SET retired_at=? WHERE credential_id=?",
        [now, id],
      );
    }
    await appendAdminAudit(tx, {
      actor,
      action: `connection.tavily.${data.kind}`,
      target: TAVILY_CONNECTION,
      reason: data.reason,
      detail: { generation: row.generation, credentialId: id },
    });
    return { credentialId: id };
  });
}
export async function resolveSearchCredential(db: DatabaseAdapter) {
  if (!(await operationsInstalled(db)))
    return { key: process.env.TAVILY_API_KEY, generation: 0, credentialId: null };
  const row = await connection(db);
  const key = row.active_id ? await decrypt(db, row.active_id) : process.env.TAVILY_API_KEY;
  if (row.active_id)
    await db.execute(
      "UPDATE provider_credential_lifecycle SET last_used_at=? WHERE credential_id=? AND retired_at IS NULL",
      [Date.now(), row.active_id],
    );
  return { key, generation: row.generation, credentialId: row.active_id };
}
export async function refreshSearchWorkerReceipt(db: DatabaseAdapter) {
  if (!workerIdentity || workerIdentity.name !== "evaluation" || !(await operationsInstalled(db)))
    return;
  const row = await connection(db);
  let loaded = true;
  try {
    await resolveSearchCredential(db);
  } catch {
    loaded = false;
  }
  const config = await operationalSettings(db);
  await writeRuntimeReceipt(db, {
    workerName: workerIdentity.name,
    instanceId: workerIdentity.instance,
    runtimeRole: process.env.RADAR_RUNTIME_ROLE ?? "single-host",
    releaseSha: process.env.RADAR_RELEASE_SHA ?? "development",
    databaseFingerprint: workerIdentity.database,
    configRevision: `operational:${config.revision}`,
    connectionId: TAVILY_CONNECTION,
    generation: row.generation,
    credentialVersion: row.active_id,
    credentialSource: row.active_id ? "vault" : "host",
    reloadMode: "hot",
    reloadStatus: loaded ? "loaded" : "failed",
    errorCode: loaded ? null : "VAULT_UNREADABLE",
    startedAt: workerIdentity.startedAt,
    loadedAt: Date.now(),
    lastSeenAt: Date.now(),
  });
}
export async function pollSearchConnectionCheck(
  db: DatabaseAdapter,
  request: typeof fetch = fetch,
  runtime = workerIdentity,
) {
  if (!runtime || runtime.name !== "evaluation" || !(await operationsInstalled(db))) return null;
  const now = Date.now(),
    token = randomUUID();
  const claimed = await db.transaction(async (tx) => {
    await tx.execute(
      "UPDATE admin_search_checks SET status='failed',error_code='WORKER_LEASE_EXPIRED',completed_at=? WHERE status='running' AND lease_until<=?",
      [now, now],
    );
    const row = await tx.one<{
      id: string;
      credential_id: string | null;
      created_by: string;
      source: string;
      generation: number | null;
      purpose: string;
    }>(
      "SELECT id,credential_id,created_by,source,generation,purpose FROM admin_search_checks WHERE status='queued' ORDER BY created_at LIMIT 1",
    );
    if (!row) return null;
    const result = await tx.execute(
      "UPDATE admin_search_checks SET status='running',lease_until=?,lease_token=?,worker_host=?,worker_instance=?,release_sha=?,database_fingerprint=? WHERE id=? AND status='queued'",
      [
        now + 60000,
        token,
        hostname(),
        runtime.instance,
        process.env.RADAR_RELEASE_SHA ?? "development",
        runtime.database,
        row.id,
      ],
    );
    return result.rowsAffected ? row : null;
  });
  if (!claimed) return null;
  const startedAt = Date.now();
  let error: string | null = null;
  let providerFailure: unknown;
  try {
    await requirePlatformRole(db, claimed.created_by, true);
    await probeTavilyCapability(
      claimed.credential_id ? await decrypt(db, claimed.credential_id) : process.env.TAVILY_API_KEY,
      request,
    );
  } catch (failure) {
    providerFailure = failure;
    error =
      failure instanceof Error && /^[A-Z_0-9]+$/.test(failure.message)
        ? failure.message
        : "SEARCH_CHECK_UNAVAILABLE";
  }
  const result = await db.transaction(async (tx) => {
    const updated = await tx.execute(
      "UPDATE admin_search_checks SET status=?,error_code=?,completed_at=?,lease_until=NULL WHERE id=? AND status='running' AND lease_token=? AND lease_until>?",
      [error ? "failed" : "passed", error, Date.now(), claimed.id, token, Date.now()],
    );
    if (
      updated.rowsAffected &&
      error &&
      claimed.purpose === "confirm" &&
      claimed.generation !== null
    ) {
      const current = await connection(tx);
      if (
        current.generation === claimed.generation &&
        current.active_id === claimed.credential_id
      ) {
        const status = Number(error.match(/^CONTEXT_SEARCH_HTTP_(\d+)$/)?.[1]) || undefined;
        const code =
          error === "SEARCH_CREDENTIAL_UNREADABLE"
            ? "VAULT_UNREADABLE"
            : error === "TAVILY_HOST_KEY_UNCONFIGURED"
              ? undefined
              : error === "SEARCH_CAPABILITY_RESPONSE_INVALID" ||
                  providerFailure instanceof SyntaxError
                ? "INVALID_RESPONSE"
                : providerFailure instanceof Error &&
                    ["TimeoutError", "AbortError"].includes(providerFailure.name)
                  ? "TIMEOUT"
                  : undefined;
        await observeProviderFailure(tx, {
          connectionId: TAVILY_CONNECTION,
          provider: "tavily",
          generation: claimed.generation,
          failure:
            error === "TAVILY_HOST_KEY_UNCONFIGURED"
              ? "credential"
              : classifySearchFailure(status, code),
          status,
          deployment: runtime.database,
        });
      }
    }
    return updated;
  });
  if (result.rowsAffected && !error) {
    await db.execute(
      "UPDATE provider_credential_lifecycle SET last_validated_at=? WHERE credential_id=?",
      [Date.now(), claimed.credential_id],
    );
    if (claimed.purpose === "confirm") {
      const current = await connection(db);
      const consumers = await requiredSearchConsumers(db);
      if (
        current.generation === claimed.generation &&
        current.active_id === claimed.credential_id &&
        consumers.some(
          (c) =>
            c.instance_id === runtime.instance &&
            c.release_sha === (process.env.RADAR_RELEASE_SHA ?? "development") &&
            c.database_fingerprint === runtime.database,
        )
      ) {
        const recovered = await confirmProviderRecovery(
          db,
          TAVILY_CONNECTION,
          current.generation,
          startedAt,
        );
        if (recovered)
          await appendAdminAudit(db, {
            actor: claimed.created_by,
            action: "connection.tavily.recovered",
            target: TAVILY_CONNECTION,
            reason: "Current-worker production capability canary passed",
            detail: { generation: current.generation, checkId: claimed.id },
          });
      }
    }
  }
  return {
    id: claimed.id,
    status: result.rowsAffected ? (error ? "failed" : "passed") : "lease_lost",
  };
}

/** Model receipt records the exact job-pinned revision actually constructed. */
export async function recordModelRuntimeReceipt(
  db: DatabaseAdapter,
  connectionId: string,
  revision: string,
  effectiveSettings?: Record<string, unknown>,
) {
  if (!workerIdentity) return;
  await writeRuntimeReceipt(db, {
    workerName: workerIdentity.name,
    instanceId: workerIdentity.instance,
    runtimeRole: process.env.RADAR_RUNTIME_ROLE ?? "single-host",
    releaseSha: process.env.RADAR_RELEASE_SHA ?? "development",
    databaseFingerprint: workerIdentity.database,
    configRevision: revision,
    connectionId,
    generation: 0,
    credentialVersion: process.env.RADAR_MODEL_CREDENTIAL_VERSION ?? null,
    credentialSource: connectionId === "google:host" ? "ADC" : "host",
    reloadMode: "restart",
    reloadStatus: "loaded",
    errorCode: null,
    startedAt: workerIdentity.startedAt,
    loadedAt: Date.now(),
    lastSeenAt: Date.now(),
    effectiveSettings,
  });
}
