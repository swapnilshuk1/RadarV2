import { migratedFixtureDatabase } from "../persistence/migrated-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { getDatabaseTargetIdentity } from "../../src/data/database";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";
import {
  observeProviderFailure,
  providerSucceeded,
  writeRuntimeReceipt,
} from "../../src/admin/operations-runtime";
import { pollHostProviderCheck } from "../../src/admin/host-provider-checks";
import { reconcileProviderIncidents } from "../../src/admin/operations-recovery";

const adapters: SqliteAdapter[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const db of adapters.splice(0)) await db.close();
});

async function fixture() {
  const db = await migratedFixtureDatabase();
  adapters.push(db);
  await setupLineageTestFixture(db);
  await db.execute("INSERT INTO users(id,email) VALUES('operator','operator@fixture')");
  await db.execute(
    "INSERT INTO platform_roles VALUES('operator','operator',0,'fixture','fixture',NULL)",
  );
  return db;
}

async function seedIncident(db: SqliteAdapter, provider: "bedrock" | "google") {
  const connectionId = `${provider}:host`;
  const work = {
    pipeline: "dossier" as const,
    jobId: `completed-${provider}`,
    tenantId: "tenant_A",
    personId: "person_A",
    canonicalJobId: "canonical-job",
    opportunityVersion: "version-1",
    contextFingerprint: "context-1",
  };
  await db.execute(
    "INSERT INTO dossier_composition_jobs(id,tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,evaluation_fingerprint,profile_version,recipe,status,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'profile-1','recipe-1','completed',?,?,?)",
    [
      work.jobId,
      work.tenantId,
      work.personId,
      work.canonicalJobId,
      work.opportunityVersion,
      work.contextFingerprint,
      "evaluation-1",
      Date.now(),
      Date.now(),
      Date.now(),
    ],
  );
  const incidentId = await observeProviderFailure(db, {
    connectionId,
    provider: provider === "google" ? "vertex-gemini" : "bedrock-mantle",
    generation: 0,
    failure: "credential",
    deployment: getDatabaseTargetIdentity().fingerprint,
    work,
  });
  await db.execute(
    "INSERT INTO provider_host_checks(id,provider,status,created_at,created_by) VALUES(?,?,'queued',?,'operator')",
    [`probe-${provider}`, provider, Date.now()],
  );
  return { incidentId: incidentId!, work };
}

