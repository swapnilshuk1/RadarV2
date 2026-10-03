import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import type { DatabaseAdapter } from "../../src/data/database/adapter";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";
import { SqliteScrapeRunStore } from "../../src/data/sqlite/repositories/SqliteScrapeRunStore";
import { applyProtectionMutation as rawApplyProtectionMutation } from "../../src/admin/protection-mutations";
import { protectionState } from "../../src/admin/protection-state";
import {
  reserveClaim,
  reserveModelCall,
  settleModelCall,
  finishReservation,
  renewReservation,
} from "../../src/admin/protection";
import {
  quotaDimensions,
  validateProtectionMutation,
  type TenantQuota,
} from "../../src/admin/protection-contracts";
import {
  createSqliteModelInvocationSink,
  type ModelInvocationContext,
  type ModelInvocationEvent,
} from "../../src/lib/model/model-invocation";
import { BedrockMantleJsonModel } from "../../src/lib/model/bedrock-mantle-model";
import { readAdminSnapshot } from "../../src/admin/service";

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const quota = (extra: Partial<TenantQuota> = {}): TenantQuota =>
  ({
    ...Object.fromEntries(quotaDimensions.map((k) => [k, null])),
    job_input_tokens: 10000,
    job_output_tokens: 1000,
    ...extra,
  }) as TenantQuota;
async function fixture(db: DatabaseAdapter = new SqliteAdapter(new Database(":memory:"))) {
  cleanup.push(() => db.close?.());
  await setupLineageTestFixture(db);
  await db.execute(
    "INSERT INTO users(id,email) VALUES('op','op@test.com'),('viewer','viewer@test.com'),('owner','owner@test.com')",
  );
  await db.execute(
    "INSERT INTO platform_roles VALUES('op','operator',0,'fixture','test',NULL),('viewer','viewer',0,'fixture','test',NULL)",
  );
  return db;
}
async function applyProtectionMutation(
  db: DatabaseAdapter,
  actor: string,
  input: Record<string, unknown>,
) {
  return rawApplyProtectionMutation(db, actor, {
    ...input,
    expectedState: input.expectedState ?? (await protectionState(db)),
  } as import("../../src/admin/protection-contracts").ProtectionMutation);
}
const setQuota = (db: DatabaseAdapter, extra: Partial<TenantQuota> = {}) =>
  applyProtectionMutation(db, "op", {
    kind: "quota",
    tenant: "tenant_A",
    quota: quota(extra),
    reason: "fixture",
  });
const claim = (db: DatabaseAdapter, id = "job", token = "lease", now = Date.now()) =>
  db.transaction((tx) =>
    reserveClaim(
      tx,
      { pipeline: "evaluation", id, tenant: "tenant_A", token, leaseUntil: now + 60000 },
      now,
    ),
  );
const context = (id = "job", token = "lease"): ModelInvocationContext => ({
  pipeline: "evaluation",
  tenantId: "tenant_A",
  personId: "person_A",
  canonicalJobId: "canonical",
  opportunityVersion: "version",
  evaluationContextFingerprint: "fingerprint_A",
  evaluationJobId: id,
  leaseToken: token,
});
const call = (id = "call") => ({
  id,
  instruction: "Evaluate",
  input: { text: "evidence" },
  maxOutput: 100,
});
const event = (
  id = "call",
  usage: ModelInvocationEvent["usage"] = { inputTokens: 50, outputTokens: 20 },
): ModelInvocationEvent => ({
  invocationId: id,
  provider: "bedrock-mantle",
  modelId: "fixture",
  modelVersion: "fixture",
  modelConfigurationFingerprint: "fixture",
  requestFingerprint: "fixture",
  stage: "screening",
  attempt: 1,
  startedAt: Date.now(),
  completedAt: Date.now(),
  status: "completed",
  usage,
});

