import { createServerFn } from "@tanstack/react-start";
import path from "path";
import fs from "fs";
import { ARTIFACTS_DIR } from "../../../scripts/scraper/config";

let rebuildTimeout: NodeJS.Timeout | null = null;

// Debounced 2-second function to rebuild SQLite read models and write live-scraped.json
export function triggerDebouncedRebuild() {
  if (rebuildTimeout) {
    clearTimeout(rebuildTimeout);
  }
  rebuildTimeout = setTimeout(async () => {
    console.log("[Server] Debounce trigger: rebuilding SQLite read models...");
    try {
      const { runRebuildReadModels } = await import("../../../scripts/rebuild-read-models");
      runRebuildReadModels();

      const { collectRecords, writeLiveScraped } = await import("../../../scripts/scraper/persist/writer");
      const records = collectRecords();
      writeLiveScraped(records);
      console.log(`[Server] Successfully rebuilt live-scraped.json cache with ${records.length} records.`);
    } catch (err: any) {
      console.error("[Server] Debounced rebuild failed:", err.message);
    }
  }, 2000);
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
          const recovered = queue.recoverExpiredLeases();
          if (recovered > 0) {
            console.log(`[Daemon] Recovered ${recovered} expired leases.`);
          }
          
          // 2. Rebuild the live-scraped.json cache if out of sync
          const jsonPath = path.join(process.cwd(), "src", "data", "live-scraped.json");
          if (!fs.existsSync(jsonPath)) {
            console.log("[Daemon] live-scraped.json missing. Building on boot...");
            const { runRebuildReadModels } = await import("../../../scripts/rebuild-read-models");
            runRebuildReadModels();
            const { collectRecords, writeLiveScraped } = await import("../../../scripts/scraper/persist/writer");
            writeLiveScraped(collectRecords());
          }

          // 3. Start background queue drain loop
          const { enrichGlobalQueue } = await import("../../../scripts/enrich");
          void enrichGlobalQueue(triggerDebouncedRebuild).catch(err => {
            console.error("[Daemon] Queue loop error:", err);
            g.__RADAR_DAEMON__.started = false; // allow restart
          });
          
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

export const triggerScrapeFn = createServerFn({ method: "POST" })
  .handler(async () => {
    try {
      console.log("[Server] triggerScrapeFn: launching fresh live scraper in background…");
      // Dynamic import isolates Playwright/Node modules from the browser bundler.
      const { startRun } = await import("../../../scripts/scrape");
      
      const { runId, completion } = await startRun({ resume: false, autoConfirm: true });
      
      // Fire and forget
      void completion.catch((err: any) => {
        console.error(`[Server] background scrape ${runId} failed:`, err);
      });

      return { success: true, runId };
    } catch (error: any) {
      console.error("[Server] triggerScrapeFn failed:", error);
      return { success: false, error: error?.message ?? String(error) };
    }
  });

export const getRunEventsFn = createServerFn({ method: "GET" })
  .validator((d: { runId: string; afterIndex: number }) => d)
  .handler(async ({ data }) => {
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

    // Load active enrichment stats from queue.db
    let enrichmentStats: any = null;
    let isEnriching = false;
    try {
      const { EnrichmentQueue } = await import("../../../scripts/scraper/persist/queue");
      const queue = new EnrichmentQueue();
      enrichmentStats = queue.getRunStats(runId);
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

export const confirmScrapeFn = createServerFn({ method: "POST" })
  .validator((d: { runId: string }) => d)
  .handler(async ({ data }) => {
    const manifestPath = path.join(ARTIFACTS_DIR, "runs", data.runId, "manifest.json");
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      if (manifest.status === "waiting_for_confirmation") {
        manifest.status = "running";
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

export const abortScrapeFn = createServerFn({ method: "POST" })
  .validator((d: { runId: string }) => d)
  .handler(async ({ data }) => {
    const manifestPath = path.join(ARTIFACTS_DIR, "runs", data.runId, "manifest.json");
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      if (manifest.status === "waiting_for_confirmation" || manifest.status === "running") {
        manifest.status = "aborted";
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

export const getLiveScrapedFn = createServerFn({ method: "GET" })
  .handler(async () => {
    try {
      const p = path.join(process.cwd(), "src", "data", "live-scraped.json");
      if (!fs.existsSync(p)) return [];
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    } catch {
      return [];
    }
  });

export const triggerCorpusRegenerationFn = createServerFn({ method: "POST" })
  .handler(async () => {
    try {
      console.log("[Server] triggerCorpusRegenerationFn: starting corpus pipeline...");
      const { runCorpusPipeline } = await import("../../../scripts/corpus/pipeline");
      return await runCorpusPipeline();
    } catch (err: any) {
      console.error("[Server] triggerCorpusRegenerationFn failed:", err.message);
      return { success: false, error: err.message };
    }
  });

export const getCorpusHealthFn = createServerFn({ method: "GET" })
  .handler(async () => {
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
    try {
      const { EnrichmentQueue } = await import("../../../scripts/scraper/persist/queue");
      const queue = new EnrichmentQueue();
      const stats = queue.getGlobalPipelineStats();
      
      const { getScraperCounts } = await import("../../data/scraped-jobs");
      const counts = getScraperCounts();

      return {
        ...stats,
        filtered: counts.filtered,
        shortlisted: counts.shortlisted
      };
    } catch (err: any) {
      console.error("[Server] getPipelineStatsFn failed:", err.message);
      return null;
    }
  });