describe("host-managed provider recovery", () => {
  it.each([
    ["bedrock", "evaluation", "bedrock-mantle.us-east-1.api.aws", "deepseek.v3.2,zai.glm-5"],
    ["google", "dossier-review", "aiplatform.googleapis.com", "gemini-3.8-flash"],
  ] as const)(
    "%s recovery probes the configured model, clears only its matching hold, and reconciles exact completed work",
    async (provider, workerName, endpoint, expectedModel) => {
      const db = await fixture();
      vi.stubEnv("RADAR_RELEASE_SHA", "release-under-test");
      vi.stubEnv("GCP_PROJECT_ID", "fixture-project");
      vi.stubEnv("BEDROCK_MANTLE_API_KEY", "fixture-bedrock-key");
      if (provider === "bedrock") {
        const config = JSON.stringify({
          reasoning: { model: "legacy", concurrency: 4, timeoutMs: 120000, maxOutputTokens: 16384 },
          writing: {
            model: "deepseek.v3.2",
            concurrency: 2,
            timeoutMs: 120000,
            maxOutputTokens: 16384,
          },
          pursuitInputTokens: 20000,
          pursuitOutputTokens: 5000,
        });
        await db.execute(
          "INSERT INTO config_revisions(id,scope,parent_id,config_json,fingerprint,created_at,created_by) VALUES('canary-active','platform','engine-baseline-v1',?,'fixture',?,'operator')",
          [config, Date.now()],
        );
        await db.execute(
          "UPDATE config_active_pointers SET revision_id='canary-active' WHERE scope='platform'",
        );
      }
      const { incidentId, work } = await seedIncident(db, provider);
      const requests: Array<{ url: string; body: Record<string, any> }> = [];
      const request: typeof fetch = async (input, init) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body)) as Record<string, any>;
        requests.push({ url, body });
        return provider === "google"
          ? Response.json({
              candidates: [
                { finishReason: "STOP", content: { parts: [{ text: '{"canary":"RADAR"}' }] } },
              ],
            })
          : Response.json({
              choices: [{ finish_reason: "stop", message: { content: '{"canary":"RADAR"}' } }],
            });
      };
      const token = async () => "fixture-adc-token";
      const result = await pollHostProviderCheck(
        db,
        {
          name: workerName,
          instance: `instance-${provider}`,
          database: getDatabaseTargetIdentity().fingerprint,
        },
        request,
        token,
      );

      expect(result).toEqual({ id: `probe-${provider}`, status: "passed" });
      expect(requests).toHaveLength(provider === "bedrock" ? 2 : 1);
      expect(requests.every((call) => call.url.includes(endpoint))).toBe(true);
      if (provider === "bedrock") {
        expect(
          requests
            .map((call) => call.body.model)
            .sort()
            .join(","),
        ).toBe(expectedModel);
      } else {
        expect(requests[0].url).toContain(expectedModel);
      }
      expect(
        requests.every((call) =>
          (
            call.body.messages?.[1]?.content ??
            call.body.contents?.[0]?.parts?.[0]?.text ??
            ""
          ).includes("RADAR_OPERATIONS_HEALTH_CHECK"),
        ),
      ).toBe(true);
      expect(
        await db.one("SELECT requires_action FROM provider_cooldowns WHERE connection_id=?", [
          `${provider}:host`,
        ]),
      ).toEqual({ requires_action: 0 });
      expect(await db.one("SELECT state FROM provider_incidents WHERE id=?", [incidentId])).toEqual(
        { state: "recovering" },
      );

      await reconcileProviderIncidents(db);
      expect(await db.one("SELECT state FROM provider_incidents WHERE id=?", [incidentId])).toEqual(
        { state: "resolved" },
      );
      expect(
        await db.one("SELECT accounted_reason FROM provider_incident_jobs WHERE incident_id=?", [
          incidentId,
        ]),
      ).toEqual({ accounted_reason: "COMPLETED" });
      expect(
        await db.one("SELECT job_id FROM provider_incident_jobs WHERE incident_id=?", [incidentId]),
      ).toEqual({ job_id: work.jobId });
    },
  );

  it("does not clear a host action hold when the configured model rejects the canary", async () => {
    const db = await fixture();
    vi.stubEnv("BEDROCK_MANTLE_API_KEY", "fixture-bedrock-key");
    const { incidentId } = await seedIncident(db, "bedrock");
    const result = await pollHostProviderCheck(
      db,
      {
        name: "evaluation",
        instance: "evaluation-1",
        database: getDatabaseTargetIdentity().fingerprint,
      },
      async () => new Response("", { status: 403 }),
    );
    expect(result).toMatchObject({ status: "failed" });
    expect(
      await db.one(
        "SELECT requires_action FROM provider_cooldowns WHERE connection_id='bedrock:host'",
      ),
    ).toEqual({ requires_action: 1 });
    expect(await db.one("SELECT state FROM provider_incidents WHERE id=?", [incidentId])).toEqual({
      state: "open",
    });
  });

  it("bounds the whole model canary and rejects a fetch that ignores the adapter timeout", async () => {
    const db = await fixture();
    vi.stubEnv("BEDROCK_MANTLE_API_KEY", "fixture-bedrock-key");
    await seedIncident(db, "bedrock");
    const started = Date.now();
    const result = await pollHostProviderCheck(
      db,
      {
        name: "evaluation",
        instance: "evaluation-timeout",
        database: getDatabaseTargetIdentity().fingerprint,
      },
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
      undefined,
      30,
    );
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result).toMatchObject({ status: "failed" });
    expect(
      await db.one("SELECT status,error_code FROM provider_host_checks WHERE id='probe-bedrock'"),
    ).toMatchObject({ status: "failed", error_code: "BEDROCK_MODEL_CANARY_FAILED" });
  });

  it("reconciles a transient host incident after a later same-release production success", async () => {
    const db = await fixture();
    vi.stubEnv("RADAR_RELEASE_SHA", "release-under-test");
    const failureAt = Date.now() - 100;
    const incidentId = await observeProviderFailure(
      db,
      {
        connectionId: "bedrock:host",
        provider: "bedrock-mantle",
        generation: 0,
        failure: "throttled",
        deployment: getDatabaseTargetIdentity().fingerprint,
      },
      failureAt,
    );
    const requestStartedAt = Date.now() - 10;
    await writeRuntimeReceipt(db, {
      workerName: "evaluation",
      instanceId: "evaluation-current",
      runtimeRole: "single-host",
      releaseSha: "release-under-test",
      databaseFingerprint: getDatabaseTargetIdentity().fingerprint,
      configRevision: "engine-baseline-v1",
      connectionId: "bedrock:host",
      generation: 0,
      credentialVersion: null,
      credentialSource: "host",
      reloadMode: "restart",
      reloadStatus: "loaded",
      errorCode: null,
      startedAt: requestStartedAt,
      loadedAt: requestStartedAt,
      lastSeenAt: requestStartedAt,
      effectiveSettings: { model: "zai.glm-5" },
    });
    await providerSucceeded(db, "bedrock:host", 0, requestStartedAt);
    await reconcileProviderIncidents(db);
    expect(await db.one("SELECT state FROM provider_incidents WHERE id=?", [incidentId])).toEqual({
      state: "resolved",
    });
  });
});
