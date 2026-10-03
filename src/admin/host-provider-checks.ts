import { randomUUID } from "node:crypto";
import type { DatabaseAdapter } from "../data/database/adapter";
import { requirePlatformRole } from "./service";
import { loadMantleCredentials } from "../lib/model/bedrock-credentials";
import { adcTokenProvider } from "../lib/model/google-adc";
import { BedrockMantleJsonModel } from "../lib/model/bedrock-mantle-model";
import { GeminiJsonModel } from "../lib/model/json-model";
import { activeRevision } from "./config-store";
import { engineConfigSchema } from "./config-contracts";
import { confirmProviderRecovery, observeProviderFailure } from "./operations-runtime";

const canarySchema = {
  type: "object",
  properties: { canary: { type: "string", enum: ["RADAR"] } },
  required: ["canary"],
  additionalProperties: false,
};
const HOST_PROVIDER_CANARY_TIMEOUT_MS = 45_000;

async function runConfiguredModelCanary(
  db: DatabaseAdapter,
  provider: "bedrock" | "google",
  request: typeof fetch,
  token: () => Promise<string>,
  databaseFingerprint: string,
  deadlineAt: number,
) {
  const input = { operation: "RADAR_OPERATIONS_HEALTH_CHECK", expected: "RADAR" };
  const metadata = { stage: "operations-canary", maxOutputTokens: 64 };
  if (provider === "google") {
    const projectId = process.env.GCP_PROJECT_ID?.trim();
    if (!projectId) throw new Error("ADC_PROJECT_UNCONFIGURED");
    const modelVersion = process.env.RADAR_FACTUAL_REVIEW_MODEL?.trim() || "gemini-3.8-flash";
    const timeoutMs = Math.min(20_000, deadlineAt - Date.now());
    if (timeoutMs <= 0) throw new Error("HOST_PROBE_TIMEOUT");
    const model = new GeminiJsonModel(projectId, token, request, {
      model: modelVersion,
      location: "global",
      schemaFormat: "json-schema",
      thinkingLevel: "LOW",
      maxOutputTokens: 64,
      timeoutMs,
    });
    const output = await model.generate(
      "Return the requested canary value as JSON.",
      input,
      canarySchema,
      metadata,
    );
    if ((output as { canary?: unknown } | null)?.canary !== "RADAR")
      throw new Error("MODEL_CANARY_OUTPUT_INVALID");
    return { model: modelVersion };
  }

  loadMantleCredentials();
  const apiKey = process.env.BEDROCK_MANTLE_API_KEY?.trim();
  if (!apiKey) throw new Error("BEDROCK_CREDENTIAL_UNAVAILABLE");
  const activeConfigs = await db.many<{ config_json: string }>(
    "SELECT r.config_json FROM config_active_pointers p JOIN config_revisions r ON r.id=p.revision_id",
  );
  const models = new Set<string>();
  const configs = activeConfigs.length
    ? activeConfigs.map((row) => engineConfigSchema.parse(JSON.parse(row.config_json)))
    : [(await activeRevision(db)).config];
  for (const config of configs) {
    for (const lane of [config.reasoning, config.writing])
      models.add(lane.model === "legacy" ? "zai.glm-5" : lane.model);
  }
  const loadedModels = await db.many<{ model: string | null }>(
    `SELECT DISTINCT COALESCE(json_extract(effective_settings_json,'$.model'),json_extract(effective_settings_json,'$.modelVersion'),json_extract(effective_settings_json,'$.modelId')) AS model FROM worker_runtime_receipts
      WHERE connection_id='bedrock:host' AND reload_status='loaded'
      AND release_sha=? AND database_fingerprint=? AND last_seen_at>?`,
    [process.env.RADAR_RELEASE_SHA ?? "development", databaseFingerprint, Date.now() - 150_000],
  );
  for (const row of loadedModels) if (row.model) models.add(row.model);
  if (!models.size) throw new Error("BEDROCK_MODEL_UNCONFIGURED");

  const supported = new Set(["zai.glm-5", "deepseek.v3.2"]);
  const ordered = [...models].sort();
  for (const modelVersion of ordered) {
    if (!supported.has(modelVersion)) throw new Error("BEDROCK_MODEL_UNSUPPORTED");
    const timeoutMs = Math.min(20_000, deadlineAt - Date.now());
    if (timeoutMs <= 0) throw new Error("BEDROCK_CANARY_DEADLINE");
    const model = new BedrockMantleJsonModel(modelVersion, async () => apiKey, request, {
      region: "us-east-1",
      timeoutMs,
      maxOutputTokens: 64,
      stageOutputTokens: { "operations-canary": 64 },
    });
    const output = await model.generate(
      "Return the requested canary value as JSON.",
      input,
      canarySchema,
      metadata,
    );
    if ((output as { canary?: unknown } | null)?.canary !== "RADAR")
      throw new Error("MODEL_CANARY_OUTPUT_INVALID");
  }
  return { model: ordered.join(",") };
}

