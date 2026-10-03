import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { basename, dirname, resolve, sep } from "node:path";
import { TursoAdapter } from "../../src/data/database/turso";
import { runMigrations } from "../../src/data/sqlite/migrations/runner";
import { observeProviderFailure } from "../../src/admin/operations-runtime";
import {
  mutateSearchConnection,
  registerConnectionWorker,
  pollSearchConnectionCheck,
  refreshSearchWorkerReceipt,
} from "../../src/admin/search-connections";
import { previewRecovery, executeRecovery } from "../../src/admin/operations-recovery";

// Run in a child process: libSQL native handles on Windows can outlive client.close().
// The caller supplies a disposable file and removes it after this process exits.
const target = new URL(process.argv[2]!);
assert.equal(target.protocol, "file:");
const path = resolve(fileURLToPath(target));
assert.equal(basename(path), "rollback.sqlite");
assert.ok(
  path.startsWith(resolve(tmpdir()) + sep) &&
    basename(dirname(path)).startsWith("radar-recovery-rollback-"),
);
const db = new TursoAdapter(target.href, "");
try {
  await runMigrations(db);
  if (process.argv[3] === "stream") {
    // Exercise the real Client.transaction() branch used by remote transports,
    // using a disposable local transport rather than any live database.
    Object.defineProperty(db, "localKey", { value: undefined });
  }
  await db.execute("INSERT INTO users(id,email) VALUES('op','op@fixture')");
  await db.execute("INSERT INTO platform_roles VALUES('op','operator',0,'fixture','fixture',NULL)");
  await db.execute("INSERT INTO tenants(id,status) VALUES('tenant_A','active')");
  await db.execute(
    "INSERT INTO people(id,email,tenant_id) VALUES('person_A','person@fixture','tenant_A')",
  );
  await db.execute(
    "INSERT INTO worker_heartbeats VALUES('evaluation','proof','development','fixture-db',?)",
    [new Date().toISOString()],
  );
  registerConnectionWorker("evaluation", "proof", "fixture-db");
  const future = Date.now() + 86400000;
  await db.execute(
    "INSERT INTO dossier_composition_jobs(id,tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,evaluation_fingerprint,profile_version,recipe,status,next_attempt_at,created_at,updated_at) VALUES('memo','tenant_A','person_A','job','version','fingerprint','eval','profile','recipe','retry',?,0,0)",
    [future],
  );
  const work = {
    pipeline: "dossier" as const,
    jobId: "memo",
    tenantId: "tenant_A",
    personId: "person_A",
    canonicalJobId: "job",
    opportunityVersion: "version",
    contextFingerprint: "fingerprint",
  };
  const incident = (await observeProviderFailure(db, {
    connectionId: "tavily:platform",
    provider: "tavily",
    generation: 0,
    failure: "credential",
    deployment: "fixture",
    work,
  }))!;
  const candidate = await mutateSearchConnection(db, "op", {
    kind: "candidate",
    key: "tvly-" + "p".repeat(30),
    expectedRevision: 0,
    reason: "replace fixture",
  });
  await mutateSearchConnection(db, "op", {
    kind: "test",
    credentialId: candidate.credentialId!,
    expectedRevision: 1,
    reason: "validate fixture",
  });
  await pollSearchConnectionCheck(db, async () => new Response(JSON.stringify({ results: [] })));
  await mutateSearchConnection(db, "op", {
    kind: "activate",
    credentialId: candidate.credentialId!,
    expectedRevision: 1,
    reason: "activate fixture",
  });
  await refreshSearchWorkerReceipt(db);
  const preview = await previewRecovery(db, "op", incident, [work.jobId], "preview rollback proof");
  await db.execute(
    "CREATE TRIGGER reject_recovery_audit BEFORE INSERT ON admin_audit_log WHEN NEW.action='recovery.execute' BEGIN SELECT RAISE(ABORT,'INJECTED_LATE_FAILURE'); END",
  );
  await assert.rejects(
    executeRecovery(db, "op", preview.id, "atomic rollback proof"),
    /INJECTED_LATE_FAILURE/,
  );
  assert.deepEqual(await db.one("SELECT state FROM recovery_actions WHERE id=?", [preview.id]), {
    state: "previewed",
  });
  assert.deepEqual(
    await db.one("SELECT next_attempt_at FROM dossier_composition_jobs WHERE id='memo'"),
    { next_attempt_at: future },
  );
  assert.deepEqual(
    await db.one("SELECT outcome FROM recovery_action_jobs WHERE action_id=?", [preview.id]),
    { outcome: "selected" },
  );
  await db.execute("DROP TRIGGER reject_recovery_audit");
  assert.equal(
    (await executeRecovery(db, "op", preview.id, "retry preview")).outcomes[0]!.outcome,
    "resumed",
  );
  console.log(
    JSON.stringify({ rollback: "passed", retry: "passed", mode: process.argv[3] ?? "local" }),
  );
} finally {
  await db.close();
}
