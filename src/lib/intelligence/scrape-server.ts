import { createServerFn } from "@tanstack/react-start";
import path from "path";
import fs from "fs";

export const triggerScrapeFn = createServerFn({ method: "POST" })
  .handler(async () => {
    try {
      console.log("[Server] triggerScrapeFn: launching fresh live scraper in background…");
      // Dynamic import isolates Playwright/Node modules from the browser bundler.
      const { startRun } = await import("../../../scripts/scrape");
      
      const { runId, completion } = await startRun({ resume: false });
      
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
    
    const runDir = path.join(process.cwd(), ".scraper-artifacts", "runs", runId);
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

    return {
      runId,
      completed: manifest?.status === "completed" || manifest?.status === "failed" || manifest?.status === "aborted",
      status: manifest?.status || "running",
      portalHealth: manifest?.portalHealth || {},
      events: events as any[],
      nextIndex,
      summary
    };
  });

export const confirmScrapeFn = createServerFn({ method: "POST" })
  .validator((d: { runId: string }) => d)
  .handler(async ({ data }) => {
    const manifestPath = path.join(process.cwd(), ".scraper-artifacts", "runs", data.runId, "manifest.json");
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
    const manifestPath = path.join(process.cwd(), ".scraper-artifacts", "runs", data.runId, "manifest.json");
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
