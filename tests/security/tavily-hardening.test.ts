import { migratedFixtureDatabase } from "../persistence/migrated-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";
import {
  mutateSearchConnection,
  pollSearchConnectionCheck,
  registerConnectionWorker,
  resolveSearchCredential,
  readSearchConnection,
  refreshSearchWorkerReceipt,
} from "../../src/admin/search-connections";
import {
  observeProviderFailure,
  assertProviderDispatch,
  confirmProviderRecovery,
  providerSucceeded,
} from "../../src/admin/operations-runtime";
import { probeTavilyCapability } from "../../src/evaluation/tavily-request";
import { reconcileProviderIncidents } from "../../src/admin/operations-recovery";
const adapters: SqliteAdapter[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const db of adapters.splice(0)) await db.close();
});
const usable = async () =>
  new Response(
    JSON.stringify({
      results: [{ url: "https://oracle.com", raw_content: "Official company information." }],
    }),
  );
async function fixture() {
  vi.stubEnv("TAVILY_API_KEY", "host-key-fixture-0000000000");
  const db = await migratedFixtureDatabase();
  adapters.push(db);
  await setupLineageTestFixture(db);
  await db.execute("INSERT INTO users(id,email) VALUES('op','op@example.test')");
  await db.execute("INSERT INTO platform_roles VALUES('op','operator',0,'fixture','fixture',NULL)");
  await db.execute(
    "INSERT INTO worker_heartbeats VALUES('evaluation','worker','development','fixture-db',?)",
    [new Date().toISOString()],
  );
  registerConnectionWorker("evaluation", "worker", "fixture-db");
  return db;
}
async function activate(db: SqliteAdapter) {
  const candidate = await mutateSearchConnection(db, "op", {
    kind: "candidate",
    key: "provider-owned-format-000000000",
    expectedRevision: 0,
    reason: "initial cutover",
  });
  await mutateSearchConnection(db, "op", {
    kind: "test",
    credentialId: candidate.credentialId!,
    expectedRevision: 1,
    reason: "capability test",
  });
  await pollSearchConnectionCheck(db, usable);
  await mutateSearchConnection(db, "op", {
    kind: "activate",
    credentialId: candidate.credentialId!,
    expectedRevision: 1,
    reason: "validated cutover",
  });
  return candidate.credentialId;
}
describe("Tavily failure-complete source recovery", () => {
  it("does not turn a failed candidate validation into an active-provider incident", async () => {
    const db = await fixture();
    const candidate = await mutateSearchConnection(db, "op", {
      kind: "candidate",
      key: "candidate-key-fixture-000000000",
      expectedRevision: 0,
      reason: "test replacement",
    });
    await mutateSearchConnection(db, "op", {
      kind: "test",
      credentialId: candidate.credentialId!,
      expectedRevision: 1,
      reason: "validate candidate",
    });
    expect(
      await pollSearchConnectionCheck(db, async () => new Response("", { status: 401 })),
    ).toMatchObject({ status: "failed" });
    expect(await db.many("SELECT id FROM provider_incidents")).toEqual([]);
    await expect(assertProviderDispatch(db, "tavily:platform")).resolves.toBeUndefined();
  });

  it.each(["generation", "lease"] as const)(
    "does not create an incident for a superseded confirmation %s",
    async (fence) => {
      const db = await fixture();
      await activate(db);
      const result = await pollSearchConnectionCheck(db, async () => {
        if (fence === "generation")
          await db.execute("UPDATE admin_search_connection SET generation=generation+1");
        else
          await db.execute(
            "UPDATE admin_search_checks SET lease_token='replacement' WHERE status='running'",
          );
        return new Response("", { status: 401 });
      });
      expect(result).toMatchObject({ status: fence === "lease" ? "lease_lost" : "failed" });
      expect(await db.many("SELECT id FROM provider_incidents")).toEqual([]);
    },
  );
  it("does not let an older successful request clear a newer transient failure", async () => {
    const db = await fixture();
    const started = Date.now() - 100;
    await observeProviderFailure(
      db,
      {
        connectionId: "bedrock:host",
        provider: "bedrock",
        generation: 0,
        failure: "provider_outage",
        deployment: "fixture-db",
      },
      started + 10,
    );
    await providerSucceeded(db, "bedrock:host", 0, started);
    await expect(assertProviderDispatch(db, "bedrock:host")).rejects.toThrow("PROVIDER_COOLDOWN");
  });
  it("holds first activation until active generation canary and rolls back to freshly tested host source", async () => {
    const db = await fixture();
    const managed = await activate(db);
    await expect(assertProviderDispatch(db, "tavily:platform")).rejects.toThrow(
      "PROVIDER_COOLDOWN",
    );
    expect((await readSearchConnection(db, "op")).previousSource).toBe("host");
    await pollSearchConnectionCheck(db, usable);
    await expect(assertProviderDispatch(db, "tavily:platform")).resolves.toBeUndefined();
    await expect(
      mutateSearchConnection(db, "op", {
        kind: "rollback",
        expectedRevision: 2,
        reason: "host rollback",
      }),
    ).rejects.toThrow("CURRENT_WORKER_CONNECTION_TEST_REQUIRED");
    await mutateSearchConnection(db, "op", {
      kind: "test_host",
      expectedRevision: 2,
      reason: "validate host rollback",
    });
    await pollSearchConnectionCheck(db, usable);
    await mutateSearchConnection(db, "op", {
      kind: "rollback",
      expectedRevision: 2,
      reason: "validated host rollback",
    });
    expect(await resolveSearchCredential(db)).toMatchObject({
      key: "host-key-fixture-0000000000",
      credentialId: null,
      generation: 2,
    });
    expect(await readSearchConnection(db, "op")).toMatchObject({
      previousSource: "managed",
      previousId: managed,
    });
    await expect(assertProviderDispatch(db, "tavily:platform")).rejects.toThrow(
      "PROVIDER_COOLDOWN",
    );
    await pollSearchConnectionCheck(db, usable);
    await expect(assertProviderDispatch(db, "tavily:platform")).resolves.toBeUndefined();
  });
  it("recovers the same active host key after quota repair without rotating credentials", async () => {
    const db = await fixture();
    const incident = await observeProviderFailure(
      db,
      {
        connectionId: "tavily:platform",
        provider: "tavily",
        generation: 0,
        failure: "quota_exhausted",
        deployment: "fixture-db",
      },
      Date.now() - 100,
    );
    await mutateSearchConnection(db, "op", {
      kind: "confirm_recovered",
      expectedRevision: 0,
      reason: "account topped up",
    });
    await pollSearchConnectionCheck(db, usable);
    await refreshSearchWorkerReceipt(db);
    await expect(assertProviderDispatch(db, "tavily:platform")).resolves.toBeUndefined();
    await reconcileProviderIncidents(db);
    expect(await db.one("SELECT state FROM provider_incidents WHERE id=?", [incident!])).toEqual({
      state: "resolved",
    });
  });
  it("rejects a superficially authenticated response without production raw content", async () => {
    const calls = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ results: [{ url: "https://oracle.com", content: "only summary" }] }),
        ),
    );
    await expect(probeTavilyCapability("key", calls)).rejects.toThrow(
      "SEARCH_CAPABILITY_RESPONSE_INVALID",
    );
    const body = JSON.parse(calls.mock.calls[0]![1]!.body as string);
    expect(body).toMatchObject({
      search_depth: "advanced",
      max_results: 1,
      include_raw_content: "text",
    });
  });
  it("does not release an action hold when a new failure arrives during its canary", async () => {
    const db = await fixture();
    const started = Date.now() - 100;
    await observeProviderFailure(
      db,
      {
        connectionId: "tavily:platform",
        provider: "tavily",
        generation: 0,
        failure: "credential",
        deployment: "fixture-db",
      },
      started + 10,
    );
    expect(await confirmProviderRecovery(db, "tavily:platform", 0, started)).toBe(false);
    await expect(assertProviderDispatch(db, "tavily:platform")).rejects.toThrow(
      "PROVIDER_COOLDOWN",
    );
  });
  it("links cooldown-blocked work to the owning credential incident rather than latest transient episode", async () => {
    const db = await fixture();
    const owner = await observeProviderFailure(
      db,
      {
        connectionId: "tavily:platform",
        provider: "tavily",
        generation: 0,
        failure: "credential",
        deployment: "fixture-db",
      },
      100,
    );
    await observeProviderFailure(
      db,
      {
        connectionId: "tavily:platform",
        provider: "tavily",
        generation: 0,
        failure: "provider_outage",
        deployment: "fixture-db",
      },
      200,
    );
    await expect(
      assertProviderDispatch(
        db,
        "tavily:platform",
        {
          pipeline: "evaluation",
          jobId: "job-fixture",
          tenantId: "tenant_A",
          personId: "person_A",
          canonicalJobId: "job",
          opportunityVersion: "version",
          contextFingerprint: "fingerprint_A",
        },
        300,
      ),
    ).rejects.toThrow("PROVIDER_COOLDOWN");
    expect(
      await db.one("SELECT incident_id FROM provider_incident_jobs WHERE job_id='job-fixture'"),
    ).toEqual({ incident_id: owner });
    expect(
      await db.one(
        "SELECT release_sha,database_fingerprint FROM provider_incident_observations WHERE incident_id=?",
        [owner!],
      ),
    ).toEqual({ release_sha: "development", database_fingerprint: "fixture-db" });
  });
});
