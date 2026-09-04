import { createServerFn } from "@tanstack/react-start";
import path from "path";
import fs from "fs";
import { ARTIFACTS_DIR } from "../../../scripts/scraper/config";
import { requireAuthUser } from "../auth/guard";
import { getRepositories } from "../../data/sqlite/provider";

let rebuildTimeout: NodeJS.Timeout | null = null;

// Debounced 10-second function to rebuild SQLite read models and write live-scraped.json
export function triggerDebouncedRebuild() {
  if (rebuildTimeout) {
    clearTimeout(rebuildTimeout);
  }
  rebuildTimeout = setTimeout(async () => {
    try {
      const { collectRecords, writeLiveScraped } = await import("../../../scripts/scraper/persist/writer");
      const records = collectRecords();
      writeLiveScraped(records);
      invalidateLiveScrapedCache();

      // Notify EvaluationCoordinator that corpus has expanded
      const { EvaluationCoordinator } = await import("./EvaluationCoordinator");
      await EvaluationCoordinator.notify({ event: "CORPUS_UPDATED" });
    } catch (err: any) {
      console.error("[Server] Debounced rebuild failed:", err.message);
    }
  }, 10000);
}

// Vite HMR-safe singleton background daemon initialization
if (typeof globalThis !== "undefined") {
  const g = globalThis as any;
  if (!g.__RADAR_DAEMON__) {
    g.__RADAR_DAEMON__ = {
      started: false,
      start: async () => {
        if (g.__RADAR_DAEMON__.started) return;
        g.__RADAR_DAEMON__.started = true;
        console.log("[Daemon] Starting self-healing RADAR background daemon...");
        
        try {
          // 1. Recover expired leases
          const { EnrichmentQueue } = await import("../../../scripts/scraper/persist/queue");
          const queue = new EnrichmentQueue();
          const recovered = await queue.recoverExpiredLeases();
          if (recovered > 0) {
            console.log(`[Daemon] Recovered ${recovered} expired leases.`);
          }
          
          // 2. Rebuild the live-scraped.json cache if out of sync
          const jsonPath = path.join(process.cwd(), "src", "data", "live-scraped.json");
          if (!fs.existsSync(jsonPath)) {
            console.log("[Daemon] live-scraped.json missing. Building on boot...");
            const { collectRecords, writeLiveScraped } = await import("../../../scripts/scraper/persist/writer");
            writeLiveScraped(collectRecords());
          }

          // 3. A global raw-enrichment worker can lease jobs created by a
          // different host. Do not let a serving host consume locally stored
          // scraper artifacts: only a shared object store makes that safe.
          const { supportsCrossHostEnrichment } = await import("../storage/blob-store");
          if (supportsCrossHostEnrichment()) {
            const { enrichGlobalQueue } = await import("../../../scripts/enrich");
            void enrichGlobalQueue(triggerDebouncedRebuild).catch(err => {
              console.error("[Daemon] Queue loop error:", err);
              g.__RADAR_DAEMON__.started = false; // allow restart
            });
          } else {
            console.warn("[Daemon] Global raw enrichment disabled: local BlobStore payloads may only be consumed by their acquisition host.");
          }

          // 4. Start background Evaluation Daemon singleton for evaluation_jobs
          const { EvaluationDaemon } = await import("./EvaluationDaemon");
          EvaluationDaemon.startGlobalDaemon(2000);

          
        } catch (err: any) {
          console.error("[Daemon] Startup failure:", err.message);
          g.__RADAR_DAEMON__.started = false;
        }
      }
    };
  }
  
  // Start the singleton daemon inside the server context with a 10-second delay.
  // This defers background database checks and loops, allowing Vite to fully load
  // and bundle the page instantly when running 'npm run dev' or loading localhost!
  if (typeof window === "undefined" && !g.__RADAR_DAEMON__.started) {
    setTimeout(() => {
      g.__RADAR_DAEMON__.start().catch((e: any) => {
        console.error("[Daemon] Deferred start failed:", e.message);
      });
    }, 10000); // 10 seconds deferred delay
  }
}

