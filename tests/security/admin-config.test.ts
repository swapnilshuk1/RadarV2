import { validateClaims } from "../../src/dossier/grounding";
import type { ReasoningModel } from "../../src/dossier/contracts";
import type { BenchRow } from "../../src/admin/bench-worker";
import type { EngineConfig, ModelLane } from "../../src/admin/config-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hostname } from "node:os";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";
import {
  baselineConfig,
  engineConfigSchema,
  configMutationSchema,
} from "../../src/admin/config-contracts";
import {
  activeRevision,
  mutateConfig as rawMutateConfig,
  readConfigSnapshot,
  revision,
  BASELINE_REVISION,
  jobConfig,
  pinJobConfig,
  configFingerprint,
} from "../../src/admin/config-store";
import { BenchWorker, benchOutputAllowance, type BenchResult } from "../../src/admin/bench-worker";
import { BENCH_FIXTURE_VERSION, benchFixtures } from "../../src/admin/bench-fixtures";
import { rollupUsage } from "../../src/admin/service";
import { laneModel } from "../../src/admin/model-gateway";
import { SqliteDossierCompositionQueue } from "../../src/data/sqlite/repositories/SqliteDossierCompositionQueue";
const cleanup: SqliteAdapter[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of cleanup.splice(0)) await db.close();
});
async function mutateConfig(
  db: SqliteAdapter,
  user: string,
  input: import("../../src/admin/config-contracts").ConfigMutation extends infer T
    ? T extends unknown
      ? Omit<T, "expectedState"> & { expectedState?: string }
      : never
    : never,
) {
  const snapshot = await readConfigSnapshot(db, "op", input.tenantId);
  return rawMutateConfig(db, user, {
    ...input,
    expectedState: input.expectedState ?? snapshot!.state,
  } as import("../../src/admin/config-contracts").ConfigMutation);
}
async function fixture() {
  // Publication benches must bind to a real, declared deployment identity. The
  // fixture supplies a stable test deployment rather than weakening that rule.
  vi.stubEnv("RADAR_ADMIN_BENCH_TARGET", "test-control-plane");
  vi.stubEnv("RADAR_RELEASE_SHA", "a".repeat(40));
  vi.stubEnv("RADAR_ADMIN_BENCH_HOSTS", hostname());
  const db = new SqliteAdapter(new Database(":memory:"));
  cleanup.push(db);
  await setupLineageTestFixture(db);
  await db.execute(
    "INSERT INTO users(id,email) VALUES('op','op@fixture'),('viewer','viewer@fixture'),('owner','owner@fixture')",
  );
  await db.execute(
    "INSERT INTO platform_roles VALUES('op','operator',0,'fixture','fixture',NULL),('viewer','viewer',0,'fixture','fixture',NULL)",
  );
  return db;
}
const config = () => ({ ...structuredClone(baselineConfig), pursuitInputTokens: 30000 });
async function draft(db: SqliteAdapter, tenantId?: string) {
  return (
    await mutateConfig(db, "op", {
      kind: "draft",
      config: config(),
      tenantId,
      reason: "test configuration",
    })
  ).id;
}
const goodResult = (): BenchResult => ({
  fixtureVersion: BENCH_FIXTURE_VERSION,
  safeToPublish: true,
  verdictsChanged: 0,
  passToPursue: 0,
  invalidOutputs: 0,
  cases: benchFixtures().map((f) => ({
    fixture: f.opportunity.id,
    beforeVerdict: f.opportunity.id === "mandatory-license" ? "PASS" : "CONSIDER",
    afterVerdict: f.opportunity.id === "mandatory-license" ? "PASS" : "CONSIDER",
    beforeViability: f.opportunity.id === "mandatory-license" ? "BLOCKED" : "PLAUSIBLE",
    afterViability: f.opportunity.id === "mandatory-license" ? "BLOCKED" : "PLAUSIBLE",
    sectionsChanged: [],
  })),
});
async function passBench(db: SqliteAdapter, id: string, tenantId?: string) {
  const bench = await mutateConfig(db, "op", {
    kind: "bench",
    revisionId: id,
    tenantId,
    tokenCap: 500000,
    reason: "test fixtures",
  });
  await new BenchWorker(db, async () => goodResult()).pollOnce();
  return bench.id;
}
async function publish(db: SqliteAdapter, id: string, tenantId?: string) {
  await mutateConfig(db, "op", {
    kind: "publish",
    revisionId: id,
    tenantId,
    benchId: await passBench(db, id, tenantId),
    reason: "publish tested config",
  });
}
describe("Phase 3 configuration and bench boundaries", () => {
  it("rejects unknown fields, providers, keys and out-of-range limits", () => {
    for (const bad of [
      { ...config(), apiKey: "secret" },
      { ...config(), reasoning: { ...baselineConfig.reasoning, model: "openrouter" } },
      { ...config(), pursuitInputTokens: 0 },
      { ...config(), writing: { ...baselineConfig.writing, model: "zai.glm-5", concurrency: 99 } },
      { ...config(), reasoning: { ...baselineConfig.reasoning, maxOutputTokens: 4096 } },
    ])
      expect(engineConfigSchema.safeParse(bad).success).toBe(false);
    expect(
      configMutationSchema.safeParse({
        kind: "bench",
        revisionId: "x",
        reason: "test",
        tokenCap: 1000001,
      }).success,
    ).toBe(false);
  });
  it("matches the migration baseline fingerprint and grants no implicit platform role", async () => {
    const db = await fixture();
    expect((await activeRevision(db)).fingerprint).toBe(configFingerprint(baselineConfig));
    await expect(readConfigSnapshot(db, "owner")).rejects.toThrow("PLATFORM_ACCESS_DENIED");
  });
  it("denies every configuration write to viewers and tenant owners", async () => {
    const db = await fixture();
    const id = await draft(db);
    for (const actor of ["viewer", "owner"])
      for (const input of [
        { kind: "draft", config: config() },
        { kind: "discard", revisionId: id },
        { kind: "revert", revisionId: id },
        { kind: "bench", revisionId: id, tokenCap: 500000 },
        { kind: "publish", revisionId: id, benchId: "fake" },
      ])
        await expect(
          mutateConfig(db, actor, { ...input, reason: "test authorization" } as never),
        ).rejects.toThrow("PLATFORM_ACCESS_DENIED");
    expect((await readConfigSnapshot(db, "viewer"))?.draft?.id).toBe(id);
  });
  it("stores immutable revisions and audits draft changes without activating them", async () => {
    const db = await fixture();
    const id = await draft(db);
    expect((await activeRevision(db)).id).toBe(BASELINE_REVISION);
    await expect(
      db.execute("UPDATE config_revisions SET config_json='{}' WHERE id=?", [id]),
    ).rejects.toThrow("CONFIG_REVISION_IMMUTABLE");
    await expect(db.execute("DELETE FROM config_revisions WHERE id=?", [id])).rejects.toThrow(
      "CONFIG_REVISION_IMMUTABLE",
    );
    expect(
      (
        await db.one<{ n: number }>(
          "SELECT COUNT(*) n FROM admin_audit_log WHERE action='config.draft'",
        )
      )?.n,
    ).toBe(1);
  });
  it("blocks publish without a passing bench for the exact draft and active revision", async () => {
    const db = await fixture(),
      id = await draft(db);
    await expect(
      mutateConfig(db, "op", {
        kind: "publish",
        revisionId: id,
        benchId: "fake",
        reason: "attempt publish",
      }),
    ).rejects.toThrow("CONFIG_BENCH_REQUIRED");
    await publish(db, id);
    expect((await activeRevision(db)).id).toBe(id);
  });
  it("rejects stale drafts and a bench belonging to another tenant", async () => {
    const db = await fixture();
    const old = await draft(db),
      bench = await passBench(db, old);
    const current = await draft(db);
    await expect(
      mutateConfig(db, "op", {
        kind: "publish",
        revisionId: old,
        benchId: bench,
        reason: "stale attempt",
      }),
    ).rejects.toThrow("CONFIG_DRAFT_CHANGED");
    await expect(
      mutateConfig(db, "op", {
        kind: "publish",
        revisionId: current,
        benchId: bench,
        reason: "old bench attempt",
      }),
    ).rejects.toThrow("CONFIG_BENCH_REQUIRED");
    const tenant = await draft(db, "tenant_A");
    await expect(
      mutateConfig(db, "op", {
        kind: "publish",
        revisionId: tenant,
        benchId: bench,
        tenantId: "tenant_A",
        reason: "cross scope attempt",
      }),
    ).rejects.toThrow("CONFIG_BENCH_REQUIRED");
  });
  it("inherits platform configuration and isolates tenant overrides", async () => {
    const db = await fixture(),
      platform = await draft(db);
    await publish(db, platform);
    expect((await activeRevision(db, "tenant_B")).id).toBe(platform);
    const tenant = await draft(db, "tenant_A");
    await publish(db, tenant, "tenant_A");
    expect((await activeRevision(db, "tenant_A")).id).toBe(tenant);
    expect((await activeRevision(db, "tenant_B")).id).toBe(platform);
    expect((await readConfigSnapshot(db, "op", "tenant_B"))?.history).toHaveLength(0);
  });
  it("returns a tenant override to its current platform revision through the same bench path", async () => {
    const db = await fixture();
    const platform = await draft(db);
    await publish(db, platform);
    const tenant = await draft(db, "tenant_A");
    await publish(db, tenant, "tenant_A");
    const inherited = await mutateConfig(db, "op", {
      kind: "inherit_platform",
      tenantId: "tenant_A",
      reason: "return to current platform defaults",
    });
    await publish(db, inherited.id, "tenant_A");
    expect((await activeRevision(db, "tenant_A")).id).toBe(platform);
    expect((await revision(db, inherited.id)).inherit_revision_id).toBe(platform);
  });
  it("restores history as a new draft with a new parent and requires another bench", async () => {
    const db = await fixture();
    const id = await draft(db);
    await publish(db, id);
    const reverted = await mutateConfig(db, "op", {
      kind: "revert",
      revisionId: BASELINE_REVISION,
      reason: "restore previous defaults",
    });
    expect(reverted.id).not.toBe(BASELINE_REVISION);
    expect((await revision(db, reverted.id)).parent_id).toBe(id);
    expect((await activeRevision(db)).id).toBe(id);
    await expect(
      mutateConfig(db, "op", {
        kind: "publish",
        revisionId: reverted.id,
        benchId: "fake",
        reason: "missing new bench",
      }),
    ).rejects.toThrow("CONFIG_BENCH_REQUIRED");
  });
  it("pins queued jobs at enqueue and never rebinds them after publish or retry", async () => {
    const db = await fixture();
    const queue = new SqliteDossierCompositionQueue(db);
    const identity = {
      tenantId: "tenant_A",
      personId: "person_A",
      canonicalJobId: "old-job",
      opportunityVersion: "old-version",
      evaluationContextFingerprint: "fingerprint_A",
      profileVersion: "v1",
    };
    const old = await queue.enqueue(identity, "eval-old");
    const id = await draft(db);
    await publish(db, id);
    await pinJobConfig(db, "dossier", old, "tenant_A");
    expect((await jobConfig(db, "dossier", old)).id).toBe(BASELINE_REVISION);
    const fresh = await queue.enqueue({ ...identity, canonicalJobId: "fresh-job" }, "eval-new");
    expect((await jobConfig(db, "dossier", fresh)).id).toBe(id);
    await expect(
      db.execute("UPDATE dossier_composition_jobs SET config_revision_id=? WHERE id=?", [id, old]),
    ).rejects.toThrow("CONFIG_JOB_PIN_IMMUTABLE");
  });
  it("blocks PASS-to-PURSUE even when a runner claims the result is safe", async () => {
    const db = await fixture(),
      id = await draft(db);
    const run = await mutateConfig(db, "op", {
      kind: "bench",
      revisionId: id,
      tokenCap: 500000,
      reason: "risky fixture diff",
    });
    await new BenchWorker(db, async () => {
      const result = goodResult();
      result.cases[0] = { ...result.cases[0], beforeVerdict: "PASS", afterVerdict: "PURSUE" };
      return result;
    }).pollOnce();
    expect(
      (await db.one<{ status: string }>("SELECT status FROM admin_bench_runs WHERE id=?", [run.id]))
        ?.status,
    ).toBe("failed");
    await expect(
      mutateConfig(db, "op", {
        kind: "publish",
        revisionId: id,
        benchId: run.id,
        reason: "blocked unsafe diff",
      }),
    ).rejects.toThrow("CONFIG_BENCH_REQUIRED");
  });
  it("rejects incomplete fixtures and invalid outputs without publishing any opportunity", async () => {
    const db = await fixture(),
      id = await draft(db);
    await mutateConfig(db, "op", {
      kind: "bench",
      revisionId: id,
      tokenCap: 500000,
      reason: "invalid result test",
    });
    await new BenchWorker(db, async () => ({
      ...goodResult(),
      invalidOutputs: 1,
      cases: [],
    })).pollOnce();
    expect((await db.one<{ status: string }>("SELECT status FROM admin_bench_runs"))?.status).toBe(
      "failed",
    );
    expect(
      (await db.one<{ n: number }>("SELECT COUNT(*) n FROM materialized_evaluations"))?.n,
    ).toBe(0);
  });
  it("fences competing bench workers so only one paid run starts", async () => {
    const db = await fixture(),
      id = await draft(db);
    await mutateConfig(db, "op", {
      kind: "bench",
      revisionId: id,
      tokenCap: 500000,
      reason: "race fixture workers",
    });
    let calls = 0;
    const runner = async () => {
      calls++;
      await Promise.resolve();
      return goodResult();
    };
    const outcomes = await Promise.all(
      Array.from({ length: 16 }, () => new BenchWorker(db, runner).pollOnce()),
    );
    expect(calls).toBe(1);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
  });
  it("fails expired benches without a paid automatic retry", async () => {
    const db = await fixture(),
      id = await draft(db);
    const run = await mutateConfig(db, "op", {
      kind: "bench",
      revisionId: id,
      tokenCap: 500000,
      reason: "expiry recovery",
    });
    await db.execute(
      "UPDATE admin_bench_runs SET status='running',lease_token='old',lease_until=0,tokens_reserved=12345 WHERE id=?",
      [run.id],
    );
    const runner = vi.fn(async () => goodResult());
    await new BenchWorker(db, runner).pollOnce();
    expect(runner).not.toHaveBeenCalled();
    expect(
      await db.one("SELECT status,tokens_reserved FROM admin_bench_runs WHERE id=?", [run.id]),
    ).toEqual({ status: "failed", tokens_reserved: 12345 });
  });
  it("revokes a queued bench when its operator loses access", async () => {
    const db = await fixture(),
      id = await draft(db);
    await mutateConfig(db, "op", {
      kind: "bench",
      revisionId: id,
      tokenCap: 500000,
      reason: "revoke before worker",
    });
    await db.execute("UPDATE platform_roles SET revoked_at=1 WHERE user_id='op'");
    const runner = vi.fn(async () => goodResult());
    await new BenchWorker(db, runner).pollOnce();
    expect(runner).not.toHaveBeenCalled();
    expect((await db.one<{ status: string }>("SELECT status FROM admin_bench_runs"))?.status).toBe(
      "failed",
    );
  });
  it("refuses a queued bench when its declared deployment identity changes", async () => {
    const db = await fixture(),
      id = await draft(db);
    await mutateConfig(db, "op", {
      kind: "bench",
      revisionId: id,
      tokenCap: 500000,
      reason: "deployment identity fence",
    });
    vi.stubEnv("RADAR_RELEASE_SHA", "b".repeat(40));
    const runner = vi.fn(async () => goodResult());
    expect(await new BenchWorker(db, runner).pollOnce()).toBeNull();
    expect(runner).not.toHaveBeenCalled();
    expect(await db.one("SELECT error FROM admin_bench_runs")).toEqual({
      error: "BENCH_RELEASE_OR_ENVIRONMENT_CHANGED",
    });
  });
  it("caps actual model request output despite oversized stage metadata and uses no fallback", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: "{}" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200 },
      ),
    );
    const prior = process.env.BEDROCK_MANTLE_API_KEY;
    process.env.BEDROCK_MANTLE_API_KEY = "fixture";
    try {
      const cfg = config();
      cfg.reasoning = {
        model: "zai.glm-5",
        concurrency: 1,
        timeoutMs: 30000,
        maxOutputTokens: 4096,
      };
      const model = laneModel(cfg, "reasoning", () => {
        throw new Error("unexpected fallback");
      });
      await model.generate("Test", {}, undefined, { stage: "decision", maxOutputTokens: 99999 });
      const body = JSON.parse(String(request.mock.calls[0][1]?.body));
      expect(body.max_tokens ?? body.max_completion_tokens).toBe(4096);
    } finally {
      if (prior === undefined) delete process.env.BEDROCK_MANTLE_API_KEY;
      else process.env.BEDROCK_MANTLE_API_KEY = prior;
    }
  });
  it("excludes BENCH usage from tenant rollups while retaining actual invocation evidence", async () => {
    const db = await fixture(),
      id = await draft(db);
    const run = await mutateConfig(db, "op", {
      kind: "bench",
      revisionId: id,
      tokenCap: 500000,
      reason: "bench usage test",
    });
    await db.execute(
      `INSERT INTO model_invocations(id,tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,pipeline,stage,attempt,provider,model_id,model_version,model_configuration_fingerprint,request_fingerprint,started_at,input_tokens,output_tokens,total_tokens,status,purpose,bench_run_id) VALUES('bench','tenant_A','synthetic','fixture','fixture','fixture','evaluation','decision',1,'bedrock-mantle','model','1','config','request',?,10,20,30,'completed','BENCH',?)`,
      [Date.now(), run.id],
    );
    const day = new Date().toISOString().slice(0, 10);
    await rollupUsage(db, day, day);
    expect((await db.one<{ n: number }>("SELECT COUNT(*) n FROM usage_daily"))?.n).toBe(0);
    expect((await db.one<{ n: number }>("SELECT COUNT(*) n FROM model_invocations"))?.n).toBe(1);
  });
  it("rejects duplicate bench requests and skips stale queued revisions before spending", async () => {
    const db = await fixture(),
      id = await draft(db);
    const run = await mutateConfig(db, "op", {
      kind: "bench",
      revisionId: id,
      tokenCap: 500000,
      reason: "one bench at a time",
    });
    await expect(
      mutateConfig(db, "op", {
        kind: "bench",
        revisionId: id,
        tokenCap: 500000,
        reason: "duplicate request",
      }),
    ).rejects.toThrow("BENCH_ALREADY_QUEUED_OR_RUNNING");
    await draft(db);
    const runner = vi.fn(async () => goodResult());
    await new BenchWorker(db, runner).pollOnce();
    expect(runner).not.toHaveBeenCalled();
    expect(
      (await db.one<{ status: string }>("SELECT status FROM admin_bench_runs WHERE id=?", [run.id]))
        ?.status,
    ).toBe("failed");
  });
  it("keeps the paid dispatch behind the bench token cap and a live operator check", async () => {
    const db = await fixture(),
      id = await draft(db);
    const run = await mutateConfig(db, "op", {
      kind: "bench",
      revisionId: id,
      tokenCap: 50000,
      reason: "preflight limit test",
    });
    await db.execute(
      "UPDATE admin_bench_runs SET status='running',lease_token='lease',lease_until=?,tokens_reserved=49999 WHERE id=?",
      [Date.now() + 60000, run.id],
    );
    const row = (await db.one<BenchRow>("SELECT * FROM admin_bench_runs WHERE id=?", [run.id]))!;
    const cfg = config();
    cfg.reasoning = { model: "zai.glm-5", concurrency: 1, timeoutMs: 30000, maxOutputTokens: 4096 };
    const worker = new BenchWorker(db) as unknown as {
      model: (
        row: BenchRow,
        token: string,
        config: EngineConfig,
        lane: ModelLane,
        side: string,
      ) => ReasoningModel;
    };
    const model = worker.model(row, "lease", cfg, "reasoning", "test");
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(model.generate("Test", {})).rejects.toThrow("BENCH_TOKEN_CAP_OR_LEASE_LOST");
    expect(fetch).not.toHaveBeenCalled();
    await db.execute("UPDATE admin_bench_runs SET tokens_reserved=0 WHERE id=?", [run.id]);
    await db.execute("UPDATE platform_roles SET revoked_at=1 WHERE user_id='op'");
    await expect(model.generate("Test", {})).rejects.toThrow("PLATFORM_ACCESS_DENIED");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("validates every synthetic source quote and rejects cross-plane invented evidence", () => {
    for (const f of benchFixtures()) {
      expect(validateClaims(f.evidence, f.sources)).toHaveLength(f.evidence.length);
      const wrong = structuredClone(f.evidence);
      wrong[0].citations[0].quote = "Fabricated source quote";
      expect(() => validateClaims(wrong, f.sources)).toThrow();
    }
  });
  it("fails the real evaluator bench on invalid provider JSON structures and leaves canonical stores empty", async () => {
    const db = await fixture(),
      id = await draft(db);
    const run = await mutateConfig(db, "op", {
      kind: "bench",
      revisionId: id,
      tokenCap: 1000000,
      reason: "real pipeline failure test",
    });
    const prior = process.env.BEDROCK_MANTLE_API_KEY;
    process.env.BEDROCK_MANTLE_API_KEY = "fixture";
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ finish_reason: "stop", message: { content: "{}" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200 },
        ),
    );
    try {
      expect((await new BenchWorker(db).pollOnce())?.status).toBe("failed");
      expect(request).toHaveBeenCalledTimes(3);
      expect(
        (
          await db.one<{ n: number }>(
            "SELECT COUNT(*) n FROM model_invocations WHERE purpose='BENCH' AND bench_run_id=?",
            [run.id],
          )
        )?.n,
      ).toBe(3);
      const receipts = await db.many<{
        evaluation_context_fingerprint: string;
        latency_ms: number;
        max_output_tokens: number;
      }>(
        "SELECT evaluation_context_fingerprint,latency_ms,max_output_tokens FROM model_invocations WHERE bench_run_id=?",
        [run.id],
      );
      expect(
        receipts.every(
          (r) =>
            r.evaluation_context_fingerprint === BASELINE_REVISION &&
            r.latency_ms >= 0 &&
            r.max_output_tokens > 0,
        ),
      ).toBe(true);
      expect((await db.one<{ n: number }>("SELECT COUNT(*) n FROM staged_evaluations"))?.n).toBe(0);
      expect((await activeRevision(db)).id).toBe(BASELINE_REVISION);
    } finally {
      if (prior === undefined) delete process.env.BEDROCK_MANTLE_API_KEY;
      else process.env.BEDROCK_MANTLE_API_KEY = prior;
    }
  });
  it("reserves actual adapter stage ceilings without understating metadata or reviewer output", () => {
    expect(
      benchOutputAllowance({ id: "bedrock-mantle" }, baselineConfig.reasoning, {
        stage: "role-interpretation",
      }),
    ).toBe(6144);
    expect(benchOutputAllowance({ id: "bedrock-mantle" }, baselineConfig.reasoning)).toBe(12288);
    expect(
      benchOutputAllowance({ id: "vertex-gemini" }, baselineConfig.writing, undefined, true),
    ).toBe(16384);
    expect(
      benchOutputAllowance({ id: "vertex-gemini" }, baselineConfig.writing, undefined, false),
    ).toBe(12288);
    expect(
      benchOutputAllowance(
        { id: "bedrock-mantle" },
        { ...baselineConfig.reasoning, model: "deepseek.v3.2", maxOutputTokens: 4096 },
        { stage: "role-interpretation", maxOutputTokens: 99999 },
      ),
    ).toBe(4096);
    expect(
      benchOutputAllowance(
        { id: "bedrock-mantle" },
        { ...baselineConfig.reasoning, model: "deepseek.v3.2", maxOutputTokens: 16384 },
      ),
    ).toBe(16384);
  });
});
import { BedrockMantleJsonModel } from "../../src/lib/model/bedrock-mantle-model";
import { GeminiJsonModel } from "../../src/lib/model/json-model";
import {
  withProviderConcurrency,
  type ModelInvocationSink,
} from "../../src/lib/model/model-invocation";

