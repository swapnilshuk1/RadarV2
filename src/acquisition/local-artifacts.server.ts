import fs from "node:fs";
import path from "node:path";
import { ARTIFACTS_DIR } from "../../scripts/scraper/config";
import { Journal } from "../../scripts/scraper/run/journal";

export function readLocalRunEvents(runId: string, afterIndex: number) {
  const runDir = path.join(ARTIFACTS_DIR, "runs", runId);
  const journalPath = path.join(runDir, "journal.ndjson");
  const manifestPath = path.join(runDir, "manifest.json");
  const { events, nextIndex } = Journal.readIncremental(journalPath, afterIndex);

  let manifest: any = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch {}

  const summary = { portalsCompleted: 0, cardsFound: 0, extracted: 0 };
  const allEvents = Journal.replay(journalPath);
  for (const event of allEvents) {
    if (event.type === "unit_done" || event.type === "unit_empty" || event.type === "unit_failed") summary.portalsCompleted++;
    if (event.type === "snapshot_written") summary.cardsFound++;
    if (event.type === "extraction_written") summary.extracted++;
  }
  return { events, nextIndex, manifest, summary };
}

export function buildCanonicalRunData(runId: string, enrichmentCompleted?: number) {
  const runDir = path.join(ARTIFACTS_DIR, "runs", runId);
  const manifestPath = path.join(runDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const opportunitiesFound = manifest.opportunitiesFound ?? manifest.cards?.length ?? 0;
    let evaluatedCount = manifest.evaluatedCount ?? 0;
    if (enrichmentCompleted !== undefined) evaluatedCount = Math.max(evaluatedCount, enrichmentCompleted);
    const remainingCount = Math.max(0, opportunitiesFound - evaluatedCount);
    const activeStates = ["queued", "initializing", "waiting_for_confirmation", "running", "enriching", "stopping", "completing"];
    const isActive = activeStates.includes(manifest.status);
    const sources = manifest.sources || { LinkedIn: "pending", Naukri: "pending", Indeed: "pending" };

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
      recentActivities: manifest.recentActivities || [],
    };
  } catch {
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
    return runData?.isActive ? runData : null;
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
    }
    return { success: true, status: force ? "aborted" : "stopping" };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export function confirmLocalScrapeState(runId: string): { success: boolean; error?: string } {
  const manifestPath = path.join(ARTIFACTS_DIR, "runs", runId, "manifest.json");
  try {
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      if (manifest.status === "waiting_for_confirmation") {
        manifest.status = "running";
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
      }
    }
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