let activeScrapeRunLock: { runId: string; startedAt: number } | null = null;

/**
 * Read-only execution preview for the shortlist. It deliberately resolves and
 * compiles the same active plan as triggerScrapeFn so the interface cannot
 * display a reconstructed or stale interpretation of the next search.
 */
export const getScrapePlanPreviewFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await requireAuthUser();
    try {
      const { resolveScraperAuthContext } = await import("../security/scope-resolver");
      const { scope, activeContext } = await resolveScraperAuthContext(user.id);
      const { ScraperPlanResolver } = await import("./ScraperPlanResolver");
      const resolvedPlan = await ScraperPlanResolver.resolveActivePlan(scope, activeContext);
      const { compileCoverageVariants } = await import("../../../scripts/scraper/run/acquisition-variants");
      const variants = compileCoverageVariants(resolvedPlan, ["LinkedIn", "Naukri", "Indeed"]);

      const firstVariant = variants[0];
      return {
        status: "ready" as const,
        searchPlanId: resolvedPlan.searchPlanId,
        snapshotId: resolvedPlan.snapshotId ?? null,
        title: resolvedPlan.title,
        keywords: resolvedPlan.queries,
        portals: ["LinkedIn", "Naukri", "Indeed"] as const,
        location: firstVariant?.location ?? null,
        postedWithinDays: firstVariant?.postedWithinDays ?? null,
        sort: firstVariant?.sort ?? null,
        executionSurfaceCount: variants.length,
      };
    } catch (error: unknown) {
      // A broken active plan must be observable from the interface, but it must
      // not make the shortlist unavailable. triggerScrapeFn remains fail-closed.
      return {
        status: "unavailable" as const,
        error: error instanceof Error ? error.message : "Unable to resolve the active search plan.",
      };
    }
  });

export function getActiveScrapeLock(): { runId: string; startedAt: number } | null {
  if (!activeScrapeRunLock) return null;
  const state = getActiveScrapeState();
  if (!state || !state.isActive) {
    activeScrapeRunLock = null;
    return null;
  }
  return activeScrapeRunLock;
}

export const triggerScrapeFn = createServerFn({ method: "POST" })
  .handler(async () => {
    // 1. Enforce Authentication
    const user = await requireAuthUser();

    try {
      console.log("[Server] triggerScrapeFn: resolving verified scraper auth scope…");
      const { resolveScraperAuthContext } = await import("../security/scope-resolver");
      const { authContext, scope, activeContext } = await resolveScraperAuthContext(user.id);
      const { ScraperPlanResolver } = await import("./ScraperPlanResolver");
      const resolvedPlan = await ScraperPlanResolver.resolveActivePlan(scope, activeContext);
      const repos = getRepositories();

      // Per-tenant/person concurrency check in Turso Cloud
      const existingActive = await repos.scrapeRuns.getActiveRun(scope);
      if (existingActive) {
        console.warn(`[Server] triggerScrapeFn rejected: Active run ${existingActive.id} already exists for tenant ${scope.tenantId}, person ${scope.personId}`);
        return {
          success: false,
          error: `A scraping run is already in progress (${existingActive.id}). Concurrent execution for your account is rejected.`,
          runId: existingActive.id,
          alreadyRunning: true
        };
      }

      console.log(`[Server] triggerScrapeFn: launching background scraper for tenant ${authContext.tenantId} (person: ${scope.personId})…`);
      // Dynamic import isolates Playwright/Node modules from the browser bundler.
      const { startRun } = await import("../../../scripts/scrape");
      const { runId, completion } = await startRun({
        resume: false,
        autoConfirm: true,
        authContext,
        searchPlanId: activeContext?.searchPlanId,
        resolvedPlan,
      });
      
      activeScrapeRunLock = { runId, startedAt: Date.now() };

      // Fire and forget
      void completion
        .then(() => {
          if (activeScrapeRunLock?.runId === runId) {
            activeScrapeRunLock = null;
          }
        })
        .catch((err: any) => {
          console.error(`[Server] background scrape ${runId} failed:`, err);
          if (activeScrapeRunLock?.runId === runId) {
            activeScrapeRunLock = null;
          }
        });

      return { success: true, runId };
    } catch (error: any) {
      console.error("[Server] triggerScrapeFn failed:", error);
      activeScrapeRunLock = null;
      return { success: false, error: error?.message ?? String(error) };
    }
  });

