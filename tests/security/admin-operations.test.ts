import { pollHostProviderCheck } from "../../src/admin/host-provider-checks";
import { readOperations } from "../../src/admin/operations-service";
import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";
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
import { mkdtempSync, readdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runMigrations } from "../../src/data/sqlite/migrations/runner";
const adapters: SqliteAdapter[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const db of adapters.splice(0)) await db.close();
});
async function fixture() {
  const db = new SqliteAdapter(new Database(":memory:"));
  adapters.push(db);
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
describe("Operations & Recovery", () => {
  it("upgrades populated migration 084 while preserving host fallback and existing data", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "radar-ops-migration-"));
    const db = new SqliteAdapter(new Database(":memory:"));
    adapters.push(db);
    const directory = resolve("src/data/sqlite/migrations");
    try {
      for (const file of readdirSync(directory))
        if (file.endsWith(".sql") && parseInt(file.slice(0, 3), 10) <= 84)
          copyFileSync(join(directory, file), join(temporary, file));
      await runMigrations(db, temporary, { verifyRequiredSchema: false });
      await db.execute("INSERT INTO users(id,email) VALUES('existing-user','existing@fixture')");
      vi.stubEnv("TAVILY_API_KEY", "legacy-upgrade-fixture");
      expect((await resolveSearchCredential(db)).key).toBe("legacy-upgrade-fixture");
      await runMigrations(db);
      expect(await db.one("SELECT email FROM users WHERE id='existing-user'")).toEqual({
        email: "existing@fixture",
      });
      expect((await resolveSearchCredential(db)).key).toBe("legacy-upgrade-fixture");
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
      await pollSearchConnectionCheck(
        db,
        async () => new Response(JSON.stringify({ results: [] })),
      );
      await mutateSearchConnection(db, "op", {
        kind: "activate",
        credentialId: candidate.credentialId!,
        expectedRevision: revision + 1,
        reason: "activate version",
      });
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
    await pollSearchConnectionCheck(db, async () => new Response(JSON.stringify({ results: [] })));
    await mutateSearchConnection(db, "op", {
      kind: "rollback",
      expectedRevision: 4,
      reason: "verified rollback",
    });
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
    await db.execute("INSERT INTO operational_webhooks VALUES(1,?,?,?,?,?,?)", [
      "https://alerts.example.com/radar",
      JSON.stringify(new CredentialVault().encrypt(secret)),
      "High",
      1,
      Date.now(),
      "op",
    ]);
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
    await pollSearchConnectionCheck(db, async () => new Response(JSON.stringify({ results: [] })));
    await mutateSearchConnection(db, "op", {
      kind: "activate",
      credentialId: candidate.credentialId!,
      expectedRevision: 1,
      reason: "activate validated key",
    });
    await refreshSearchWorkerReceipt(db);
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
      async () => new Response(""),
    );
    await pollHostProviderCheck(
      db,
      { name: "dossier-review", instance: "review", database: "fixture-db" },
      undefined,
      async () => "fixture-adc-token",
    );
    const checks = await db.many<{ status: string; details_json: string }>(
      "SELECT status,details_json FROM provider_host_checks",
    );
    expect(checks.every((c) => c.status === "passed")).toBe(true);
    expect(JSON.stringify(checks)).not.toContain("fixture-secret");
    expect(JSON.stringify(checks)).not.toContain("fixture-adc-token");
    expect(checks.map((c) => JSON.parse(c.details_json).permission)).toContain("unverified");
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
    await pollSearchConnectionCheck(db, async () => new Response(JSON.stringify({ results: [] })));
    await mutateSearchConnection(db, "op", {
      kind: "activate",
      credentialId: candidate.credentialId!,
      expectedRevision: 1,
      reason: "activate replacement",
    });
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
    await pollSearchConnectionCheck(db, async () => new Response(JSON.stringify({ results: [] })));
    await mutateSearchConnection(db, "op", {
      kind: "activate",
      credentialId: credential.credentialId!,
      expectedRevision: 1,
      reason: "activate recovery",
    });
    await refreshSearchWorkerReceipt(db);
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
    await db.execute("INSERT INTO operational_webhooks VALUES(1,?,?,?,?,?,?)", [
      "https://alerts.example.com/radar",
      JSON.stringify(new CredentialVault().encrypt(secret)),
      "High",
      1,
      Date.now(),
      "op",
    ]);
    const id = await observeProviderFailure(db, {
      connectionId: TAVILY_CONNECTION,
      provider: "tavily",
      generation: 0,
      failure: "credential",
      deployment: "test",
    });
    const send = vi.fn(async (_url: string, body: string, value: string, eventId: string) => {
      expect(value).toBe(secret);
      expect(JSON.parse(body).incidentId).toBe(id);
      expect(JSON.parse(body).eventId).toBe(eventId);
      expect(notificationSignature(value, "100", body)).toMatch(/^[a-f0-9]{64}$/);
      return 204;
    });
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
