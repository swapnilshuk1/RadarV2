/**
 * Explicit scraper-worker entrypoint. The web process only creates queued,
 * tenant/person-owned scrape runs; this process is the sole Playwright owner.
 */
import { randomUUID } from "node:crypto";
import { getRepositories } from "../src/data/sqlite/provider";
import { startRun } from "./scrape";
import type { PortalName } from "./scraper/types";
import { startWorkerHeartbeat } from "../src/lib/health/worker-heartbeat";
import { assertAcquisitionHost } from "../src/acquisition/execution-role";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ARTIFACTS_DIR } from "./scraper/config";

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
  const heartbeat = async () => {
    if (heartbeatFailure) throw heartbeatFailure;
    await repos.scrapeRuns.heartbeatWorkerLease(claimedRun.id, WORKER_ID, leaseToken, LEASE_MS);
    try {
      const manifest = JSON.parse(await readFile(path.join(ARTIFACTS_DIR,"runs",claimedRun.id,"manifest.json"), "utf8"));
      await repos.scrapeRuns.recordEvent(scope, claimedRun.id, { stage: manifest.status || "running", eventType: "run_progress",
        payload: { opportunitiesFound: manifest.opportunitiesFound ?? manifest.cards?.length ?? 0,
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
    });
    await completion;
    if (heartbeatFailure) throw heartbeatFailure;
  } catch (error) {
    const message = error instanceof Error ? error.message : "SCRAPE_WORKER_FAILED";
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
  await startWorkerHeartbeat("scrape");
  let idleMs = 1_000;
  while (!stopping) {
    const claimed = await claimAndRun();
    if (claimed) { idleMs = 1_000; continue; }
    await new Promise((resolve) => setTimeout(resolve, idleMs));
    idleMs = Math.min(idleMs * 2, 5_000);
  }
}
void run();