export const getRunEventsFn = createServerFn({ method: "GET" })
  .validator((d: { runId: string; afterIndex: number }) => d)
  .handler(async ({ data }) => {
    await requireAuthUser();
    const { runId, afterIndex } = data;
    const { Journal } = await import("../../../scripts/scraper/run/journal");
    
    const runDir = path.join(ARTIFACTS_DIR, "runs", runId);
    const journalPath = path.join(runDir, "journal.ndjson");
    const manifestPath = path.join(runDir, "manifest.json");
    
    const { events, nextIndex } = Journal.readIncremental(journalPath, afterIndex);
    
    let manifest: any = null;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch {}

    const summary = {
      portalsCompleted: 0,
      cardsFound: 0,
      extracted: 0
    };
    
    const allEvents = Journal.replay(journalPath);
    for (const e of allEvents) {
      if (e.type === "unit_done" || e.type === "unit_empty" || e.type === "unit_failed") summary.portalsCompleted++;
      if (e.type === "snapshot_written") summary.cardsFound++;
      if (e.type === "extraction_written") summary.extracted++;
    }

    // Load active enrichment stats from canonical Turso operational queue
    let enrichmentStats: any = null;
    let isEnriching = false;
    try {
      const { EnrichmentQueue } = await import("../../../scripts/scraper/persist/queue");
      const queue = new EnrichmentQueue();
      enrichmentStats = await queue.getRunStats(runId);
      if (enrichmentStats && enrichmentStats.total > 0 && (enrichmentStats.pending + enrichmentStats.processing > 0)) {
        isEnriching = true;
      }
    } catch (err: any) {
      console.error("[Server] Failed to load enrichment stats:", err.message);
    }

    const completed = (manifest?.status === "completed" || manifest?.status === "failed" || manifest?.status === "aborted") && !isEnriching;
    const status = isEnriching ? "enriching" : (manifest?.status || "running");

    return {
      runId,
      completed,
      status,
      portalHealth: manifest?.portalHealth || {},
      events: events as any[],
      nextIndex,
      summary,
      enrichmentStats
    };
  });

export function buildCanonicalRunData(runId: string, enrichmentCompleted?: number) {
  const runDir = path.join(ARTIFACTS_DIR, "runs", runId);
  const manifestPath = path.join(runDir, "manifest.json");

  if (!fs.existsSync(manifestPath)) return null;

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const opportunitiesFound = manifest.opportunitiesFound ?? manifest.cards?.length ?? 0;

    let evaluatedCount = manifest.evaluatedCount ?? 0;
    if (enrichmentCompleted !== undefined) {
      evaluatedCount = Math.max(evaluatedCount, enrichmentCompleted);
    }

    const remainingCount = Math.max(0, opportunitiesFound - evaluatedCount);

    const ACTIVE_STATES = ["queued", "initializing", "waiting_for_confirmation", "running", "enriching", "stopping", "completing"];
    const isActive = ACTIVE_STATES.includes(manifest.status);

    const sources = manifest.sources || {
      LinkedIn: "pending",
      Naukri: "pending",
      Indeed: "pending"
    };

    let stage = manifest.stage;
    if (!stage) {
      if (manifest.status === "completed") stage = "complete";
      else if (manifest.status === "stopped" || manifest.status === "aborted") stage = "stopped";
      else if (manifest.status === "failed") stage = "failed";
      else if (manifest.status === "enriching") stage = "evaluate";
      else stage = "discover";
    }

    return {
      runId,
      status: manifest.status,
      isActive,
      stage,
      opportunitiesFound,
      evaluatedCount,
      remainingCount,
      sources,
      startedAt: manifest.startedAt,
      updatedAt: manifest.updatedAt,
      finishedAt: manifest.finishedAt,
      portalHealth: manifest.portalHealth || {},
      recentActivities: manifest.recentActivities || []
    };
  } catch (err: any) {
    console.error(`[Server] Failed to read manifest for run ${runId}:`, err.message);
    return null;
  }
}