it("fences completion after operator revocation, lease expiry or a draft replacement", async () => {
  for (const change of ["revoke", "expire", "replace"]) {
    const db = await fixture(),
      id = await draft(db);
    const run = await mutateConfig(db, "op", {
      kind: "bench",
      revisionId: id,
      tokenCap: 500000,
      reason: "completion fencing",
    });
    const worker = new BenchWorker(db, async () => {
      if (change === "revoke")
        await db.execute("UPDATE platform_roles SET revoked_at=1 WHERE user_id='op'");
      if (change === "expire")
        await db.execute("UPDATE admin_bench_runs SET lease_until=0 WHERE id=?", [run.id]);
      if (change === "replace") await draft(db);
      return goodResult();
    });
    expect((await worker.pollOnce())?.status).toBe("failed");
    expect(
      (await db.one<{ status: string }>("SELECT status FROM admin_bench_runs WHERE id=?", [run.id]))
        ?.status,
    ).toBe("failed");
  }
});
it("rejects duplicated fixture results and an admitted mandatory-license contradiction", async () => {
  for (const invalid of ["duplicate", "license"]) {
    const db = await fixture(),
      id = await draft(db);
    await mutateConfig(db, "op", {
      kind: "bench",
      revisionId: id,
      tokenCap: 500000,
      reason: "golden acceptance",
    });
    const result = goodResult();
    if (invalid === "duplicate") result.cases[2] = { ...result.cases[0] };
    else
      result.cases[2] = {
        ...result.cases[2],
        afterVerdict: "CONSIDER",
        afterViability: "PLAUSIBLE",
      };
    expect((await new BenchWorker(db, async () => result).pollOnce())?.status).toBe("failed");
  }
});
it("requires the current fixture version and preserves completed bench evidence", async () => {
  const db = await fixture(),
    id = await draft(db),
    benchId = await passBench(db, id);
  await expect(
    db.execute("UPDATE admin_bench_runs SET result_json='{}' WHERE id=?", [benchId]),
  ).rejects.toThrow("BENCH_EVIDENCE_IMMUTABLE");
  await expect(db.execute("DELETE FROM admin_bench_runs WHERE id=?", [benchId])).rejects.toThrow(
    "BENCH_EVIDENCE_IMMUTABLE",
  );
  // A legacy accepted artifact is seeded directly, as an existing pre-migration row would be.
  const result = goodResult();
  result.fixtureVersion = "executive-fixtures-v1";
  await db.execute(
    "INSERT INTO admin_bench_runs(id,scope,revision_id,active_revision_id,status,token_cap,result_json,created_at,created_by) VALUES('legacy','platform',?,?,'passed',500000,?,0,'op')",
    [id, BASELINE_REVISION, JSON.stringify(result)],
  );
  await expect(
    mutateConfig(db, "op", {
      kind: "publish",
      revisionId: id,
      benchId: "legacy",
      reason: "stale fixture contract",
    }),
  ).rejects.toThrow("CONFIG_BENCH_REQUIRED");
});
it("rechecks both provider preflights after a concurrency wait without logging unmade calls", async () => {
  for (const provider of ["mantle", "gemini"]) {
    const name = `audit-${provider}-${Math.random().toString(36).slice(2)}`,
      key = provider === "mantle" ? name : `vertex-gemini:${name}:us-central1`;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const occupied = withProviderConcurrency(key, 1, () => gate);
    const request = vi.fn();
    const sink = vi.fn(async () => {}) as unknown as ModelInvocationSink;
    let allowed = true;
    sink.beforeCall = vi.fn(async () => {
      if (!allowed) throw new Error("LEASE_REVOKED");
    });
    const model =
      provider === "mantle"
        ? new BedrockMantleJsonModel("fixture", async () => "fixture", request, {
            providerConcurrencyLimit: 1,
            providerConcurrencyKey: key,
            invocationSink: sink,
          })
        : new GeminiJsonModel(name, async () => "fixture", request, {
            providerConcurrencyLimit: 1,
            invocationSink: sink,
          });
    const pending = model.generate("fixture", {});
    const rejected = expect(pending).rejects.toThrow("LEASE_REVOKED");
    expect(sink.beforeCall).not.toHaveBeenCalled();
    allowed = false;
    release();
    await occupied;
    await rejected;
    expect(request).not.toHaveBeenCalled();
    expect(sink).not.toHaveBeenCalled();
  }
});
it("does not let a new arrival steal a handed-off semaphore slot", async () => {
  const key = `handoff-${Math.random()}`;
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let active = 0,
    max = 0;
  const enter = async () => {
    active++;
    max = Math.max(max, active);
    await Promise.resolve();
    active--;
  };
  const first = withProviderConcurrency(key, 1, () => gate);
  const waiting = withProviderConcurrency(key, 1, enter);
  release();
  await first;
  const newcomer = withProviderConcurrency(key, 1, enter);
  await Promise.all([waiting, newcomer]);
  expect(max).toBe(1);
});
it("keeps reasoning and writing lane slots separate while enforcing the host ceiling", async () => {
  const oldKey = process.env.BEDROCK_MANTLE_API_KEY,
    oldLimit = process.env.RADAR_MODEL_PROVIDER_CONCURRENCY;
  process.env.BEDROCK_MANTLE_API_KEY = "fixture";
  process.env.RADAR_MODEL_PROVIDER_CONCURRENCY = "2";
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    await gate;
    return new Response(
      JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{}" } }] }),
    );
  });
  try {
    const cfg = config();
    cfg.reasoning = { model: "zai.glm-5", concurrency: 1, timeoutMs: 30000, maxOutputTokens: 4096 };
    cfg.writing = { ...cfg.reasoning };
    const scope = `audit-lanes-${Math.random()}`;
    const reason = laneModel(
      cfg,
      "reasoning",
      () => {
        throw Error("fallback");
      },
      undefined,
      scope,
    );
    const writer = laneModel(
      cfg,
      "writing",
      () => {
        throw Error("fallback");
      },
      undefined,
      scope,
    );
    const calls = [reason.generate("first", {}), writer.generate("second", {})];
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    calls.push(reason.generate("third", {}));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    release();
    await Promise.all(calls);
    expect(request).toHaveBeenCalledTimes(3);
  } finally {
    release();
    if (oldKey === undefined) delete process.env.BEDROCK_MANTLE_API_KEY;
    else process.env.BEDROCK_MANTLE_API_KEY = oldKey;
    if (oldLimit === undefined) delete process.env.RADAR_MODEL_PROVIDER_CONCURRENCY;
    else process.env.RADAR_MODEL_PROVIDER_CONCURRENCY = oldLimit;
  }
});
it("stops a bench dispatch when its operator is revoked during the provider wait", async () => {
  const db = await fixture(),
    id = await draft(db);
  const run = await mutateConfig(db, "op", {
    kind: "bench",
    revisionId: id,
    tokenCap: 500000,
    reason: "dispatch fencing",
  });
  await db.execute(
    "UPDATE admin_bench_runs SET status='running',lease_token='lease',lease_until=? WHERE id=?",
    [Date.now() + 60000, run.id],
  );
  const row = (await db.one<BenchRow>("SELECT * FROM admin_bench_runs WHERE id=?", [run.id]))!;
  const cfg = config();
  cfg.reasoning = { model: "zai.glm-5", concurrency: 1, timeoutMs: 30000, maxOutputTokens: 4096 };
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const blocker = withProviderConcurrency("radar-lane:bench:platform:reasoning", 1, () => gate);
  const request = vi.spyOn(globalThis, "fetch");
  const worker = new BenchWorker(db) as unknown as {
    model: (
      row: BenchRow,
      token: string,
      cfg: EngineConfig,
      lane: ModelLane,
      side: string,
    ) => ReasoningModel;
  };
  const pending = worker.model(row, "lease", cfg, "reasoning", "draft").generate("fixture", {});
  const rejected = expect(pending).rejects.toThrow("PLATFORM_ACCESS_DENIED");
  await vi.waitFor(async () =>
    expect(
      (
        await db.one<{ n: number }>("SELECT tokens_reserved n FROM admin_bench_runs WHERE id=?", [
          run.id,
        ])
      )?.n,
    ).toBeGreaterThan(0),
  );
  await db.execute("UPDATE platform_roles SET revoked_at=1 WHERE user_id='op'");
  release();
  await blocker;
  await rejected;
  expect(request).not.toHaveBeenCalled();
});

