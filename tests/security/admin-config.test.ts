import { validateClaims } from "../../src/dossier/grounding";
import type { ReasoningModel } from "../../src/dossier/contracts";
import type { BenchRow } from "../../src/admin/bench-worker";
import type { EngineConfig, ModelLane } from "../../src/admin/config-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  mutateConfig,
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
async function fixture() {
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
    beforeVerdict: "CONSIDER",
    afterVerdict: "CONSIDER",
    beforeViability: "PLAUSIBLE",
    afterViability: "PLAUSIBLE",
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