export function getActiveScrapeState() {
  try {
    const latestPath = path.join(ARTIFACTS_DIR, "runs", "latest.json");
    if (!fs.existsSync(latestPath)) return null;
    const latest = JSON.parse(fs.readFileSync(latestPath, "utf-8"));
    if (!latest?.runId) return null;

    const runData = buildCanonicalRunData(latest.runId);
    if (runData && runData.isActive) {
      // If there is no active process lock and updatedAt is >30s old, the run is orphaned
      const updatedAt = runData.updatedAt ? new Date(runData.updatedAt).getTime() : 0;
      const ageMs = Date.now() - updatedAt;
      if (!activeScrapeRunLock && ageMs > 30000) {
        abortScrapeState(latest.runId, true);
        return null;
      }
      return runData;
    }
    return null; // Active-only per Directive #2
  } catch {
    return null;
  }
}

export function getRunProgressState(runId: string) {
  return buildCanonicalRunData(runId);
}

export async function abortScrapeState(runId: string, force = false) {
  const manifestPath = path.join(ARTIFACTS_DIR, "runs", runId, "manifest.json");
  try {
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      manifest.status = force ? "aborted" : "stopping";
      manifest.updatedAt = new Date().toISOString();
      if (force) manifest.finishedAt = manifest.updatedAt;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
      console.log(`[Server] Abort requested for run ${runId}. Manifest status set to '${manifest.status}'.`);
    }
    // Forcefully trigger live abort on the running scraper process
    if (!force) {
      try {
        const { abortLiveRun } = await import("../../../scripts/scrape");
        await abortLiveRun(runId);
      } catch (e: any) {
        console.warn(`[Server] Note: abortLiveRun call: ${e.message}`);
      }
    }
    return { success: true, status: force ? "aborted" : "stopping" };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export const getActiveScrapeFn = createServerFn({ method: "GET" })
  .handler(async () => {
    await requireAuthUser();
    return getActiveScrapeState();
  });

export const getLatestRunFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await requireAuthUser();
    const { resolveServingScope } = await import("../security/scope-resolver");
    const { scope } = await resolveServingScope(user.id);
    const repos = getRepositories();

    // 1. Query Turso Cloud for the caller's scoped latest run
    const latestDbRun = await repos.scrapeRuns.getLatestRun(scope);
    if (!latestDbRun) return null;

    // 2. Hydrate canonical run data (fall back to disk manifest if available for local activity details)
    const diskData = buildCanonicalRunData(latestDbRun.id);
    if (diskData) {
      return {
        ...diskData,
        status: latestDbRun.status,
        opportunitiesFound: Math.max(diskData.opportunitiesFound || 0, latestDbRun.totalDiscovered),
      };
    }

    return {
      runId: latestDbRun.id,
      status: latestDbRun.status,
      isActive: ["queued", "initializing", "running", "waiting_for_confirmation"].includes(latestDbRun.status),
      stage: latestDbRun.status === "completed" ? "complete" : latestDbRun.status,
      opportunitiesFound: latestDbRun.totalDiscovered,
      evaluatedCount: latestDbRun.totalEnqueued,
      remainingCount: 0,
      sources: {},
      startedAt: latestDbRun.startedAt || latestDbRun.createdAt,
      updatedAt: latestDbRun.updatedAt,
      finishedAt: latestDbRun.finishedAt || undefined,
      portalHealth: {},
      recentActivities: [],
    };
  });