it("blocks generic PASS-to-CONSIDER and screening relaxations", async () => {
  for (const change of ["verdict", "screening"]) {
    const db = await fixture(),
      id = await draft(db);
    await mutateConfig(db, "op", {
      kind: "bench",
      revisionId: id,
      tokenCap: 500000,
      reason: "generic regression",
    });
    const result = goodResult();
    result.cases[1] = {
      ...result.cases[1],
      ...(change === "verdict"
        ? { beforeVerdict: "PASS", afterVerdict: "CONSIDER" }
        : { beforeViability: "BLOCKED", afterViability: "PLAUSIBLE" }),
    };
    expect((await new BenchWorker(db, async () => result).pollOnce())?.status).toBe("failed");
  }
});
it("rejects stale editor state instead of overwriting the newer draft", async () => {
  const db = await fixture(),
    old = (await readConfigSnapshot(db, "op"))!;
  const id = await draft(db);
  await expect(
    mutateConfig(db, "op", {
      kind: "draft",
      config: config(),
      reason: "stale editor",
      expectedState: old.state,
    }),
  ).rejects.toThrow("ADMIN_STATE_CHANGED");
  expect((await readConfigSnapshot(db, "op"))?.draft?.id).toBe(id);
});
it("allows scoped operator cancellation and fences completion after cancellation", async () => {
  const db = await fixture(),
    id = await draft(db);
  const run = await mutateConfig(db, "op", {
    kind: "bench",
    revisionId: id,
    tokenCap: 500000,
    reason: "cancel recovery",
  });
  await expect(
    mutateConfig(db, "op", {
      kind: "cancel_bench",
      benchId: run.id,
      tenantId: "tenant_A",
      reason: "wrong scope",
    }),
  ).rejects.toThrow("BENCH_NOT_LIVE_IN_SCOPE");
  await new BenchWorker(db, async () => {
    await mutateConfig(db, "op", {
      kind: "cancel_bench",
      benchId: run.id,
      reason: "stop this bench",
    });
    return goodResult();
  }).pollOnce();
  expect(await db.one("SELECT status,error FROM admin_bench_runs WHERE id=?", [run.id])).toEqual({
    status: "failed",
    error: "BENCH_OPERATOR_CANCELLED",
  });
  expect(
    (
      await mutateConfig(db, "op", {
        kind: "bench",
        revisionId: id,
        tokenCap: 500000,
        reason: "new explicit test",
      })
    ).id,
  ).not.toBe(run.id);
});
