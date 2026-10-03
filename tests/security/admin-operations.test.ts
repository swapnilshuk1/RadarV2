import { migratedFixtureDatabase } from "../persistence/migrated-fixture";
import { pollHostProviderCheck } from "../../src/admin/host-provider-checks";
import { readOperations, mutateOperations } from "../../src/admin/operations-service";
import { getDatabaseTargetIdentity } from "../../src/data/database";
import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { TursoAdapter } from "../../src/data/database/turso";
import { maintainCredentialRetention } from "../../src/admin/credential-maintenance";
import {
  setupLineageTestFixture,
  activateLineageTestContext,
} from "../persistence/lineage_fixture";
import {
  acquireProviderCapacity,
  renewProviderCapacity,
  releaseProviderCapacity,
  observeProviderFailure,
  assertProviderDispatch,
  writeRuntimeReceipt,
  providerSucceeded,
} from "../../src/admin/operations-runtime";
import {
  mutateSearchConnection,
  pollSearchConnectionCheck,
  registerConnectionWorker,
  refreshSearchWorkerReceipt,
  searchUptake,
  resolveSearchCredential,
  readSearchConnection,
  TAVILY_CONNECTION,
} from "../../src/admin/search-connections";
import { classifySearchFailure } from "../../src/admin/operations-contracts";
import {
  previewRecovery,
  executeRecovery,
  reconcileProviderIncidents,
} from "../../src/admin/operations-recovery";
import {
  pollNotificationDelivery,
  notificationSignature,
  validateWebhookDestination,
  notificationHeaders,
  sendSignedWebhook,
} from "../../src/admin/notification-worker";
import { CredentialVault } from "../../src/lib/security/CredentialVault";
import { deferralFilter } from "../../src/admin/protection";
import {
  seedOperationalEvaluation,
  completeOperationalMemo,
} from "../../scripts/acceptance/operations-fixture";
import { ProductionContextProvider } from "../../src/evaluation/context-provider";
import { evaluationContextFingerprint } from "../fixtures/staged-rich-dossier";
import { SqliteDossierReviewQueue } from "../../src/data/sqlite/repositories/SqliteDossierReviewQueue";
import { dossier, evaluationFingerprint } from "../fixtures/staged-rich-dossier";
import { SqliteRichDossierStore } from "../../src/data/sqlite/repositories/SqliteRichDossierStore";
import { mkdtempSync, mkdirSync, readdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runMigrations } from "../../src/data/sqlite/migrations/runner";
import { CRITICAL_EVALUATION_MAINTENANCE_TASKS } from "../../src/lib/health/maintenance-receipts";
const adapters: SqliteAdapter[] = [];
const tavilyCapabilityResponse = () =>
  new Response(
    JSON.stringify({
      results: [{ url: "https://oracle.com", raw_content: "fixture official company content" }],
    }),
  );
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const db of adapters.splice(0)) await db.close();
});
async function fixture(provided?: SqliteAdapter | TursoAdapter) {
  const db = provided ?? await migratedFixtureDatabase();
  if (!provided) adapters.push(db as SqliteAdapter);
  await setupLineageTestFixture(db);
  await db.execute(
    "INSERT INTO users(id,email) VALUES('op','op@fixture'),('viewer','viewer@fixture')",
  );
  await db.execute(
    "INSERT INTO platform_roles VALUES('op','operator',0,'fixture','fixture',NULL),('viewer','viewer',0,'fixture','fixture',NULL)",
  );
  await db.execute(
    "INSERT INTO worker_heartbeats VALUES('evaluation','processing-1','development','fixture-db',?)",
    [new Date().toISOString()],
  );
  registerConnectionWorker("evaluation", "processing-1", "fixture-db");
  return db;
}
async function recoveryMemo(db: SqliteAdapter | TursoAdapter, id = "recovery-memo") {
  await db.execute(
    "INSERT INTO dossier_composition_jobs(id,tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,evaluation_fingerprint,profile_version,recipe,status,next_attempt_at,created_at,updated_at) VALUES(?,'tenant_A','person_A','job','version','fingerprint_A','eval','profile',?,'retry',?,0,0)",
    [id, id, Date.now() + 86400000],
  );
  return {
    pipeline: "dossier" as const,
    jobId: id,
    tenantId: "tenant_A",
    personId: "person_A",
    canonicalJobId: "job",
    opportunityVersion: "version",
    contextFingerprint: "fingerprint_A",
  };
}
async function healthyRecovery(
  db: SqliteAdapter | TursoAdapter,
  work?: Awaited<ReturnType<typeof recoveryMemo>>,
) {
  const incident = (await observeProviderFailure(db, {
    connectionId: TAVILY_CONNECTION,
    provider: "tavily",
    generation: 0,
    failure: "credential",
    deployment: "test",
    work,
  }))!;
  const candidate = await mutateSearchConnection(db, "op", {
    kind: "candidate",
    key: "tvly-" + "h".repeat(30),
    expectedRevision: 0,
    reason: "replace credential",
  });
  await mutateSearchConnection(db, "op", {
    kind: "test",
    credentialId: candidate.credentialId!,
    expectedRevision: 1,
    reason: "validate on worker",
  });
  await pollSearchConnectionCheck(db, tavilyCapabilityResponse);
  await mutateSearchConnection(db, "op", {
    kind: "activate",
    credentialId: candidate.credentialId!,
    expectedRevision: 1,
    reason: "activate validated key",
  });
  await refreshSearchWorkerReceipt(db);
  await pollSearchConnectionCheck(db, tavilyCapabilityResponse);
  return incident;
}
describe("Operations & Recovery", () => {
  it.each([401, 429, 503])(
    "opens exactly one incident and queues an alert when an activated Tavily canary returns %s",
    async (status) => {
      const db = await fixture();
      await db.execute(
        "INSERT INTO operational_webhooks(id,url,secret_envelope,minimum_severity,send_recovery,updated_at,updated_by) VALUES(1,'https://alerts.example.com','{}','Warning',1,0,'op')",
      );
      const candidate = await mutateSearchConnection(db, "op", {
        kind: "candidate",
        key: "tvly-" + "c".repeat(30),
        expectedRevision: 0,
        reason: "validated replacement",
      });
      await mutateSearchConnection(db, "op", {
        kind: "test",
        credentialId: candidate.credentialId!,
        expectedRevision: 1,
        reason: "prevalidate candidate",
      });
      await pollSearchConnectionCheck(db, tavilyCapabilityResponse);
      await mutateSearchConnection(db, "op", {
        kind: "activate",
        credentialId: candidate.credentialId!,
        expectedRevision: 1,
        reason: "activate candidate",
      });
      expect(
        await pollSearchConnectionCheck(db, async () => new Response("", { status })),
      ).toMatchObject({ status: "failed" });
      expect(await pollSearchConnectionCheck(db, tavilyCapabilityResponse)).toBeNull();
      const incidents = await db.many<{ id: string; generation: number; failure_class: string }>(
        "SELECT id,generation,failure_class FROM provider_incidents",
      );
      expect(incidents).toHaveLength(1);
      expect(incidents[0]).toMatchObject({
        generation: 1,
        failure_class: classifySearchFailure(status),
      });
      expect(
        await db.one(
          "SELECT requires_action,active_incident_id FROM provider_cooldowns WHERE connection_id=?",
          [TAVILY_CONNECTION],
        ),
      ).toEqual({ requires_action: 1, active_incident_id: incidents[0].id });
      expect(await db.many("SELECT incident_id,event,status FROM notification_deliveries")).toEqual(
        [{ incident_id: incidents[0].id, event: "opened", status: "queued" }],
      );
      await expect(assertProviderDispatch(db, TAVILY_CONNECTION)).rejects.toThrow(
        "PROVIDER_COOLDOWN",
      );
    },
  );

  it.each(["timeout", "throttled", "provider_outage", "transport"] as const)(
    "reconciles a transient Tavily %s after production succeeds and starts a new recurrence",
    async (failure) => {
      const db = await fixture();
      vi.stubEnv("TAVILY_API_KEY", "host-fixture-key");
      await db.execute("UPDATE worker_heartbeats SET database_fingerprint=?", [
        getDatabaseTargetIdentity().fingerprint,
      ]);
      registerConnectionWorker(
        "evaluation",
        "processing-1",
        getDatabaseTargetIdentity().fingerprint,
      );
      await refreshSearchWorkerReceipt(db);
      const observation = {
        connectionId: TAVILY_CONNECTION,
        provider: "tavily",
        generation: 0,
        failure,
        deployment: "fixture-db",
      };
      const incident = await observeProviderFailure(db, observation, Date.now() - 1000);
      await providerSucceeded(db, TAVILY_CONNECTION, 0, Date.now() - 100);
      expect(await db.one("SELECT state FROM provider_incidents WHERE id=?", [incident])).toEqual({
        state: "recovering",
      });
      await reconcileProviderIncidents(db);
      expect(await db.one("SELECT state FROM provider_incidents WHERE id=?", [incident])).toEqual({
        state: "resolved",
      });
      const recurrence = await observeProviderFailure(db, observation);
      expect(recurrence).not.toBe(incident);
      expect(
        await db.one("SELECT recurrence_of FROM provider_incidents WHERE id=?", [recurrence]),
      ).toEqual({ recurrence_of: incident });
    },
  );

  it("does not let stale generation success, in-flight success or action-required Tavily failures recover naturally", async () => {
    const db = await fixture();
    const observedAt = Date.now() - 100;
    const incident = await observeProviderFailure(
      db,
      {
        connectionId: TAVILY_CONNECTION,
        provider: "tavily",
        generation: 0,
        failure: "timeout",
        deployment: "fixture-db",
      },
      observedAt,
    );
    await providerSucceeded(db, TAVILY_CONNECTION, 1, observedAt + 1);
    await providerSucceeded(db, TAVILY_CONNECTION, 0, observedAt - 1);
    expect(await db.one("SELECT state FROM provider_incidents WHERE id=?", [incident])).toEqual({
      state: "open",
    });
    await observeProviderFailure(
      db,
      {
        connectionId: TAVILY_CONNECTION,
        provider: "tavily",
        generation: 0,
        failure: "credential",
        deployment: "fixture-db",
      },
      observedAt,
    );
    await providerSucceeded(db, TAVILY_CONNECTION, 0, observedAt + 1);
    expect(await db.many("SELECT DISTINCT state FROM provider_incidents")).toEqual([
      { state: "open" },
    ]);
  });

  it("counts queued Google probes and exposes failed reviewer maintenance with healthy evaluation", async () => {
    const db = await fixture();
    const fingerprint = getDatabaseTargetIdentity().fingerprint;
    await db.execute("UPDATE worker_heartbeats SET database_fingerprint=?", [fingerprint]);
    await db.execute(
      "INSERT INTO worker_heartbeats VALUES('dossier-review','review-1','development',?,?)",
      [fingerprint, new Date().toISOString()],
    );
    for (const task of CRITICAL_EVALUATION_MAINTENANCE_TASKS)
      await db.execute(
        "INSERT INTO operations_maintenance_tasks VALUES('processing-1',?,'development',?,?,?,0,NULL)",
        [task, fingerprint, Date.now(), Date.now()],
      );
    await db.execute(
      "INSERT INTO operations_maintenance_tasks VALUES('review-1','host_provider_checks','development',?,?,?,1,'GOOGLE_MAINTENANCE_FAILED')",
      [fingerprint, Date.now(), Date.now()],
    );
    await db.execute(
      "INSERT INTO provider_host_checks(id,provider,status,created_at,created_by) VALUES('google-check','google','queued',0,'op')",
    );
    const snapshot = await readOperations(db, "op");
    if (!snapshot.installed) throw new Error("operations required");
    expect(snapshot.maintenance).toMatchObject({
      online: true,
      healthy: false,
      pending: { host_probes: 1 },
    });
    expect(snapshot.attention.some((item) => item.target === "maintenance")).toBe(true);
  });
  it("rechecks operator exclusion after preview and preserves the queue deadline", async () => {
    const db = await fixture();
    const work = await recoveryMemo(db);
    const incident = await healthyRecovery(db, work);
    const preview = await previewRecovery(db, "op", incident, [work.jobId], "preview exact work");
    const before = await db.one(
      "SELECT status,next_attempt_at FROM dossier_composition_jobs WHERE id=?",
      [work.jobId],
    );
    await mutateOperations(db, "op", {
      kind: "exclude",
      incidentId: incident,
      pipeline: work.pipeline,
      jobId: work.jobId,
      reason: "Work excluded after preview by operator",
    });
    const afterExclusion = await previewRecovery(
      db,
      "op",
      incident,
      [work.jobId],
      "confirm current eligibility",
    );
    expect(
      await db.one("SELECT reason FROM recovery_action_jobs WHERE action_id=?", [
        afterExclusion.id,
      ]),
    ).toEqual({ reason: "skipped:OPERATOR_EXCLUDED" });
    expect(
      (await executeRecovery(db, "op", preview.id, "execute stale eligibility preview")).outcomes,
    ).toEqual([{ jobId: work.jobId, outcome: "skipped", reason: "OPERATOR_EXCLUDED" }]);
    expect(
      await db.one("SELECT status,next_attempt_at FROM dossier_composition_jobs WHERE id=?", [
        work.jobId,
      ]),
    ).toEqual(before);
    await reconcileProviderIncidents(db);
    expect(await db.one("SELECT state FROM provider_incidents WHERE id=?", [incident])).toEqual({
      state: "resolved",
    });
  });
  it("accounts domain-terminal work without claiming a successful memo or changing its queue", async () => {
    const db = await fixture();
    const work = await recoveryMemo(db);
    const incident = await healthyRecovery(db, work);
    const preview = await previewRecovery(db, "op", incident, [work.jobId], "exact resume");
    await executeRecovery(db, "op", preview.id, "resume exact work");
    await db.execute("UPDATE dossier_composition_jobs SET status='needs_attention' WHERE id=?", [
      work.jobId,
    ]);
    const before = await db.one("SELECT * FROM dossier_composition_jobs WHERE id=?", [work.jobId]);
    await reconcileProviderIncidents(db);
    expect(await db.one("SELECT state FROM provider_incidents WHERE id=?", [incident])).toEqual({
      state: "resolved",
    });
    expect(
      await db.one("SELECT accounted_reason FROM provider_incident_jobs WHERE incident_id=?", [
        incident,
      ]),
    ).toEqual({ accounted_reason: "DOMAIN_TERMINAL_NEEDS_ATTENTION" });
    expect(
      await db.one("SELECT outcome,reason FROM recovery_action_jobs WHERE action_id=?", [
        preview.id,
      ]),
    ).toEqual({ outcome: "skipped", reason: "DOMAIN_TERMINAL_NEEDS_ATTENTION" });
    expect(await db.one("SELECT * FROM dossier_composition_jobs WHERE id=?", [work.jobId])).toEqual(
      before,
    );
    const snapshot = await readOperations(db, "op");
    if (!snapshot.installed) throw new Error("operations required");
    expect(snapshot.maintenance.pending.reconciliation).toBe(0);
    expect(snapshot.attention.some((a) => a.target === "queue-dossier")).toBe(true);
  });
  it.each(["identity", "context"] as const)(
    "accounts superseded %s without modifying replacement work",
    async (kind) => {
      const db = await fixture();
      const work = await recoveryMemo(db);
      const incident = await healthyRecovery(db, work);
      if (kind === "identity")
        await db.execute(
          "UPDATE dossier_composition_jobs SET evaluation_context_fingerprint='replacement' WHERE id=?",
          [work.jobId],
        );
      else {
        await activateLineageTestContext(db);
        await db.execute(
          "INSERT INTO evaluation_contexts(context_fingerprint,tenant_id,person_id,search_plan_snapshot_id,ontology_version,ontology_fingerprint,policy_version,profile_version) VALUES('replacement','tenant_A','person_A','sps_A','v1','hash_ontology','v1','replacement-profile')",
        );
        await db.execute(
          "INSERT INTO evaluation_context_scopes VALUES('replacement','tenant_A','person_A','plan_A',CURRENT_TIMESTAMP)",
        );
        await db.execute(
          "UPDATE active_evaluation_contexts SET context_fingerprint='replacement' WHERE tenant_id='tenant_A' AND person_id='person_A'",
        );
      }
      const before = await db.one("SELECT * FROM dossier_composition_jobs WHERE id=?", [
        work.jobId,
      ]);
      await reconcileProviderIncidents(db);
      expect(await db.one("SELECT state FROM provider_incidents WHERE id=?", [incident])).toEqual({
        state: "resolved",
      });
      expect(
        await db.one("SELECT accounted_reason FROM provider_incident_jobs WHERE incident_id=?", [
          incident,
        ]),
      ).toEqual({
        accounted_reason: kind === "identity" ? "IDENTITY_SUPERSEDED" : "CONTEXT_SUPERSEDED",
      });
      expect(
        await db.one("SELECT * FROM dossier_composition_jobs WHERE id=?", [work.jobId]),
      ).toEqual(before);
    },
  );
  it("requires an audited operator exclusion for missing work and preserves it through reconciliation", async () => {
    const db = await fixture();
    const work = await recoveryMemo(db);
    const incident = await healthyRecovery(db, work);
    await db.execute("DELETE FROM dossier_composition_jobs WHERE id=?", [work.jobId]);
    await reconcileProviderIncidents(db);
    expect(await db.one("SELECT state FROM provider_incidents WHERE id=?", [incident])).toEqual({
      state: "recovering",
    });
    const exclusion = {
      kind: "exclude" as const,
      incidentId: incident,
      pipeline: work.pipeline,
      jobId: work.jobId,
      reason: "Obsolete missing work independently investigated",
    };
    await expect(mutateOperations(db, "viewer", exclusion)).rejects.toThrow(
      "PLATFORM_ACCESS_DENIED",
    );
    await expect(mutateOperations(db, "op", { ...exclusion, jobId: "unrelated" })).rejects.toThrow(
      "RECOVERY_JOB_NOT_IN_INCIDENT",
    );
    await mutateOperations(db, "op", exclusion);
    expect(
      await db.one<{ reason: string; detail_json: string }>(
        "SELECT reason,detail_json FROM admin_audit_log WHERE action='recovery.exclude'",
      ),
    ).toMatchObject({ reason: exclusion.reason, detail_json: expect.stringContaining(work.jobId) });
    await reconcileProviderIncidents(db);
    expect(
      await db.one("SELECT accounted_reason FROM provider_incident_jobs WHERE incident_id=?", [
        incident,
      ]),
    ).toEqual({ accounted_reason: "OPERATOR_EXCLUDED" });
    expect(await db.one("SELECT state FROM provider_incidents WHERE id=?", [incident])).toEqual({
      state: "resolved",
    });
  });
  it("resolves healthy episodes without linked jobs and requires fresh health for terminal accounting", async () => {
    const db = await fixture();
    const incident = await healthyRecovery(db);
    await db.execute("UPDATE admin_search_checks SET completed_at=0 WHERE status='passed'");
    await reconcileProviderIncidents(db);
    expect(await db.one("SELECT state FROM provider_incidents WHERE id=?", [incident])).toEqual({
      state: "recovering",
    });
    await db.execute("UPDATE admin_search_checks SET completed_at=? WHERE status='passed'", [
      Date.now(),
    ]);
    await reconcileProviderIncidents(db);
    expect(await db.one("SELECT state FROM provider_incidents WHERE id=?", [incident])).toEqual({
      state: "resolved",
    });
  });
  it.each(["sqlite", "libsql", "libsql-stream"] as const)(
    "rolls nested recovery and outcomes back to previewed after a late failure on %s",
    async (kind) => {
      const temporary = mkdtempSync(join(tmpdir(), "radar-recovery-rollback-"));
      if (kind !== "sqlite") {
        try {
          const run = promisify(execFile);
          const child = await run(
            process.execPath,
            [
              "--import",
              "tsx",
              "scripts/acceptance/operations-rollback.ts",
              pathToFileURL(join(temporary, "rollback.sqlite")).href,
              kind === "libsql-stream" ? "stream" : "local",
            ],
            {
              cwd: process.cwd(),
              env: { ...process.env, RADAR_RELEASE_SHA: "development" },
              timeout: 20000,
            },
          );
          expect(JSON.parse(child.stdout.trim().split(/\r?\n/).at(-1)!)).toMatchObject({
            rollback: "passed",
            retry: "passed",
          });
        } finally {
          if (resolve(temporary).startsWith(resolve(tmpdir()) + "\\"))
            rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        }
        return;
      }
      const adapter = await migratedFixtureDatabase();
      try {
        const db = await fixture(adapter);
        const work = await recoveryMemo(db);
        const incident = await healthyRecovery(db, work);
        const preview = await previewRecovery(
          db,
          "op",
          incident,
          [work.jobId],
          "preview rollback proof",
        );
        const before = await db.one(
          "SELECT next_attempt_at FROM dossier_composition_jobs WHERE id=?",
          [work.jobId],
        );
        await db.execute(
          "CREATE TRIGGER reject_recovery_audit BEFORE INSERT ON admin_audit_log WHEN NEW.action='recovery.execute' BEGIN SELECT RAISE(ABORT,'INJECTED_LATE_FAILURE'); END",
        );
        await expect(
          executeRecovery(db, "op", preview.id, "force atomic rollback"),
        ).rejects.toThrow("INJECTED_LATE_FAILURE");
        expect(await db.one("SELECT state FROM recovery_actions WHERE id=?", [preview.id])).toEqual(
          { state: "previewed" },
        );
        expect(
          await db.one("SELECT next_attempt_at FROM dossier_composition_jobs WHERE id=?", [
            work.jobId,
          ]),
        ).toEqual(before);
        expect(
          await db.one("SELECT outcome FROM recovery_action_jobs WHERE action_id=?", [preview.id]),
        ).toEqual({ outcome: "selected" });
        await db.execute("DROP TRIGGER reject_recovery_audit");
        expect(
          (await executeRecovery(db, "op", preview.id, "retry valid preview")).outcomes[0]!.outcome,
        ).toBe("resumed");
      } finally {
        await adapter.close();
        if (resolve(temporary).startsWith(resolve(tmpdir()) + "\\"))
          rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    },
  );
  it("starts automatic retention grace when the last reference is released", async () => {
    const db = await fixture();
    const old = Date.now() - 90 * 86400000;
    for (const id of ["old-key", "other-key"]) {
      await db.execute("INSERT INTO admin_search_credentials VALUES(?,'{}','suffix',?,'op')", [
        id,
        old,
      ]);
      await db.execute(
        "INSERT INTO provider_credential_lifecycle(credential_id,key_version) VALUES(?,'fixture')",
        [id],
      );
    }
    await db.execute("UPDATE admin_search_connection SET active_id='old-key'");
    await db.execute(
      "UPDATE admin_search_connection SET active_id='other-key',previous_id='old-key'",
    );
    await maintainCredentialRetention(db);
    expect(
      await db.one(
        "SELECT retired_at,unreferenced_at FROM provider_credential_lifecycle WHERE credential_id='old-key'",
      ),
    ).toEqual({ retired_at: null, unreferenced_at: null });
    await db.execute("UPDATE admin_search_connection SET previous_id=NULL");
    const released = (await db.one<{ unreferenced_at: number }>(
      "SELECT unreferenced_at FROM provider_credential_lifecycle WHERE credential_id='old-key'",
    ))!.unreferenced_at;
    expect(released).toBeGreaterThan(old);
    await maintainCredentialRetention(db, released + 29 * 86400000);
    expect(
      await db.one(
        "SELECT retired_at FROM provider_credential_lifecycle WHERE credential_id='old-key'",
      ),
    ).toEqual({ retired_at: null });
    await maintainCredentialRetention(db, released + 31 * 86400000);
    expect(
      await db.one(
        "SELECT retired_at FROM provider_credential_lifecycle WHERE credential_id='old-key'",
      ),
    ).toEqual({ retired_at: released + 31 * 86400000 });
    expect(
      await db.one(
        "SELECT retired_at FROM provider_credential_lifecycle WHERE credential_id='other-key'",
      ),
    ).toEqual({ retired_at: null });
  });
  it("binds event and delivery identities to the webhook signature and bounds stalled DNS", async () => {
    const body = JSON.stringify({ eventId: "episode:resolved" });
    const headers = notificationHeaders("secret", "100", "episode:resolved", "delivery", body);
    const signed = notificationSignature("secret", "100", "episode:resolved", "delivery", body);
    expect(headers).toMatchObject({
      "X-Radar-Event-Id": "episode:resolved",
      "Idempotency-Key": "delivery",
      "X-Radar-Signature": `sha256=${signed}`,
      "X-Radar-Signature-Version": "2",
    });
    expect(notificationSignature("secret", "100", "other", "delivery", body)).not.toBe(signed);
    expect(notificationSignature("secret", "100", "episode:resolved", "other", body)).not.toBe(
      signed,
    );
    await expect(
      validateWebhookDestination("https://alerts.example.com", (async () => [
        { address: "192.88.99.2", family: 4 },
      ]) as never),
    ).rejects.toThrow("WEBHOOK_DESTINATION_BLOCKED");
    vi.useFakeTimers();
    try {
      const stalled = sendSignedWebhook(
        "https://alerts.example.com",
        body,
        "secret",
        "delivery",
        "episode:resolved",
        (() => new Promise(() => {})) as never,
      );
      const failure = expect(stalled).rejects.toThrow("WEBHOOK_TIMEOUT");
      await vi.advanceTimersByTimeAsync(15000);
      await failure;
    } finally {
      vi.useRealTimers();
    }
  });
  it("highlights 114 staged dead letters and legacy/failed/domain terminal cohorts without replay or provider bodies", async () => {
    const db = await fixture();
    for (let i = 0; i < 116; i++) {
      const job = `terminal-${i}`;
      await db.execute(
        "INSERT INTO canonical_opportunities(id,source,source_job_id,canonical_url) VALUES(?,'fixture',?,?)",
        [job, job, `https://example.com/${job}`],
      );
      await db.execute(
        "INSERT INTO opportunity_versions(id,canonical_job_id,content_hash,job_title,raw_content) VALUES(?,?,?,'Role','Role')",
        [job, job, job],
      );
      await db.execute(
        "INSERT INTO search_plan_candidates(tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,attention_decision,eligibility) VALUES('tenant_A','person_A','plan_A',?,?,'CANDIDATE','ELIGIBLE')",
        [job, job],
      );
      await db.execute(
        "INSERT INTO evaluation_jobs(id,tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,status,last_error) VALUES(?,'tenant_A','person_A','plan_A',?,?,'fingerprint_A',?,'provider-body-secret')",
        [job, job, job, i < 114 ? "staged_dead_letter" : i === 114 ? "dead_letter" : "failed"],
      );
    }
    await db.execute(
      "INSERT INTO dossier_composition_jobs(id,tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,evaluation_fingerprint,profile_version,recipe,status,next_attempt_at,created_at,updated_at) VALUES('composition-terminal','tenant_A','person_A','terminal-0','terminal-0','fingerprint_A','evaluation','profile','recipe','needs_attention',0,0,0)",
    );
    await db.execute(
      "INSERT INTO dossier_review_jobs(id,tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,evaluation_fingerprint,profile_version,recipe,draft_json,draft_fingerprint,status,next_attempt_at,created_at,updated_at) VALUES('review-terminal','tenant_A','person_A','terminal-0','terminal-0','fingerprint_A','evaluation','profile','recipe','{}','draft','needs_attention',0,0,0)",
    );
    await db.execute(
      "INSERT INTO opportunity_pursuits(id,tenant_id,person_id,job_hash,canonical_job_id,opportunity_version,evaluation_context_fingerprint,created_at,updated_at) VALUES('pursuit','tenant_A','person_A','terminal-0','terminal-0','terminal-0','fingerprint_A','2026-10-01','2026-10-01')",
    );
    await db.execute(
      "INSERT INTO pursuit_preparation_jobs(id,tenant_id,person_id,pursuit_id,job_hash,requested_by,status,created_at,updated_at) VALUES('pursuit-terminal','tenant_A','person_A','pursuit','terminal-0','op','failed','2026-10-01','2026-10-01')",
    );
    const before = await db.many("SELECT id,status,last_error FROM evaluation_jobs ORDER BY id");
    const snapshot = await readOperations(db, "viewer");
    if (!snapshot.installed) throw new Error("operations required");
    expect(snapshot.queues.find((q) => q.pipeline === "evaluation")).toMatchObject({
      waiting: 0,
      active: 0,
      dead_letter: 115,
      failed: 1,
      needs_attention: 0,
      terminal: 116,
    });
    expect(snapshot.attention.find((a) => a.target === "queue-evaluation")).toMatchObject({
      severity: "High",
      message: expect.stringContaining("115 dead-letter, 1 failed, 0 needs-attention"),
    });
    expect(snapshot.attention.filter((a) => a.target.startsWith("queue-"))).toHaveLength(4);
    expect(snapshot.terminalJobs.filter((j) => j.pipeline === "evaluation")).toHaveLength(100);
    expect(
      snapshot.terminalJobs.filter((j) => j.pipeline !== "evaluation").map((j) => j.recovery),
    ).toEqual([
      expect.stringContaining("Domain retry entry point available"),
      expect.stringContaining("Domain retry entry point available"),
      expect.stringContaining("Domain recovery policy required"),
    ]);
    expect(snapshot.terminalJobs.find((j) => j.job_id === "pursuit-terminal")).toMatchObject({
      tenant_id: "tenant_A",
      person_id: "person_A",
      canonical_job_id: "terminal-0",
      opportunity_version: "terminal-0",
      context_fingerprint: "fingerprint_A",
    });
    expect(JSON.stringify(snapshot)).not.toContain("provider-body-secret");
    expect(await db.many("SELECT id,status,last_error FROM evaluation_jobs ORDER BY id")).toEqual(
      before,
    );
    await expect(readOperations(db, "person_A")).rejects.toThrow();
  });
  it.each([
    "validation",
    "host_probes",
    "reconciliation",
    "notifications",
    "retirement",
    "purge",
  ] as const)(
    "highlights unavailable evaluation maintenance with empty business queues and pending %s",
    async (kind) => {
      const db = await fixture();
      await db.execute("DELETE FROM worker_heartbeats");
      const old = Date.now() - 31 * 86400000;
      if (["validation", "retirement", "purge"].includes(kind)) {
        await db.execute(
          "INSERT INTO admin_search_credentials VALUES('maintenance-credential','{}','suffix',?,'op')",
          [kind === "validation" ? Date.now() : old],
        );
        await db.execute(
          "INSERT INTO provider_credential_lifecycle(credential_id,key_version,retired_at,unreferenced_at) VALUES('maintenance-credential','fixture',?,?)",
          [kind === "purge" ? old : null, kind === "retirement" ? old : null],
        );
      }
      if (kind === "validation")
        await db.execute(
          "INSERT INTO admin_search_checks(id,credential_id,status,created_at,created_by) VALUES('check','maintenance-credential','queued',0,'op')",
        );
      if (kind === "host_probes")
        await db.execute(
          "INSERT INTO provider_host_checks(id,provider,status,created_at,created_by) VALUES('check','bedrock','queued',0,'op')",
        );
      if (kind === "reconciliation" || kind === "notifications") {
        const incident = await observeProviderFailure(db, {
          connectionId: TAVILY_CONNECTION,
          provider: "tavily",
          generation: 0,
          failure: "credential",
          deployment: "test",
        });
        if (kind === "reconciliation")
          await db.execute("UPDATE provider_incidents SET state='recovering' WHERE id=?", [
            incident,
          ]);
        else
          await db.execute(
            "INSERT INTO notification_deliveries(id,incident_id,event,destination_url,secret_envelope,payload_json,next_attempt_at) VALUES('delivery',?,'opened','https://alerts.example.com','{}','{}',0)",
            [incident],
          );
      }
      const snapshot = await readOperations(db, "op");
      if (!snapshot.installed) throw new Error("operations required");
      expect(snapshot.queues.every((q) => !q.waiting && !q.active && !q.terminal)).toBe(true);
      expect(snapshot.maintenance).toMatchObject({ online: false, pending: { [kind]: 1 } });
      expect(snapshot.attention.find((a) => a.target === "maintenance")).toMatchObject({
        severity: "High",
        message: expect.stringContaining("Evaluation maintenance worker unavailable"),
      });
    },
  );
  it("requires fresh matching release/database maintenance heartbeats and protects referenced retention versions", async () => {
    const db = await fixture();
    const old = Date.now() - 31 * 86400000;
    await db.execute(
      "INSERT INTO admin_search_credentials VALUES('protected','{}','suffix',?,'op')",
      [old],
    );
    await db.execute(
      "INSERT INTO provider_credential_lifecycle(credential_id,key_version) VALUES('protected','fixture')",
    );
    await db.execute("UPDATE admin_search_connection SET previous_id='protected'");
    await db.execute(
      "INSERT INTO provider_host_checks(id,provider,status,created_at,created_by) VALUES('check','bedrock','queued',0,'op')",
    );
    const fingerprint = getDatabaseTargetIdentity().fingerprint;
    await db.execute(
      "INSERT INTO worker_heartbeats VALUES('dossier-review','review-1','development',?,?)",
      [fingerprint, new Date().toISOString()],
    );
    await db.execute(
      "INSERT INTO operations_maintenance_tasks VALUES('review-1','host_provider_checks','development',?,?,?,0,NULL)",
      [fingerprint, Date.now(), Date.now()],
    );
    for (const [release, database, seen, online] of [
      ["older-release", fingerprint, new Date().toISOString(), false],
      ["development", "other-database", new Date().toISOString(), false],
      ["development", fingerprint, new Date(Date.now() - 151000).toISOString(), false],
      ["development", fingerprint, new Date().toISOString(), true],
    ] as const) {
      await db.execute(
        "UPDATE worker_heartbeats SET release_sha=?,database_fingerprint=?,last_seen_at=?",
        [release, database, seen],
      );
      if (online) {
        const now = Date.now();
        for (const task of CRITICAL_EVALUATION_MAINTENANCE_TASKS)
          await db.execute(
            `INSERT INTO operations_maintenance_tasks
             (worker_instance,task,release_sha,database_fingerprint,last_started_at,last_success_at,consecutive_failures,error_code)
             VALUES('processing-1',?,?,?,?,?,0,NULL)
             ON CONFLICT(worker_instance,task) DO UPDATE SET
               release_sha=excluded.release_sha,database_fingerprint=excluded.database_fingerprint,
               last_started_at=excluded.last_started_at,last_success_at=excluded.last_success_at,
               consecutive_failures=0,error_code=NULL`,
            [task, release, database, now, now],
          );
      }
      const snapshot = await readOperations(db, "op");
      if (!snapshot.installed) throw new Error("operations required");
      expect(snapshot.maintenance.online).toBe(online);
      expect(snapshot.maintenance.pending.retirement).toBe(0);
      expect(snapshot.attention.some((a) => a.target === "maintenance")).toBe(!online);
    }
    await db.execute("DELETE FROM provider_host_checks");
    await db.execute("DELETE FROM worker_heartbeats");
    const snapshot = await readOperations(db, "op");
    if (!snapshot.installed) throw new Error("operations required");
    expect(snapshot.attention.some((a) => a.target === "maintenance")).toBe(false);
  });
  it("upgrades populated migration 084 while preserving host fallback and existing data", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "radar-ops-migration-"));
    const db = new SqliteAdapter(new Database(":memory:"));
    adapters.push(db);
    const directory = resolve("src/data/sqlite/migrations");
    const legacyDirectory = join(temporary, "legacy");
    const through087Directory = join(temporary, "through-087");
    mkdirSync(legacyDirectory);
    mkdirSync(through087Directory);
    try {
      for (const file of readdirSync(directory))
        if (file.endsWith(".sql") && parseInt(file.slice(0, 3), 10) <= 84)
          copyFileSync(join(directory, file), join(legacyDirectory, file));
      await runMigrations(db, legacyDirectory, { verifyRequiredSchema: false });
      await db.execute("INSERT INTO users(id,email) VALUES('existing-user','existing@fixture')");
      vi.stubEnv("TAVILY_API_KEY", "legacy-upgrade-fixture");
      expect((await resolveSearchCredential(db)).key).toBe("legacy-upgrade-fixture");

      for (const file of readdirSync(directory))
        if (file.endsWith(".sql") && parseInt(file.slice(0, 3), 10) <= 87)
          copyFileSync(join(directory, file), join(through087Directory, file));
      await runMigrations(db, through087Directory, { verifyRequiredSchema: false });
      await db.execute(
        `INSERT INTO provider_incidents(id,correlation_key,provider,connection_id,generation,failure_class,severity,state,first_seen,last_seen,error_code)
         VALUES('tavily-mismatch','tavily-mismatch','tavily','tavily:platform',4,'credential','High','open',1,200,'FIXTURE'),
               ('tavily-exact','tavily-exact','tavily','tavily:platform',4,'throttled','High','open',1,100,'FIXTURE'),
               ('bedrock-fallback-old','bedrock-fallback-old','bedrock','bedrock:host',2,'throttled','Warning','open',1,300,'FIXTURE'),
               ('bedrock-fallback-new','bedrock-fallback-new','bedrock','bedrock:host',2,'credential','Warning','open',1,400,'FIXTURE')`,
      );
      await db.execute(
        `INSERT INTO provider_cooldowns(connection_id,generation,blocked_until,requires_action,failures,failure_class)
         VALUES('tavily:platform',4,0,1,3,'throttled'),('bedrock:host',2,0,1,2,'provider_outage')`,
      );
      await db.execute(
        "INSERT INTO admin_search_credentials VALUES('existing-credential','{}','suffix',1,'op')",
      );
      await db.execute(
        `INSERT INTO provider_credential_lifecycle(credential_id,activated_at,superseded_at,retired_at,last_validated_at,last_used_at,key_version,secret_purged_at)
         VALUES('existing-credential',11,12,NULL,13,14,'fixture-key-version',NULL)`,
      );
      for (const [id, url, status] of [
        ["alert-old", "https://old.example.com", "delivered"],
        ["alert-current", "https://current.example.com", "retry"],
      ]) {
        await db.execute(
          "INSERT INTO notification_deliveries(id,incident_id,event,destination_url,secret_envelope,payload_json,status,attempts,next_attempt_at) VALUES(?,'tavily-exact','opened',?,'{}','{}',?,2,123)",
          [id, url, status],
        );
      }
      const beforeDeliveries = await db.many("SELECT * FROM notification_deliveries ORDER BY id");
      await runMigrations(db);
      const afterDeliveries = await db.many<Record<string, unknown>>(
        "SELECT * FROM notification_deliveries ORDER BY id",
      );
      expect(afterDeliveries.map(({ destination_revision, ...row }) => row)).toEqual(
        beforeDeliveries,
      );
      expect(afterDeliveries.every((row) => row.destination_revision === 0)).toBe(true);
      await db.execute(
        "INSERT INTO notification_deliveries(id,incident_id,event,destination_url,secret_envelope,payload_json,next_attempt_at,destination_revision) VALUES('rotated','tavily-exact','opened','https://current.example.com','{}','{}',0,1)",
      );
      await expect(
        db.execute(
          "INSERT INTO notification_deliveries(id,incident_id,event,destination_url,secret_envelope,payload_json,next_attempt_at,destination_revision) VALUES('duplicate','tavily-exact','opened','https://current.example.com','{}','{}',0,1)",
        ),
      ).rejects.toThrow("UNIQUE");
      expect(await db.one("SELECT email FROM users WHERE id='existing-user'")).toEqual({
        email: "existing@fixture",
      });
      expect((await resolveSearchCredential(db)).key).toBe("legacy-upgrade-fixture");
      expect(
        await db.one<{ active_incident_id: string }>(
          "SELECT active_incident_id FROM provider_cooldowns WHERE connection_id='tavily:platform'",
        ),
      ).toEqual({ active_incident_id: "tavily-exact" });
      expect(
        await db.one<{ active_incident_id: string }>(
          "SELECT active_incident_id FROM provider_cooldowns WHERE connection_id='bedrock:host'",
        ),
      ).toEqual({ active_incident_id: "bedrock-fallback-new" });
      expect(
        await db.one<{
          activated_at: number;
          superseded_at: number;
          last_success_at: number | null;
        }>(
          `SELECT activated_at,superseded_at,last_success_at FROM provider_credential_lifecycle
           WHERE credential_id='existing-credential'`,
        ),
      ).toEqual({ activated_at: 11, superseded_at: 12, last_success_at: null });
      expect(
        await db.one("SELECT name FROM sqlite_master WHERE name='operations_maintenance_tasks'"),
      ).toBeTruthy();
      expect(await db.many("PRAGMA foreign_key_check")).toEqual([]);
    } finally {
      if (resolve(temporary).startsWith(resolve(tmpdir()) + "\\"))
        rmSync(temporary, { recursive: true, force: true });
    }
  });
  it("coordinates provider slots across two Node processes and retains cooldown after reopening storage", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "radar-ops-capacity-"));
    const file = join(temporary, "capacity.sqlite");
    const raw = new Database(file);
    raw.pragma("journal_mode=WAL");
    raw.pragma("busy_timeout=5000");
    const db = new SqliteAdapter(raw);
    try {
      await runMigrations(db);
      await db.execute("CREATE TABLE test_capacity_barrier(id TEXT PRIMARY KEY)");
      await observeProviderFailure(db, {
        connectionId: TAVILY_CONNECTION,
        provider: "tavily",
        generation: 0,
        failure: "credential",
        deployment: "test",
      });
      await db.close();
      const script = `import Database from 'better-sqlite3';import {SqliteAdapter} from ${JSON.stringify(pathToFileURL(resolve("src/data/database/sqlite.ts")).href)};import {acquireProviderCapacity,releaseProviderCapacity,assertProviderDispatch} from ${JSON.stringify(pathToFileURL(resolve("src/admin/operations-runtime.ts")).href)};const raw=new Database(${JSON.stringify(file)});raw.pragma('busy_timeout=5000');const db=new SqliteAdapter(raw);await db.execute('INSERT INTO test_capacity_barrier VALUES(?)',[String(process.pid)]);const deadline=Date.now()+5000;while((await db.one('SELECT COUNT(*) n FROM test_capacity_barrier')).n<2){if(Date.now()>deadline)throw new Error('barrier timeout');await new Promise(r=>setTimeout(r,20));}let result='busy';try{const token=await acquireProviderCapacity(db,'shared-provider',String(process.pid),1);result='acquired';await new Promise(r=>setTimeout(r,500));await releaseProviderCapacity(db,token,String(process.pid));}catch(e){if(e.message!=='PROVIDER_CAPACITY_BUSY')throw e;}await assertProviderDispatch(db,'tavily:platform').then(()=>{throw new Error('cooldown lost')},e=>{if(e.message!=='PROVIDER_COOLDOWN')throw e});await db.close();console.log(result);`;
      const execute = promisify(execFile);
      const results = await Promise.all(
        [1, 2].map(() =>
          execute(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
            cwd: process.cwd(),
            env: { ...process.env, NODE_ENV: "test" },
            timeout: 15000,
          }),
        ),
      );
      expect(results.map((r) => r.stdout.trim()).sort()).toEqual(["acquired", "busy"]);
    } finally {
      try {
        await db.close();
      } catch {}
      if (resolve(temporary).startsWith(resolve(tmpdir()) + "\\"))
        rmSync(temporary, { recursive: true, force: true });
    }
  });
  it("rolls back a previous credential only after fresh worker validation and preserves immutable metadata", async () => {
    const db = await fixture();
    async function activate(key: string, revision: number) {
      const candidate = await mutateSearchConnection(db, "op", {
        kind: "candidate",
        key,
        expectedRevision: revision,
        reason: "new verified version",
      });
      await mutateSearchConnection(db, "op", {
        kind: "test",
        credentialId: candidate.credentialId!,
        expectedRevision: revision + 1,
        reason: "validate version",
      });
      await pollSearchConnectionCheck(db, tavilyCapabilityResponse);
      await mutateSearchConnection(db, "op", {
        kind: "activate",
        credentialId: candidate.credentialId!,
        expectedRevision: revision + 1,
        reason: "activate version",
      });
      await pollSearchConnectionCheck(db, tavilyCapabilityResponse);
      return candidate.credentialId!;
    }
    const first = await activate("tvly-" + "a".repeat(30), 0);
    const second = await activate("tvly-" + "b".repeat(30), 2);
    await db.execute("UPDATE admin_search_checks SET completed_at=0 WHERE credential_id=?", [
      first,
    ]);
    await expect(
      mutateSearchConnection(db, "op", {
        kind: "rollback",
        expectedRevision: 4,
        reason: "rollback previous",
      }),
    ).rejects.toThrow("CURRENT_WORKER_CONNECTION_TEST_REQUIRED");
    await mutateSearchConnection(db, "op", {
      kind: "test",
      credentialId: first,
      expectedRevision: 4,
      reason: "validate rollback",
    });
    await pollSearchConnectionCheck(db, tavilyCapabilityResponse);
    await mutateSearchConnection(db, "op", {
      kind: "rollback",
      expectedRevision: 4,
      reason: "verified rollback",
    });
    await pollSearchConnectionCheck(db, tavilyCapabilityResponse);
    expect((await resolveSearchCredential(db)).key).toBe("tvly-" + "a".repeat(30));
    expect(await readSearchConnection(db, "op")).toMatchObject({
      activeId: first,
      previousId: second,
      generation: 3,
    });
    await expect(
      db.execute("UPDATE admin_search_credentials SET suffix='changed' WHERE id=?", [first]),
    ).rejects.toThrow("SEARCH_CREDENTIAL_IMMUTABLE");
  });
  it("recovers a Tavily incident through real evaluation/composition/review queues and resolves only after reviewed publication", async () => {
    const db = await fixture();
    vi.stubEnv("TAVILY_API_KEY", "host-fixture-credential");
    const identity = {
      tenantId: "tenant_A",
      personId: "person_A",
      canonicalJobId: "job",
      opportunityVersion: "version",
      evaluationContextFingerprint,
      profileVersion: "profile",
    };
    await db.execute(
      "INSERT INTO evaluation_contexts(context_fingerprint,tenant_id,person_id,search_plan_snapshot_id,ontology_version,ontology_fingerprint,policy_version,profile_version) VALUES(?,'tenant_A','person_A','sps_A','v1','hash_ontology','staged-v8','profile')",
      [evaluationContextFingerprint],
    );
    await db.execute(
      "INSERT INTO evaluation_context_scopes(context_fingerprint,tenant_id,person_id,search_plan_id) VALUES(?,'tenant_A','person_A','plan_A')",
      [evaluationContextFingerprint],
    );
    await db.execute(
      "INSERT INTO active_evaluation_contexts(tenant_id,person_id,search_plan_id,context_fingerprint,activated_by) VALUES('tenant_A','person_A','plan_A',?,'fixture')",
      [evaluationContextFingerprint],
    );
    await db.execute(
      "INSERT INTO canonical_opportunities(id,source,source_job_id,canonical_url) VALUES('job','LinkedIn','source-job','https://example.com/job')",
    );
    await db.execute(
      "INSERT INTO opportunity_versions(id,canonical_job_id,content_hash,job_title,raw_content) VALUES('version','job','hash','Head of Growth','Lead growth.')",
    );
    const work = await seedOperationalEvaluation(db, identity, "plan_A");
    const secret = "recovery-signing-fixture-000000000000";
    await db.execute(
      `INSERT INTO operational_webhooks(id,url,secret_envelope,minimum_severity,send_recovery,updated_at,updated_by)
       VALUES(1,?,?,?,?,?,?)`,
      [
        "https://alerts.example.com/radar",
        JSON.stringify(new CredentialVault().encrypt(secret)),
        "High",
        1,
        Date.now(),
        "op",
      ],
    );
    const opportunity = { id: "job", company: "Company", title: "Head of Growth" };
    await new ProductionContextProvider(
      db,
      "tenant_A",
      async () => new Response(JSON.stringify({ results: [] })),
      undefined,
      work,
    ).acquire(opportunity, ["companySize"]);
    await expect(
      new ProductionContextProvider(
        db,
        "tenant_A",
        async () => new Response("", { status: 401 }),
        undefined,
        work,
      ).acquire(opportunity, ["companySize"]),
    ).rejects.toThrow("CONTEXT_SEARCH_HTTP_401");
    const incidents = await db.many<{ id: string }>("SELECT id FROM provider_incidents");
    expect(incidents).toHaveLength(1);
    const incidentId = incidents[0]!.id;
    const never = vi.fn(async () => new Response(JSON.stringify({ results: [] })));
    await expect(
      new ProductionContextProvider(db, "tenant_A", never, undefined, work).acquire(opportunity, [
        "companySize",
      ]),
    ).rejects.toThrow("PROVIDER_COOLDOWN");
    expect(never).not.toHaveBeenCalled();
    expect((await pollNotificationDelivery(db, async () => 204))!.success).toBe(true);
    const candidate = await mutateSearchConnection(db, "op", {
      kind: "candidate",
      key: "tvly-" + "r".repeat(30),
      expectedRevision: 0,
      reason: "replace rejected key",
    });
    await mutateSearchConnection(db, "op", {
      kind: "test",
      credentialId: candidate.credentialId!,
      expectedRevision: 1,
      reason: "worker validation",
    });
    await pollSearchConnectionCheck(db, tavilyCapabilityResponse);
    await mutateSearchConnection(db, "op", {
      kind: "activate",
      credentialId: candidate.credentialId!,
      expectedRevision: 1,
      reason: "activate validated key",
    });
    await refreshSearchWorkerReceipt(db);
    await pollSearchConnectionCheck(db, tavilyCapabilityResponse);
    const preview = await previewRecovery(db, "op", incidentId, [work.jobId], "bounded recovery");
    expect(
      (await executeRecovery(db, "op", preview.id, "resume bounded recovery")).outcomes[0]!.outcome,
    ).toBe("resumed");
    await reconcileProviderIncidents(db);
    expect(
      (await db.one<{ state: string }>("SELECT state FROM provider_incidents WHERE id=?", [
        incidentId,
      ]))!.state,
    ).toBe("recovering");
    const completed = await completeOperationalMemo(db, identity, work.jobId);
    expect(await new SqliteRichDossierStore(db).get(identity, completed.fingerprint)).toBeTruthy();
    await reconcileProviderIncidents(db);
    expect(
      (await db.one<{ state: string }>("SELECT state FROM provider_incidents WHERE id=?", [
        incidentId,
      ]))!.state,
    ).toBe("resolved");
    expect((await pollNotificationDelivery(db, async () => 204))!.success).toBe(true);
    expect(
      await db.one(
        "SELECT id FROM notification_deliveries WHERE event='resolved' AND status='delivered'",
      ),
    ).toBeTruthy();
  });
  it("supports independent review jobs while fencing expired owners and preserving serial cooldown", async () => {
    const db = await fixture();
    let now = Date.now();
    await db.execute(
      "UPDATE operational_settings SET revision=1,settings_json=json_set(settings_json,'$.factual_review',2)",
    );
    await activateLineageTestContext(db);
    const first = {
      tenantId: "tenant_A",
      personId: "person_A",
      canonicalJobId: "job",
      opportunityVersion: "v1",
      evaluationContextFingerprint: "fingerprint_A",
      profileVersion: "profile",
    };
    const second = { ...first, opportunityVersion: "v2" };
    const draft = dossier();
    delete draft.generation.factualReviews;
    delete draft.generation.factualReviewer;
    const q = new SqliteDossierReviewQueue(db, () => now);
    await q.enqueue(first, evaluationFingerprint, draft);
    await q.enqueue(second, evaluationFingerprint, draft);
    const one = (await q.claim())!;
    const two = (await q.claim())!;
    expect(one.id).not.toBe(two.id);
    expect(one.lease_mode).toBe("independent");
    now += 180001;
    expect(await q.fail(one, { provider: true, code: "429" })).toBe("lease_lost");
    await expect(q.heartbeat(one)).rejects.toThrow("REVIEW_LEASE_LOST");
    const replacement = (await q.claim())!;
    await expect(q.finish(one, async () => {})).rejects.toThrow("REVIEW_LEASE_LOST");
    await q.fail(replacement, { provider: true, code: "429" }, () => 1);
    expect(await q.claim()).toBeNull(); // durable shared lane cooldown survives independent processing
  });
  it("protects referenced secrets and permits only aged retired ciphertext deletion", async () => {
    const db = await fixture();
    const c = await mutateSearchConnection(db, "op", {
      kind: "candidate",
      key: "tvly-" + "d".repeat(30),
      expectedRevision: 0,
      reason: "retention fixture",
    });
    await db.execute(
      "UPDATE provider_credential_lifecycle SET retired_at=? WHERE credential_id=?",
      [Date.now() - 31 * 86400000, c.credentialId],
    );
    await expect(
      db.execute(
        `UPDATE admin_search_credentials SET envelope_json='{"retired":true}' WHERE id=?`,
        [c.credentialId],
      ),
    ).rejects.toThrow("SEARCH_CREDENTIAL_IMMUTABLE");
    await db.execute("UPDATE admin_search_connection SET candidate_id=NULL");
    await db.execute(
      `UPDATE admin_search_credentials SET envelope_json='{"retired":true}' WHERE id=?`,
      [c.credentialId],
    );
    expect(
      (await db.one<{ envelope_json: string }>(
        "SELECT envelope_json FROM admin_search_credentials WHERE id=?",
        [c.credentialId],
      ))!.envelope_json,
    ).toBe('{"retired":true}');
    await expect(
      db.execute("UPDATE admin_search_credentials SET created_by='other' WHERE id=?", [
        c.credentialId,
      ]),
    ).rejects.toThrow("SEARCH_CREDENTIAL_IMMUTABLE");
  });
  it("runs sanitized provider probes on the matching worker and distinguishes ADC authentication from model permission", async () => {
    const db = await fixture();
    vi.stubEnv("BEDROCK_MANTLE_API_KEY", "fixture-secret");
    vi.stubEnv("GCP_PROJECT_ID", "fixture-project");
    const modelProbeRequest: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return url.includes("bedrock-mantle")
        ? new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: { content: JSON.stringify({ canary: "RADAR" }) },
                },
              ],
            }),
          )
        : new Response(
            JSON.stringify({
              candidates: [
                {
                  finishReason: "STOP",
                  content: { parts: [{ text: JSON.stringify({ canary: "RADAR" }) }] },
                },
              ],
            }),
          );
    };
    for (const provider of ["bedrock", "google"])
      await db.execute(
        "INSERT INTO provider_host_checks(id,provider,status,created_at,created_by) VALUES(?,?,'queued',?,'op')",
        [provider, provider, Date.now()],
      );
    expect(
      await pollHostProviderCheck(
        db,
        { name: "scrape", instance: "wrong", database: "fixture-db" },
        async () => {
          throw new Error("must not call");
        },
      ),
    ).toBeNull();
    await pollHostProviderCheck(
      db,
      { name: "evaluation", instance: "eval", database: "fixture-db" },
      modelProbeRequest,
    );
    await pollHostProviderCheck(
      db,
      { name: "dossier-review", instance: "review", database: "fixture-db" },
      modelProbeRequest,
      async () => "fixture-adc-token",
    );
    const checks = await db.many<{ status: string; details_json: string }>(
      "SELECT status,details_json FROM provider_host_checks",
    );
    expect(checks.every((c) => c.status === "passed")).toBe(true);
    expect(JSON.stringify(checks)).not.toContain("fixture-secret");
    expect(JSON.stringify(checks)).not.toContain("fixture-adc-token");
    expect(checks.map((c) => JSON.parse(c.details_json).permission)).toContain(
      "configured model invocation passed",
    );
  });
  it("limits configuration-lag attention to workers that consume operational settings", async () => {
    const db = await fixture();
    for (const name of ["scrape", "documents", "evaluation"])
      await writeRuntimeReceipt(db, {
        workerName: name,
        instanceId: name,
        connectionId: "runtime",
        runtimeRole: "single-host",
        releaseSha: "development",
        databaseFingerprint: "fixture-db",
        configRevision: "not-loaded",
        generation: 0,
        credentialVersion: null,
        credentialSource: "host",
        reloadMode: "hot",
        reloadStatus: "pending",
        errorCode: null,
        startedAt: Date.now(),
        loadedAt: Date.now(),
        lastSeenAt: Date.now(),
      });
    const snapshot = await readOperations(db, "op");
    if (!snapshot.installed) throw new Error("operations required");
    const messages = snapshot.attention
      .filter((a) => a.message.includes("not yet loaded"))
      .map((a) => a.message);
    expect(messages).toEqual(["evaluation: configuration revision 0 not yet loaded"]);
  });
  it("classifies ambiguous throttling independently from confirmed quota", () => {
    expect(classifySearchFailure(429)).toBe("throttled");
    expect(classifySearchFailure(432)).toBe("quota_exhausted");
    expect(classifySearchFailure(401)).toBe("credential");
  });
  it("deduplicates incidents, bounds observations, persists cooldown and creates recurrence", async () => {
    const db = await fixture();
    const input = {
      connectionId: TAVILY_CONNECTION,
      provider: "tavily",
      generation: 0,
      failure: "credential" as const,
      deployment: "test",
    };
    const id = await observeProviderFailure(db, input);
    expect(await observeProviderFailure(db, input)).toBe(id);
    expect(
      (await db.one<{ occurrences: number }>(
        "SELECT occurrences FROM provider_incidents WHERE id=?",
        [id],
      ))!.occurrences,
    ).toBe(2);
    await expect(
      assertProviderDispatch(db, TAVILY_CONNECTION, undefined, Date.now() + 1e9),
    ).rejects.toThrow("PROVIDER_COOLDOWN");
    await db.execute("UPDATE provider_incidents SET state='resolved' WHERE id=?", [id]);
    const recurrence = await observeProviderFailure(db, input);
    expect(recurrence).not.toBe(id);
    expect(
      (await db.one<{ recurrence_of: string }>(
        "SELECT recurrence_of FROM provider_incidents WHERE id=?",
        [recurrence],
      ))!.recurrence_of,
    ).toBe(id);
  });
  it("coordinates capacity, recovers expired slots and fences late releases", async () => {
    const db = await fixture();
    const now = Date.now();
    const first = await acquireProviderCapacity(db, "provider", "worker-1", 1, now, 100);
    await expect(acquireProviderCapacity(db, "provider", "worker-2", 1, now + 50)).rejects.toThrow(
      "PROVIDER_CAPACITY_BUSY",
    );
    const replacement = await acquireProviderCapacity(db, "provider", "worker-2", 1, now + 101);
    expect(await renewProviderCapacity(db, first, "worker-1", now + 101)).toBe(false);
    await releaseProviderCapacity(db, first, "worker-1");
    expect(
      await db.one("SELECT token FROM provider_capacity_leases WHERE token=?", [replacement]),
    ).toBeTruthy();
  });
  it("keeps host fallback, validates on worker, activates without restart and never returns secrets", async () => {
    const db = await fixture();
    const key = "tvly-" + "x".repeat(30);
    vi.stubEnv("TAVILY_API_KEY", "legacy-host-key");
    expect((await resolveSearchCredential(db)).key).toBe("legacy-host-key");
    await expect(
      mutateSearchConnection(db, "viewer", {
        kind: "candidate",
        key,
        expectedRevision: 0,
        reason: "fixture replacement",
      }),
    ).rejects.toThrow("PLATFORM_ACCESS_DENIED");
    const candidate = await mutateSearchConnection(db, "op", {
      kind: "candidate",
      key,
      expectedRevision: 0,
      reason: "fixture replacement",
    });
    await mutateSearchConnection(db, "op", {
      kind: "test",
      credentialId: candidate.credentialId!,
      expectedRevision: 1,
      reason: "validate replacement",
    });
    await pollSearchConnectionCheck(db, async () => new Response("", { status: 401 }));
    await expect(
      mutateSearchConnection(db, "op", {
        kind: "activate",
        credentialId: candidate.credentialId!,
        expectedRevision: 1,
        reason: "activate replacement",
      }),
    ).rejects.toThrow("CURRENT_WORKER_CONNECTION_TEST_REQUIRED");
    expect((await resolveSearchCredential(db)).key).toBe("legacy-host-key");
    await mutateSearchConnection(db, "op", {
      kind: "test",
      credentialId: candidate.credentialId!,
      expectedRevision: 1,
      reason: "validate replacement",
    });
    await pollSearchConnectionCheck(db, tavilyCapabilityResponse);
    await mutateSearchConnection(db, "op", {
      kind: "activate",
      credentialId: candidate.credentialId!,
      expectedRevision: 1,
      reason: "activate replacement",
    });
    await pollSearchConnectionCheck(db, tavilyCapabilityResponse);
    expect((await resolveSearchCredential(db)).key).toBe(key);
    expect((await searchUptake(db)).ready).toBe(false);
    await refreshSearchWorkerReceipt(db);
    expect((await searchUptake(db)).ready).toBe(true);
    expect(JSON.stringify(await readSearchConnection(db, "op"))).not.toContain(key);
    expect(JSON.stringify(await db.many("SELECT * FROM admin_audit_log"))).not.toContain(key);
    expect(JSON.stringify(await db.many("SELECT * FROM admin_search_credentials"))).not.toContain(
      key,
    );
    await db.execute("UPDATE worker_runtime_receipts SET last_seen_at=0");
    expect((await searchUptake(db)).ready).toBe(false);
  });
  it("previews exact work and revalidates pauses and expiry without rewriting terminal state", async () => {
    const db = await fixture();
    const work = {
      pipeline: "dossier" as const,
      jobId: "memo-1",
      tenantId: "tenant_A",
      personId: "person_A",
      canonicalJobId: "job",
      opportunityVersion: "version",
      contextFingerprint: "fingerprint_A",
    };
    for (const id of ["memo-1", "memo-2"])
      await db.execute(
        "INSERT INTO dossier_composition_jobs(id,tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,evaluation_fingerprint,profile_version,recipe,status,next_attempt_at,created_at,updated_at) VALUES(?,'tenant_A','person_A','job','version','fingerprint_A','eval','profile',?,'retry',?,0,0)",
        [id, id, Date.now() + 86400000],
      );
    const incidentId = (await observeProviderFailure(db, {
      connectionId: TAVILY_CONNECTION,
      provider: "tavily",
      generation: 0,
      failure: "credential",
      deployment: "test",
      work,
    }))!;
    const credential = await mutateSearchConnection(db, "op", {
      kind: "candidate",
      key: "tvly-" + "z".repeat(30),
      expectedRevision: 0,
      reason: "recovery credential",
    });
    await mutateSearchConnection(db, "op", {
      kind: "test",
      credentialId: credential.credentialId!,
      expectedRevision: 1,
      reason: "validate recovery",
    });
    await pollSearchConnectionCheck(db, tavilyCapabilityResponse);
    await mutateSearchConnection(db, "op", {
      kind: "activate",
      credentialId: credential.credentialId!,
      expectedRevision: 1,
      reason: "activate recovery",
    });
    await refreshSearchWorkerReceipt(db);
    await pollSearchConnectionCheck(db, tavilyCapabilityResponse);
    await expect(previewRecovery(db, "op", incidentId, ["memo-2"], "wrong cohort")).rejects.toThrow(
      "RECOVERY_JOB_NOT_IN_INCIDENT",
    );
    const preview = await previewRecovery(db, "op", incidentId, ["memo-1"], "exact cohort");
    await db.execute(
      "INSERT INTO pipeline_controls VALUES('tenant_A','dossier',1,'pause after preview','op',?)",
      [Date.now()],
    );
    const result = await executeRecovery(db, "op", preview.id, "revalidate cohort");
    expect(result.outcomes).toEqual([
      { jobId: "memo-1", outcome: "skipped", reason: "MANUALLY_PAUSED" },
    ]);
    await db.execute("DELETE FROM pipeline_controls");
    const next = await previewRecovery(db, "op", incidentId, ["memo-1"], "fresh preview");
    expect(
      (await executeRecovery(db, "op", next.id, "resume exact cohort")).outcomes[0]!.outcome,
    ).toBe("resumed");
    expect(
      (await db.one<{ status: string }>(
        "SELECT status FROM dossier_composition_jobs WHERE id='memo-1'",
      ))!.status,
    ).toBe("retry");
    const unselected = await db.one<{ next_attempt_at: number }>(
      "SELECT next_attempt_at FROM dossier_composition_jobs WHERE id='memo-2'",
    );
    expect(unselected!.next_attempt_at).toBeGreaterThan(Date.now());
    const expired = await previewRecovery(db, "op", incidentId, ["memo-1"], "expired preview");
    await db.execute("UPDATE recovery_actions SET expires_at=0 WHERE id=?", [expired.id]);
    await expect(executeRecovery(db, "op", expired.id, "expired execution")).rejects.toThrow(
      "RECOVERY_PREVIEW_EXPIRED",
    );
    await db.execute("UPDATE dossier_composition_jobs SET status='completed' WHERE id='memo-1'");
    await reconcileProviderIncidents(db);
    expect(
      (await db.one<{ state: string }>("SELECT state FROM provider_incidents WHERE id=?", [
        incidentId,
      ]))!.state,
    ).toBe("resolved");
  });
  it("preserves explicit recovery holds after activation and rejects superseded failure observations", async () => {
    const db = await fixture();
    const work = {
      pipeline: "evaluation" as const,
      jobId: "job-1",
      tenantId: "tenant_A",
      personId: "person_A",
      canonicalJobId: "job",
      opportunityVersion: "v",
      contextFingerprint: "ctx",
    };
    await observeProviderFailure(db, {
      connectionId: TAVILY_CONNECTION,
      provider: "tavily",
      generation: 0,
      failure: "credential",
      deployment: "test",
      work,
    });
    expect(await deferralFilter(db, "evaluation", "ej.id")).toContain(
      "failure_class IN ('credential','quota_exhausted','vault')",
    );
    await db.execute("UPDATE admin_search_connection SET generation=1");
    expect(
      await observeProviderFailure(db, {
        connectionId: TAVILY_CONNECTION,
        provider: "tavily",
        generation: 0,
        failure: "credential",
        deployment: "test",
      }),
    ).toBeNull();
  });
  it("delivers asynchronous signed events with redacted durable retries", async () => {
    const db = await fixture();
    const secret = "fixture-webhook-signing-secret-000000000";
    await db.execute(
      `INSERT INTO operational_webhooks(id,url,secret_envelope,minimum_severity,send_recovery,updated_at,updated_by)
       VALUES(1,?,?,?,?,?,?)`,
      [
        "https://alerts.example.com/radar",
        JSON.stringify(new CredentialVault().encrypt(secret)),
        "High",
        1,
        Date.now(),
        "op",
      ],
    );
    const id = await observeProviderFailure(db, {
      connectionId: TAVILY_CONNECTION,
      provider: "tavily",
      generation: 0,
      failure: "credential",
      deployment: "test",
    });
    const send = vi.fn(
      async (_url: string, body: string, value: string, deliveryId: string, eventId: string) => {
        expect(value).toBe(secret);
        expect(JSON.parse(body).incidentId).toBe(id);
        expect(JSON.parse(body).eventId).toBe(eventId);
        expect(notificationSignature(value, "100", eventId, deliveryId, body)).toMatch(
          /^[a-f0-9]{64}$/,
        );
        return 204;
      },
    );
    expect((await pollNotificationDelivery(db, send))!.success).toBe(true);
    expect(
      (await db.one<{ state: string }>("SELECT state FROM provider_incidents WHERE id=?", [id]))!
        .state,
    ).toBe("open");
    expect(JSON.stringify(await db.many("SELECT * FROM notification_deliveries"))).not.toContain(
      secret,
    );
    await expect(validateWebhookDestination("http://alerts.example.com")).rejects.toThrow(
      "WEBHOOK_PUBLIC_HTTPS_REQUIRED",
    );
    await expect(validateWebhookDestination("https://127.0.0.1")).rejects.toThrow(
      "WEBHOOK_PUBLIC_HTTPS_REQUIRED",
    );
    const resolver = async () => [{ address: "10.0.0.1", family: 4 }];
    await expect(
      validateWebhookDestination("https://alerts.example.com", resolver as never),
    ).rejects.toThrow("WEBHOOK_DESTINATION_BLOCKED");
  });
});