export const getRunProgressFn = createServerFn({ method: "GET" })
  .validator((d: { runId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const { resolveServingScope } = await import("../security/scope-resolver");
    const { scope } = await resolveServingScope(user.id);
    const repos = getRepositories();

    const dbRun = await repos.scrapeRuns.getRun(scope, data.runId);
    if (!dbRun) {
      const { TenantIsolationError } = await import("../security/auth");
      throw new TenantIsolationError(`Scrape run '${data.runId}' not found or unauthorized for current tenant/person.`);
    }

    const diskData = getRunProgressState(data.runId);
    if (diskData) {
      return {
        ...diskData,
        status: dbRun.status,
      };
    }

    return {
      runId: dbRun.id,
      status: dbRun.status,
      isActive: ["queued", "initializing", "running", "waiting_for_confirmation"].includes(dbRun.status),
      stage: dbRun.status === "completed" ? "complete" : dbRun.status,
      opportunitiesFound: dbRun.totalDiscovered,
      evaluatedCount: dbRun.totalEnqueued,
      remainingCount: 0,
      sources: {},
      startedAt: dbRun.startedAt || dbRun.createdAt,
      updatedAt: dbRun.updatedAt,
      finishedAt: dbRun.finishedAt || undefined,
      portalHealth: {},
      recentActivities: [],
    };
  });

export const confirmScrapeFn = createServerFn({ method: "POST" })
  .validator((d: { runId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const { resolveServingScope } = await import("../security/scope-resolver");
    const { scope } = await resolveServingScope(user.id);
    const repos = getRepositories();

    const dbRun = await repos.scrapeRuns.getRun(scope, data.runId);
    if (!dbRun) {
      const { TenantIsolationError } = await import("../security/auth");
      throw new TenantIsolationError(`Cannot confirm run '${data.runId}': unauthorized or not found.`);
    }

    await repos.scrapeRuns.updateRunStatus(scope, data.runId, "running");

    const manifestPath = path.join(ARTIFACTS_DIR, "runs", data.runId, "manifest.json");
    try {
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        if (manifest.status === "waiting_for_confirmation") {
          manifest.status = "running";
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
        }
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

export const abortScrapeFn = createServerFn({ method: "POST" })
  .validator((d: { runId: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const { resolveServingScope } = await import("../security/scope-resolver");
    const { scope } = await resolveServingScope(user.id);
    const repos = getRepositories();

    const dbRun = await repos.scrapeRuns.getRun(scope, data.runId);
    if (!dbRun) {
      const { TenantIsolationError } = await import("../security/auth");
      throw new TenantIsolationError(`Cannot abort run '${data.runId}': unauthorized or not found.`);
    }

    await repos.scrapeRuns.updateRunStatus(scope, data.runId, "stopping");
    const result = abortScrapeState(data.runId);
    return result;
  });

let liveScrapedCache: { data: any[]; timestamp: number } | null = null;

export function invalidateLiveScrapedCache() {
  liveScrapedCache = null;
}

export const getLiveScrapedFn = createServerFn({ method: "GET" })
  .handler(async () => {
    await requireAuthUser();
    const now = Date.now();
    if (liveScrapedCache && (now - liveScrapedCache.timestamp < 30_000)) {
      return liveScrapedCache.data;
    }

    try {
      const { collectRecords } = await import("../../../scripts/scraper/persist/writer");
      const diskRecords = collectRecords();
      
      const p = path.join(process.cwd(), "src", "data", "live-scraped.json");
      let diskJsonRecords: any[] = [];
      if (fs.existsSync(p)) {
        try {
          diskJsonRecords = JSON.parse(fs.readFileSync(p, "utf-8"));
        } catch {}
      }

      const recordMap = new Map<string, any>();
      for (const r of diskJsonRecords) {
        if (r && (r.jobHash || r.id)) recordMap.set(r.jobHash || r.id, r);
      }
      for (const r of diskRecords as any[]) {
        if (r && (r.jobHash || r.id)) recordMap.set(r.jobHash || r.id, r);
      }

      const merged = Array.from(recordMap.values());
      const result = merged.length > 0 ? merged : diskJsonRecords;
      
      liveScrapedCache = { data: result, timestamp: now };
      return result;
    } catch {
      const p = path.join(process.cwd(), "src", "data", "live-scraped.json");
      if (!fs.existsSync(p)) return [];
      try {
        return JSON.parse(fs.readFileSync(p, "utf-8"));
      } catch {
        return [];
      }
    }
  });

export interface CorpusJobState {
  status: "idle" | "running" | "completed" | "failed";
  stage: "IDLE" | "INGESTING" | "NORMALIZING" | "ENRICHING" | "PUBLISHING" | "COMPLETE" | "FAILED";
  logs: string[];
  processedCount: number;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

if (typeof globalThis !== "undefined") {
  const g = globalThis as any;
  if (!g.__RADAR_CORPUS_JOB__) {
    g.__RADAR_CORPUS_JOB__ = {
      status: "idle",
      stage: "IDLE",
      logs: [],
      processedCount: 0,
    } as CorpusJobState;
  }
}

function getCorpusJob(): CorpusJobState {
  const g = globalThis as any;
  return g.__RADAR_CORPUS_JOB__ || { status: "idle", stage: "IDLE", logs: [], processedCount: 0 };
}

export const triggerCorpusRegenerationFn = createServerFn({ method: "POST" })
  .handler(async () => {
    await requireAuthUser();
    try {
      const job = getCorpusJob();
      if (job.status === "running") {
        return { success: true, running: true, message: "Corpus regeneration already in progress." };
      }

      job.status = "running";
      job.stage = "INGESTING";
      job.logs = [];
      job.processedCount = 0;
      job.error = undefined;
      job.startedAt = new Date().toISOString();
      job.completedAt = undefined;

      const addLog = (msg: string, stage: string) => {
        const time = new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
        job.logs.push(`[${time}] ${msg}`);
        job.stage = stage as any;
      };

      console.log("[Server] triggerCorpusRegenerationFn: launching corpus pipeline in background...");

      // Launch background asynchronous task
      void (async () => {
        try {
          const { runCorpusPipeline } = await import("../../../scripts/corpus/pipeline");
          const result = await runCorpusPipeline((msg, stage) => {
            addLog(msg, stage);
          });

          if (result && result.success) {
            job.status = "completed";
            job.stage = "COMPLETE";
            job.processedCount = result.processedCount || 0;
            job.completedAt = new Date().toISOString();
          } else {
            job.status = "failed";
            job.stage = "FAILED";
            job.error = result.error || result.reason || "Unknown error";
            job.completedAt = new Date().toISOString();
          }
        } catch (err: any) {
          console.error("[Server] Background corpus pipeline failed:", err);
          job.status = "failed";
          job.stage = "FAILED";
          job.error = err.message || String(err);
          job.completedAt = new Date().toISOString();
        }
      })();

      return { success: true, running: true, message: "Corpus regeneration started in background." };
    } catch (err: any) {
      console.error("[Server] triggerCorpusRegenerationFn failed:", err.message);
      return { success: false, error: err.message };
    }
  });

export const getCorpusRegenerationStatusFn = createServerFn({ method: "GET" })
  .handler(async () => {
    await requireAuthUser();
    return getCorpusJob();
  });

export const getCorpusHealthFn = createServerFn({ method: "GET" })
  .handler(async () => {
    await requireAuthUser();
    try {
      const { calculateCorpusHealth } = await import("../../../scripts/corpus/health");
      return calculateCorpusHealth();
    } catch (err: any) {
      console.error("[Server] getCorpusHealthFn failed:", err.message);
      return null;
    }
  });

export const getPipelineStatsFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await requireAuthUser();
    try {
      const { EnrichmentQueue } = await import("../../../scripts/scraper/persist/queue");
      const queue = new EnrichmentQueue();
      const stats = await queue.getGlobalPipelineStats();
      
      // Compute actual database evaluation metrics via canonical serving
      const { OpportunityService } = await import("./opportunity-service");
      const metrics = await OpportunityService.getMetricsForUser(user.id);

      return {
        ...stats,
        discovered: metrics.totalScreened,
        filtered: metrics.effectiveBreakdown.pass + metrics.effectiveBreakdown.sparse,
        shortlisted: metrics.effectiveBreakdown.pursue + metrics.effectiveBreakdown.consider,
        totalDecisions: metrics.totalDecisions,
        activePursuits: metrics.activePursuits,
      };
    } catch (err: any) {
      console.error("[Server] getPipelineStatsFn failed:", err.message);
      return null;
    }
  });
