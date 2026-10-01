/**
 * Explicit scraper-worker entrypoint. The web process only creates queued,
 * tenant/person-owned scrape runs; this process is the sole Playwright owner.
 */
import { randomUUID } from "node:crypto";
import { getRepositories } from "../src/data/sqlite/provider";
import { getDatabaseAdapter } from "../src/data/database";
import { startRun } from "./scrape";
import type { PortalName } from "./scraper/types";
import { startWorkerHeartbeat } from "../src/lib/health/worker-heartbeat";
import { assertAcquisitionHost } from "../src/acquisition/execution-role";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ARTIFACTS_DIR } from "./scraper/config";
import { getBlobStore } from "../src/lib/storage/blob-store";
import { runAcquisitionRetention } from "../src/acquisition/retention";

const WORKER_ID = `scrape-worker-${process.pid}-${randomUUID()}`;
const LEASE_MS = 120_000;
const HEARTBEAT_MS = 30_000;

let stopping = false;
process.once("SIGTERM", () => { stopping = true; });
process.once("SIGINT", () => { stopping = true; });

async function claimAndRun(): Promise<boolean> {
  const repos = getRepositories();
  const claimedRun = await repos.scrapeRuns.claimNextForWorker(WORKER_ID, LEASE_MS);
  if (!claimedRun) return false;
  if (!claimedRun.leaseToken) throw new Error("SCRAPE_WORKER_LEASE_TOKEN_MISSING");

  const leaseToken = claimedRun.leaseToken;
  const scope = { tenantId: claimedRun.tenantId, personId: claimedRun.personId };
  let heartbeatFailure: Error | null = null;
  let lastTelemetryAt = 0;
  const heartbeat = async () => {
    if (heartbeatFailure) throw heartbeatFailure;
    await repos.scrapeRuns.heartbeatWorkerLease(claimedRun.id, WORKER_ID, leaseToken, LEASE_MS);
    if (Date.now() - lastTelemetryAt < HEARTBEAT_MS) return;
    try {
      const manifest = JSON.parse(await readFile(path.join(ARTIFACTS_DIR,"runs",claimedRun.id,"manifest.json"), "utf8"));
      lastTelemetryAt = Date.now();
      await repos.scrapeRuns.updateRunMetrics(scope, claimedRun.id, {
        totalDiscovered: Math.max(manifest.opportunitiesFound ?? 0, manifest.cards?.length ?? 0),
      }, { owner: WORKER_ID, token: leaseToken });
      await repos.scrapeRuns.recordEvent(scope, claimedRun.id, { stage: manifest.status || "running", eventType: "run_progress",
        payload: { opportunitiesFound: Math.max(manifest.opportunitiesFound ?? 0, manifest.cards?.length ?? 0),
          updatedAt: manifest.updatedAt, recentActivities: manifest.recentActivities || [],
          locallyCapturedCount: manifest.cards?.filter((card: { handoffStatus?: string }) => card.handoffStatus).length || 0,
          pendingUploadCount: manifest.cards?.filter((card: { handoffStatus?: string }) => card.handoffStatus && card.handoffStatus !== "acknowledged").length || 0,
          admittedCount: manifest.telemetry?.canonicalIngestSuccess || 0,
          sources: manifest.sources || {}, portalHealth: manifest.portalHealth || {} } });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("Scrape telemetry publication failed");
    }
  };
  const timer = setInterval(() => {
    void heartbeat().catch((error) => {
      heartbeatFailure = error instanceof Error ? error : new Error(String(error));
      console.error(`[scrape-worker] lease lost for ${claimedRun.id}:`, heartbeatFailure);
      process.exit(1);
    });
  }, HEARTBEAT_MS);
  timer.unref();

  try {
    await heartbeat();
    let config: Record<string, unknown> = {};
    try { config = JSON.parse(claimedRun.configJson || "{}"); } catch {}
    const portals = claimedRun.portalTargets.filter((value): value is PortalName =>
      value === "LinkedIn" || value === "Naukri" || value === "Indeed"
    );
    const { completion } = await startRun({
      resume: true,
      autoConfirm: true,
      scope,
      searchPlanId: claimedRun.searchPlanId ?? undefined,
      portals: portals.length ? portals : undefined,
      maxPages: typeof config.maxPages === "number" ? config.maxPages : undefined,
      maxCardsPerPage: typeof config.maxCardsPerPage === "number" ? config.maxCardsPerPage : undefined,
      keywords: Array.isArray(config.keywords) && config.keywords.every((value) => typeof value === "string")
        ? config.keywords as string[]
        : undefined,
      claimedRunId: claimedRun.id,
      assertWorkerLease: heartbeat,
      scrapeLease: { owner: WORKER_ID, token: leaseToken },
      freshSource: typeof config.freshSource === "boolean" ? config.freshSource : undefined,
      newRun: config.newRun === true,
    });
    const result = await completion;
    if (heartbeatFailure) throw heartbeatFailure;
    if (!result.success) return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : "SCRAPE_WORKER_FAILED";
    if (message === "ACQUISITION_EXECUTION_BUSY") {
      await getDatabaseAdapter().execute("UPDATE scrape_runs SET status='queued' WHERE id=? AND status='initializing' AND lease_owner=? AND lease_token=?", [claimedRun.id, WORKER_ID, leaseToken]);
      return false;
    }
    if (!message.includes("SCRAPE_RUN_LEASE_LOST")) {
      await repos.scrapeRuns.failWorkerLease(claimedRun.id, WORKER_ID, leaseToken, message);
    }
  } finally {
    clearInterval(timer);
    await repos.scrapeRuns.releaseWorkerLease(claimedRun.id, WORKER_ID, leaseToken).catch(() => false);
  }
  return true;
}

async function run() {
  assertAcquisitionHost();
  if (process.env.RADAR_DEPLOYMENT_MODE === "distributed") {
    const health = await getBlobStore({enforceDistributed:true}).healthCheck();
    if (!health.ok) throw new Error(`ACQUISITION_STORAGE_UNAVAILABLE: ${health.error}`);
    console.info(`[scrape-worker] Shared storage verified (${health.backend})`);
  }
  await startWorkerHeartbeat("scrape");
  let idleMs = 1_000;
  let nextRetentionAt = 0;
  while (!stopping) {
    if (process.env.RADAR_DEPLOYMENT_MODE === "distributed" && Date.now() >= nextRetentionAt) {
      nextRetentionAt = Date.now() + 3600_000;
      try {
        const report = await runAcquisitionRetention(getDatabaseAdapter(), getBlobStore({ enforceDistributed: true }), {
          artifactsDir: ARTIFACTS_DIR,
          outboxDir: path.resolve(process.env.RADAR_ACQUISITION_OUTBOX_DIR || ".radar/acquisition-outbox"), apply: true,
        });
        console.info("[scrape-worker] Retention", JSON.stringify(report));
      } catch (error) { console.error("[scrape-worker] Retention failed; retained remaining artifacts", (error as Error).name); }
    }
    const claimed = await claimAndRun();
    if (claimed) { idleMs = 1_000; continue; }
    await new Promise((resolve) => setTimeout(resolve, idleMs));
    idleMs = Math.min(idleMs * 2, 5_000);
  }
}
void run();