function providerFailure(error: unknown): {
  failure: "credential" | "throttled" | "provider_outage" | "transport" | "timeout";
  status?: number;
} {
  const status = Number((error as { httpStatus?: unknown } | null)?.httpStatus) || undefined;
  const message = error instanceof Error ? error.message : String(error ?? "");
  const credentialFailure =
    status === 401 ||
    status === 403 ||
    /adc|credential|authentication|unauthori[sz]ed|permission denied/i.test(message);
  return {
    failure: /HOST_PROBE_TIMEOUT|TimeoutError|AbortError/i.test(message)
      ? "timeout"
      : credentialFailure
        ? "credential"
        : status === 429
          ? "throttled"
          : status && status >= 500
            ? "provider_outage"
            : "transport",
    status,
  };
}

export async function pollHostProviderCheck(
  db: DatabaseAdapter,
  worker: { name: string; instance: string; database: string },
  request: typeof fetch = fetch,
  token = adcTokenProvider(),
  canaryTimeoutMs = HOST_PROVIDER_CANARY_TIMEOUT_MS,
) {
  const provider =
    worker.name === "dossier-review" ? "google" : worker.name === "evaluation" ? "bedrock" : null;
  if (!provider) return null;
  const now = Date.now(),
    lease = randomUUID();
  const check = await db.transaction(async (tx) => {
    await tx.execute(
      "UPDATE provider_host_checks SET status='failed',error_code='CHECK_LEASE_EXPIRED',completed_at=? WHERE status='running' AND lease_until<=?",
      [now, now],
    );
    const row = await tx.one<{ id: string; created_by: string }>(
      "SELECT id,created_by FROM provider_host_checks WHERE provider=? AND status='queued' ORDER BY created_at LIMIT 1",
      [provider],
    );
    if (!row) return null;
    const claimed = await tx.execute(
      "UPDATE provider_host_checks SET status='running',lease_token=?,lease_until=?,worker_name=?,worker_instance=?,release_sha=?,database_fingerprint=? WHERE id=? AND status='queued'",
      [
        lease,
        now + 60000,
        worker.name,
        worker.instance,
        process.env.RADAR_RELEASE_SHA ?? "development",
        worker.database,
        row.id,
      ],
    );
    return claimed.rowsAffected ? row : null;
  });
  if (!check) return null;
  let error: string | null = null;
  const details: Record<string, string> = { mode: "host-managed", permission: "unverified" };
  const connectionId = `${provider}:host`;
  let probeStartedAt: number | undefined;
  try {
    await requirePlatformRole(db, check.created_by, true);
    const priorFailure = await db.one<{ last_seen: number | null }>(
      "SELECT MAX(last_seen) AS last_seen FROM provider_incidents WHERE connection_id=? AND state!='resolved'",
      [connectionId],
    );
    const lastSeen = priorFailure?.last_seen ?? 0;
    while (Date.now() <= lastSeen) await new Promise((resolve) => setTimeout(resolve, 1));
    probeStartedAt = Date.now();
    const controller = new AbortController();
    const deadlineAt =
      Date.now() + Math.max(1, Math.min(canaryTimeoutMs, HOST_PROVIDER_CANARY_TIMEOUT_MS));
    const timer = setTimeout(
      () => controller.abort(new Error("HOST_PROBE_TIMEOUT")),
      deadlineAt - Date.now(),
    );
    const boundedRequest: typeof fetch = (input, init) => {
      if (controller.signal.aborted) return Promise.reject(controller.signal.reason);
      const signal = init?.signal
        ? AbortSignal.any([init.signal, controller.signal])
        : controller.signal;
      return request(input, { ...init, signal });
    };
    const timedOut = new Promise<never>((_resolve, reject) => {
      if (controller.signal.aborted) reject(controller.signal.reason);
      else
        controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
          once: true,
        });
    });
    let canary: { model: string };
    try {
      canary = await Promise.race([
        runConfiguredModelCanary(db, provider, boundedRequest, token, worker.database, deadlineAt),
        timedOut,
      ]);
    } finally {
      clearTimeout(timer);
    }
    details.authentication = "passed";
    details.permission = "configured model invocation passed";
    details.model = canary.model;
    details.project =
      provider === "google" ? (process.env.GCP_PROJECT_ID ?? "unconfigured") : "not applicable";
  } catch (caught) {
    const failure = providerFailure(caught);
    error =
      caught instanceof Error && caught.message === "ADC_PROJECT_UNCONFIGURED"
        ? "ADC_PROJECT_UNCONFIGURED"
        : `${provider.toUpperCase()}_MODEL_CANARY_FAILED${failure.status ? `_HTTP_${failure.status}` : ""}`;
    await observeProviderFailure(db, {
      connectionId,
      provider: provider === "google" ? "vertex-gemini" : "bedrock-mantle",
      generation: 0,
      failure: failure.failure,
      status: failure.status,
      deployment: worker.database,
    });
  }
  const completed = Date.now();
  const updated = await db.execute(
    "UPDATE provider_host_checks SET status=?,error_code=?,details_json=?,completed_at=?,lease_until=NULL WHERE id=? AND status='running' AND lease_token=? AND lease_until>?",
    [
      error ? "failed" : "passed",
      error,
      JSON.stringify(details),
      Date.now(),
      check.id,
      lease,
      completed,
    ],
  );
  if (!error && updated.rowsAffected) {
    if (probeStartedAt !== undefined)
      await confirmProviderRecovery(db, connectionId, 0, probeStartedAt);
  }
  return {
    id: check.id,
    status: updated.rowsAffected ? (error ? "failed" : "passed") : "lease_lost",
  };
}