describe("Administration protection", () => {
  it("allows only a recorded live legacy lease during policy activation", async () => {
    const db = await fixture();
    expect(await claim(db, "legacy", "old")).toBe(true);
    await setQuota(db);
    await expect(
      reserveModelCall(db, context("legacy", "old"), call("allowed")),
    ).resolves.toBeUndefined();
    expect(await db.many("SELECT id FROM quota_calls")).toEqual([]);
    await expect(reserveModelCall(db, context("legacy", "wrong"), call())).rejects.toThrow(
      "UNSCOPED_MODEL_JOB",
    );
    await finishReservation(db, "evaluation", "legacy", "old", false);
    expect(await claim(db, "legacy", "new")).toBe(true);
    await expect(reserveModelCall(db, context("legacy", "old"), call())).rejects.toThrow(
      "RESERVATION_LEASE_LOST",
    );
  });
  it("keeps concurrent call reservations and duplicate completions within the lifetime ceiling", async () => {
    const db = await fixture();
    await setQuota(db);
    await claim(db);
    for (let round = 0; round < 8; round++) {
      const outcomes = await Promise.allSettled(
        Array.from({ length: 32 }, (_, i) =>
          reserveModelCall(db, context(), call(`r${round}-${i}`)),
        ),
      );
      expect(
        outcomes.some(
          (r) =>
            r.status === "rejected" &&
            !(r.reason instanceof Error && r.reason.name === "QuotaDeferredError"),
        ),
      ).toBe(false);
      const admitted = outcomes.flatMap((r, i) =>
        r.status === "fulfilled" ? [`r${round}-${i}`] : [],
      );
      expect(admitted.length).toBeGreaterThan(0);
      await Promise.all(
        admitted.flatMap((id) => [
          settleModelCall(db, context(), event(id)),
          settleModelCall(db, context(), event(id)),
        ]),
      );
      const row = await db.one<{ input_used: number; output_used: number }>(
        "SELECT input_used,output_used FROM quota_jobs",
      );
      const spent = await db.one(
        "SELECT SUM(input_charged) input_used,SUM(output_charged) output_used FROM quota_calls",
      );
      expect(row).toEqual(spent);
      expect(row!.input_used).toBeLessThanOrEqual(10000);
      expect(row!.output_used).toBeLessThanOrEqual(1000);
    }
  });
  it("does not expose worker lease capabilities through the console", async () => {
    const db = await fixture();
    await setQuota(db);
    await claim(db, "sensitive-job", "private-lease-token");
    const snapshot = await readAdminSnapshot(db, "viewer", "tenant_A");
    expect(JSON.stringify(snapshot)).not.toContain("private-lease-token");
  });
  it("serializes 32 asynchronous claims sharing one SQLite connection", async () => {
    const db = await fixture();
    await setQuota(db, { concurrent_jobs: 3 });
    const outcomes = await Promise.allSettled(
      Array.from({ length: 32 }, (_, i) => claim(db, `race-${i}`)),
    );
    expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(0);
    expect(outcomes.filter((r) => r.status === "fulfilled" && r.value)).toHaveLength(3);
  });
  it("serializes local libSQL claims sharing one worker event loop", async () => {
    const dir = mkdtempSync(join(tmpdir(), "radar-quota-local-"));
    cleanup.push(() =>
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
    );
    const file = join(dir, "db.sqlite"),
      url = pathToFileURL(file).href,
      db = await fixture(new SqliteAdapter(new Database(file)));
    await setQuota(db, { concurrent_jobs: 3 });
    const helper = join(dir, "local.mts");
    writeFileSync(
      helper,
      `import {TursoAdapter} from ${JSON.stringify(pathToFileURL(join(process.cwd(), "src/data/database/turso.ts")).href)};
    import {reserveClaim} from ${JSON.stringify(pathToFileURL(join(process.cwd(), "src/admin/protection.ts")).href)};
    const a=new TursoAdapter(process.argv[2],''),b=new TursoAdapter(process.argv[2],'');
    await Promise.all([a.one('SELECT 1'),b.one('SELECT 1')]);
    const results=[];
    for(let round=0;round<8;round++)results.push(...await Promise.allSettled(Array.from({length:32},(_,i)=>[a,b][i%2].transaction(tx=>reserveClaim(tx,{pipeline:'evaluation',id:String(round*32+i),tenant:'tenant_A',token:'lease',leaseUntil:Date.now()+60000})))));
    console.log(JSON.stringify({accepted:results.filter(r=>r.status==='fulfilled'&&r.value).length,rejected:results.filter(r=>r.status==='rejected').length}));
    await a.close();await b.close();`,
    );
    for (let cycle = 0; cycle < 3; cycle++) {
      const output = await promisify(execFile)(process.execPath, ["--import", "tsx", helper, url], {
        cwd: process.cwd(),
        timeout: 60000,
      }).catch((error) => {
        throw new Error(
          `Local stress child failed: ${error.code}\n${error.stderr}\n${error.stdout}`,
        );
      });
      expect(JSON.parse(output.stdout.trim())).toEqual({ accepted: 3, rejected: 0 });
    }
  }, 60000);
  it("rejects unproved legacy calls when a quota policy exists", async () => {
    const db = await fixture();
    await setQuota(db);
    await expect(reserveModelCall(db, context("never-claimed"), call())).rejects.toThrow(
      "UNSCOPED_MODEL_JOB",
    );
  });
  it("preserves budget and storm holds when unrelated quota values change", async () => {
    const db = await fixture();
    await setQuota(db);
    await claim(db);
    await expect(
      reserveModelCall(db, context(), { ...call(), input: "oversized".repeat(10000) }),
    ).rejects.toThrow("JOB_TOKEN_CEILING");
    await finishReservation(db, "evaluation", "job", "lease", false);
    await setQuota(db, { scrapes_daily: 2 });
    expect(await claim(db)).toBe(false);
  });
  it("holds the sixth invalid-output attempt within a single live lease", async () => {
    const db = await fixture();
    await setQuota(db);
    await claim(db);
    for (let i = 0; i < 5; i++) {
      await reserveModelCall(db, context(), call(`bad-${i}`));
      await settleModelCall(db, context(), {
        ...event(`bad-${i}`, { inputTokens: 10, outputTokens: 5 }),
        status: "invalid_output",
      });
    }
    await expect(reserveModelCall(db, context(), call("sixth"))).rejects.toThrow(
      "INVALID_OUTPUT_RETRY_STORM",
    );
  });
  it("does not shift a pursuit first-claim count to the retry month", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T23:59:00Z"));
    const db = await fixture();
    await setQuota(db, { pursuits_monthly: 1 });
    const pursue = (id: string) =>
      db.transaction((tx) =>
        reserveClaim(tx, {
          pipeline: "pursuit",
          id,
          tenant: "tenant_A",
          token: "lease",
          leaseUntil: Date.now() + 60000,
        }),
      );
    expect(await pursue("old")).toBe(true);
    await finishReservation(db, "pursuit", "old", "lease", false);
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    expect(await pursue("old")).toBe(true);
    await finishReservation(db, "pursuit", "old", "lease", true);
    expect(await pursue("new")).toBe(true);
  });
  it("does not settle another job receipt or refund malformed provider usage", async () => {
    const db = await fixture();
    await setQuota(db);
    await claim(db);
    await reserveModelCall(db, context(), call());
    await settleModelCall(db, context("foreign-job"), event());
    expect((await db.one<{ settled: number }>("SELECT settled FROM quota_calls"))?.settled).toBe(0);
    await settleModelCall(db, context(), {
      ...event("call", {
        inputTokens: 50,
        outputTokens: 20,
        reasoningTokens: -100,
        totalTokens: 70,
      }),
      provider: "vertex-gemini",
    });
    expect(
      (await db.one<{ unknown_usage: number }>("SELECT unknown_usage FROM quota_calls"))
        ?.unknown_usage,
    ).toBe(1);
  });
  it("recovers unused budget after canonical completion preceded worker cleanup", async () => {
    const db = await fixture();
    await setQuota(db, { concurrent_jobs: 1 });
    const store = new SqliteScrapeRunStore(db);
    await store.createRun(
      { tenantId: "tenant_A", personId: "person_A", roles: [] },
      {
        id: "finished-scrape",
        searchPlanId: "plan_A",
        portalTargets: ["LinkedIn"],
        initialStatus: "queued",
      },
    );
    expect((await store.claimNextForWorker("worker", 60000))?.id).toBe("finished-scrape");
    await db.execute("UPDATE scrape_runs SET status='completed' WHERE id='finished-scrape'");
    expect(await claim(db, "next")).toBe(true);
    expect(
      await db.one("SELECT closed,lease_until FROM quota_jobs WHERE job_id='finished-scrape'"),
    ).toEqual({ closed: 1, lease_until: 0 });
  });
  it("fails closed on reservation storage failure before provider dispatch", async () => {
    const db = await fixture();
    const broken: DatabaseAdapter = {
      one: async () => {
        throw new Error("database offline");
      },
      many: db.many.bind(db),
      execute: db.execute.bind(db),
      transaction: db.transaction.bind(db),
    };
    const request = vi.fn(async () => new Response("{}"));
    const model = new BedrockMantleJsonModel("fixture", async () => "fake", request, {
      invocationSink: createSqliteModelInvocationSink(broken, context()),
    });
    await expect(model.generate("evaluate", {})).rejects.toThrow(
      "QUOTA_RESERVATION_STORE_UNAVAILABLE",
    );
    expect(request).toHaveBeenCalledTimes(0);
  });
  it("requires platform operator writes, validates input and atomically audits changes", async () => {
    const db = await fixture();
    for (const actor of ["owner", "viewer"])
      await expect(
        applyProtectionMutation(db, actor, {
          kind: "quota",
          tenant: "tenant_A",
          quota: quota(),
          reason: "test",
        }),
      ).rejects.toThrow("PLATFORM_ACCESS_DENIED");
    expect(() =>
      validateProtectionMutation({
        kind: "pause",
        tenant: "",
        pipeline: "*",
        paused: true,
        reason: "test",
      }),
    ).toThrow("INVALID_TENANT");
    await expect(
      applyProtectionMutation(db, "op", {
        kind: "quota",
        tenant: "missing",
        quota: quota(),
        reason: "test",
      }),
    ).rejects.toThrow("UNKNOWN_TENANT");
    await setQuota(db);
    expect(await db.one("SELECT action FROM admin_audit_log")).toEqual({ action: "quota.set" });
    await db.execute(
      "CREATE TRIGGER reject_quota_audit BEFORE INSERT ON admin_audit_log BEGIN SELECT RAISE(ABORT,'audit failure'); END",
    );
    await expect(setQuota(db, { evaluations_daily: 0 })).rejects.toThrow("audit failure");
    expect(
      (await db.one<TenantQuota>("SELECT * FROM tenant_quotas"))?.evaluations_daily,
    ).toBeNull();
  });
  it("rejects a protection write made from an obsolete console state", async () => {
    const db = await fixture();
    const state = await protectionState(db);
    await rawApplyProtectionMutation(db, "op", {
      kind: "quota",
      tenant: "tenant_A",
      quota: quota(),
      reason: "first edit",
      expectedState: state!,
    });
    await expect(
      rawApplyProtectionMutation(db, "op", {
        kind: "pause",
        pipeline: "evaluation",
        paused: true,
        reason: "obsolete edit",
        expectedState: state!,
      }),
    ).rejects.toThrow("ADMIN_STATE_CHANGED");
  });
  it("provisions bounded defaults for new tenants and fails closed for a missing policy row", async () => {
    const db = await fixture();
    await db.execute("INSERT INTO tenants(id,status) VALUES('tenant_C','active')");
    expect(
      await db.one(
        "SELECT evaluations_daily,concurrent_jobs FROM tenant_quotas WHERE tenant_id='tenant_C'",
      ),
    ).toEqual({
      evaluations_daily: 50,
      concurrent_jobs: 4,
    });
    await db.execute("DELETE FROM tenant_quotas WHERE tenant_id='tenant_C'");
    const admitted = await db.transaction((tx) =>
      reserveClaim(tx, {
        pipeline: "evaluation",
        id: "missing-policy",
        tenant: "tenant_C",
        token: "lease",
        leaseUntil: Date.now() + 60000,
      }),
    );
    expect(admitted).toBe(false);
    expect(await db.one("SELECT reason FROM quota_deferrals WHERE tenant_id='tenant_C'")).toEqual({
      reason: "QUOTA_POLICY_REQUIRED",
    });
  });
  it("defers a paused tenant without starving another tenant or altering acquisition evidence", async () => {
    const db = await fixture(),
      store = new SqliteScrapeRunStore(db);
    const a = { tenantId: "tenant_A", personId: "person_A", roles: [] },
      b = { tenantId: "tenant_B", personId: "person_B", roles: [] };
    await store.createRun(a, {
      id: "a",
      searchPlanId: "plan_A",
      portalTargets: ["LinkedIn", "Naukri", "Indeed"],
      initialStatus: "queued",
    });
    await store.createRun(b, {
      id: "b",
      searchPlanId: "plan_B",
      portalTargets: ["LinkedIn"],
      initialStatus: "queued",
    });
    await applyProtectionMutation(db, "op", {
      kind: "pause",
      tenant: "tenant_A",
      pipeline: "scrape",
      paused: true,
      reason: "pause test",
    });
    expect(await store.claimNextForWorker("worker", 60000)).toBeNull();
    expect((await store.claimNextForWorker("worker", 60000))?.id).toBe("b");
    expect((await store.getRun(a, "a"))?.portalTargets).toEqual(["LinkedIn", "Naukri", "Indeed"]);
    expect((await store.getRun(a, "a"))?.status).toBe("queued");
    expect(await db.one("SELECT reason FROM quota_deferrals")).toEqual({ reason: "PAUSED" });
    await applyProtectionMutation(db, "op", {
      kind: "pause",
      pipeline: "*",
      paused: true,
      reason: "global pause",
    });
    await applyProtectionMutation(db, "op", {
      kind: "pause",
      tenant: "tenant_A",
      pipeline: "scrape",
      paused: false,
      reason: "tenant resume",
    });
    expect(await store.claimNextForWorker("worker", 60000)).toBeNull();
  });
  it("counts retries once and fences renewals and releases to the current lease", async () => {
    const db = await fixture();
    await setQuota(db, { evaluations_daily: 1, concurrent_jobs: 1 });
    expect(await claim(db)).toBe(true);
    expect(await claim(db, "other")).toBe(false);
    await finishReservation(db, "evaluation", "job", "lease", false);
    expect(await claim(db, "job", "new")).toBe(true);
    await finishReservation(db, "evaluation", "job", "lease", true);
    await renewReservation(db, "evaluation", "job", "lease", 0);
    expect(
      (await db.one<{ closed: number }>("SELECT closed FROM quota_jobs WHERE job_id='job'"))
        ?.closed,
    ).toBe(0);
    await expect(reserveModelCall(db, context("job", "lease"), call())).rejects.toThrow(
      "RESERVATION_LEASE_LOST",
    );
    await finishReservation(db, "evaluation", "job", "new", true);
    expect(await claim(db, "third")).toBe(false);
    expect((await db.one<{ n: number }>("SELECT COUNT(*) n FROM quota_jobs"))?.n).toBe(1);
  });
  it("denies provider dispatch before oversized input and reconciles a valid call once", async () => {
    const db = await fixture();
    await setQuota(db);
    await claim(db);
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
            usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
          }),
          { status: 200 },
        ),
    );
    const model = new BedrockMantleJsonModel("fixture", async () => "fake", request, {
      maxOutputTokens: 100,
      invocationSink: createSqliteModelInvocationSink(db, context()),
    });
    await expect(model.generate("evaluate", { text: "界".repeat(10000) })).rejects.toThrow(
      "JOB_TOKEN_CEILING",
    );
    expect(request).toHaveBeenCalledTimes(0);
    expect(await model.generate("evaluate", { text: "source" })).toEqual({ ok: true });
    expect(request).toHaveBeenCalledTimes(1);
    const row = await db.one<{ id: string; input_charged: number; output_charged: number }>(
      "SELECT * FROM quota_calls",
    );
    expect([row?.input_charged, row?.output_charged]).toEqual([50, 20]);
    await settleModelCall(db, context(), event(row!.id));
    expect(await db.one("SELECT input_used,output_used FROM quota_jobs")).toEqual({
      input_used: 50,
      output_used: 20,
    });
  });
  it("retains unknown usage and counts Gemini reasoning without double counting Mantle", async () => {
    const db = await fixture();
    await setQuota(db);
    await claim(db);
    await reserveModelCall(db, context(), call("unknown"));
    await settleModelCall(db, context(), { ...event("unknown"), usage: undefined });
    expect(
      (
        await db.one<{ unknown_usage: number }>(
          "SELECT unknown_usage FROM quota_calls WHERE id='unknown'",
        )
      )?.unknown_usage,
    ).toBe(1);
    await reserveModelCall(db, context(), call("gemini"));
    await settleModelCall(db, context(), {
      ...event("gemini", {
        inputTokens: 50,
        outputTokens: 20,
        reasoningTokens: 30,
        totalTokens: 100,
      }),
      provider: "vertex-gemini",
    });
    await reserveModelCall(db, context(), call("mantle"));
    await settleModelCall(
      db,
      context(),
      event("mantle", { inputTokens: 50, outputTokens: 50, reasoningTokens: 30, totalTokens: 100 }),
    );
    expect(
      await db.many(
        "SELECT output_charged FROM quota_calls WHERE id IN ('gemini','mantle') ORDER BY id",
      ),
    ).toEqual([{ output_charged: 50 }, { output_charged: 50 }]);
  });
  it("includes pre-policy monthly spend and defers when that usage is unknown", async () => {
    const db = await fixture(),
      sink = createSqliteModelInvocationSink(db, context("legacy"));
    await sink(event("legacy", { inputTokens: 1000, outputTokens: 1000 }));
    await setQuota(db, { reasoning_monthly: 12000 });
    expect(await claim(db)).toBe(false);
    expect(await db.one("SELECT reason FROM quota_deferrals")).toEqual({
      reason: "MONTHLY_TOKEN_RESERVATION",
    });
    await sink({ ...event("legacy"), usage: undefined });
    await setQuota(db, { reasoning_monthly: 100000 });
    expect(await claim(db)).toBe(false);
    expect(await db.one("SELECT reason FROM quota_deferrals")).toEqual({
      reason: "LEGACY_USAGE_UNMEASURED",
    });
  });
  it("expires overrides and provides audited storm recovery while preserving spend", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T00:00:00Z"));
    const db = await fixture();
    await setQuota(db, { evaluations_daily: 0 });
    await applyProtectionMutation(db, "op", {
      kind: "override",
      tenant: "tenant_A",
      dimension: "evaluations_daily",
      limit: 1,
      expires: Date.now() + 1000,
      reason: "temporary",
    });
    expect(await claim(db)).toBe(true);
    for (let i = 0; i < 5; i++) {
      await reserveModelCall(db, context(), call(`invalid${i}`));
      await settleModelCall(db, context(), {
        ...event(`invalid${i}`, { inputTokens: 10, outputTokens: 5 }),
        status: "invalid_output",
      });
    }
    await finishReservation(db, "evaluation", "job", "lease", false);
    expect(await claim(db)).toBe(false);
    expect(await db.one("SELECT reason FROM quota_deferrals")).toEqual({
      reason: "INVALID_OUTPUT_RETRY_STORM",
    });
    vi.setSystemTime(Date.now() + 2000);
    await applyProtectionMutation(db, "op", {
      kind: "resume_job",
      tenant: "tenant_A",
      pipeline: "evaluation",
      jobId: "job",
      reason: "reviewed schema failure",
    });
    expect(await db.one("SELECT input_used,output_used FROM quota_jobs")).toEqual({
      input_used: 50,
      output_used: 25,
    });
    expect(await claim(db)).toBe(true);
    await finishReservation(db, "evaluation", "job", "lease", true);
    expect(await claim(db, "new")).toBe(false);
    expect(
      (
        await db.one<{ n: number }>(
          "SELECT COUNT(*) n FROM admin_audit_log WHERE action='job.resume'",
        )
      )?.n,
    ).toBe(1);
  });
  it("reserves the new month separately while retaining the job lifetime ceiling", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T23:59:30Z"));
    const db = await fixture();
    await setQuota(db, { reasoning_monthly: 11000 });
    await claim(db);
    await reserveModelCall(db, context(), call("oct"));
    await settleModelCall(db, context(), event("oct"));
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    await reserveModelCall(db, context(), call("nov"));
    await settleModelCall(db, context(), event("nov"));
    expect(await db.many("SELECT month FROM quota_calls ORDER BY started_at")).toEqual([
      { month: "2026-10" },
      { month: "2026-11" },
    ]);
    expect(await db.one("SELECT input_used,output_used,month FROM quota_jobs")).toEqual({
      input_used: 100,
      output_used: 40,
      month: "2026-11",
    });
    expect(await claim(db, "second")).toBe(false);
  });
  it("serializes competing reservations across independent database connections", async () => {
    const dir = mkdtempSync(join(tmpdir(), "radar-quota-"));
    cleanup.push(() =>
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
    );
    const url = pathToFileURL(join(dir, "db.sqlite")).href;
    const first = await fixture(new SqliteAdapter(new Database(join(dir, "db.sqlite"))));
    await setQuota(first, { concurrent_jobs: 1 });
    // Separate processes let SQLite's blocking busy timeout wait without blocking
    // the other claimant's commit on the same JavaScript event loop.
    const helper = join(dir, "claim.mts");
    writeFileSync(
      helper,
      `import {TursoAdapter} from ${JSON.stringify(pathToFileURL(join(process.cwd(), "src/data/database/turso.ts")).href)};
      import {reserveClaim} from ${JSON.stringify(pathToFileURL(join(process.cwd(), "src/admin/protection.ts")).href)};
      const db=new TursoAdapter(process.argv[2],'');
      try { console.log(JSON.stringify(await db.transaction(tx=>reserveClaim(tx,{pipeline:'evaluation',id:process.argv[3],tenant:'tenant_A',token:'lease',leaseUntil:Date.now()+60000})))); }
      finally { await db.close(); }`,
    );
    const run = async (id: string) =>
      JSON.parse(
        (
          await promisify(execFile)(process.execPath, ["--import", "tsx", helper, url, id], {
            cwd: process.cwd(),
          })
        ).stdout.trim(),
      ) as boolean;
    const results = await Promise.all([run("one"), run("two")]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await first.one<{ n: number }>("SELECT COUNT(*) n FROM quota_jobs"))?.n).toBe(1);
    const snap = await readAdminSnapshot(first, "op", "tenant_B");
    expect(snap.sections.find((s) => s.title === "Reservations")?.rows).toEqual([]);
    expect(snap.sections.find((s) => s.title === "Alerts")?.rows).toEqual([]);
  });
});
it("does not admit quota capacity from malformed historical token usage", async () => {
  const db = await fixture();
  await setQuota(db, { reasoning_monthly: 100000 });
  await db.execute(
    `INSERT INTO model_invocations(id,tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,pipeline,stage,attempt,provider,model_id,model_version,model_configuration_fingerprint,request_fingerprint,started_at,input_tokens,output_tokens,total_tokens,status) VALUES('bad-history','tenant_A','person_A','fixture','fixture','fixture','evaluation','decision',1,'bedrock','fixture','1','fixture','fixture',?,-100,1,-99,'completed')`,
    [Date.now()],
  );
  expect(await claim(db)).toBe(false);
  expect((await db.one<{ reason: string }>("SELECT reason FROM quota_deferrals"))?.reason).toBe(
    "LEGACY_USAGE_UNMEASURED",
  );
});
