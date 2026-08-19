import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  getActiveScrapeState,
  getRunProgressState,
  abortScrapeState,
} from "../../src/lib/intelligence/scrape-server";

const ARTIFACTS_DIR = path.join(process.cwd(), ".scraper-artifacts");
const RUNS_DIR = path.join(ARTIFACTS_DIR, "runs");
const LATEST_PATH = path.join(RUNS_DIR, "latest.json");

describe("Scrape Progress & Persistent Control UX Contract", () => {
  const testRunId = `test-run-${Date.now()}`;
  const testRunDir = path.join(RUNS_DIR, testRunId);
  const testManifestPath = path.join(testRunDir, "manifest.json");

  beforeEach(() => {
    if (!fs.existsSync(testRunDir)) {
      fs.mkdirSync(testRunDir, { recursive: true });
    }
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testRunDir)) {
        fs.rmSync(testRunDir, { recursive: true, force: true });
      }
      if (fs.existsSync(LATEST_PATH)) {
        const latest = JSON.parse(fs.readFileSync(LATEST_PATH, "utf-8"));
        if (latest?.runId === testRunId) {
          fs.unlinkSync(LATEST_PATH);
        }
      }
    } catch {}
  });

  it("Test 1: Refresh during active scrape — maintains runId, active stage, and canonical metrics", async () => {
    // 1. Setup simulated active run in manifest.json and latest.json
    const activeManifest = {
      runId: testRunId,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "running",
      stage: "discover",
      opportunitiesFound: 49,
      evaluatedCount: 12,
      remainingCount: 37,
      sources: { LinkedIn: "searching", Naukri: "completed", Indeed: "pending" },
      keywords: ["VP Growth"],
      portals: ["LinkedIn", "Naukri", "Indeed"],
      maxPages: 3,
      maxCardsPerPage: 20,
      units: [],
      cards: [],
    };

    fs.writeFileSync(testManifestPath, JSON.stringify(activeManifest, null, 2), "utf-8");
    fs.writeFileSync(LATEST_PATH, JSON.stringify({ runId: testRunId }, null, 2), "utf-8");

    // 2. Simulate page refresh / initial app boot hydration via getActiveScrapeState()
    const activeRun = getActiveScrapeState();
    expect(activeRun).not.toBeNull();
    expect(activeRun?.runId).toBe(testRunId);
    expect(activeRun?.isActive).toBe(true);
    expect(activeRun?.status).toBe("running");
    expect(activeRun?.stage).toBe("discover");
    expect(activeRun?.opportunitiesFound).toBe(49);
    expect(activeRun?.evaluatedCount).toBe(12);
    expect(activeRun?.remainingCount).toBe(37);
    expect(activeRun?.sources.LinkedIn).toBe("searching");

    // 3. Simulate backend updating manifest progress during execution
    activeManifest.evaluatedCount = 18;
    activeManifest.remainingCount = 31;
    activeManifest.updatedAt = new Date().toISOString();
    fs.writeFileSync(testManifestPath, JSON.stringify(activeManifest, null, 2), "utf-8");

    // 4. Simulate periodic reconciliation poll via getRunProgressState()
    const progress = getRunProgressState(testRunId);
    expect(progress?.evaluatedCount).toBe(18);
    expect(progress?.remainingCount).toBe(31);
  });

  it("Test 2: Refresh while stopping — maintains stopping status until backend sets stopped", async () => {
    const testRunId = "run_test_stopping_123";
    const runDir = path.join(ARTIFACTS_DIR, "runs", testRunId);
    fs.mkdirSync(runDir, { recursive: true });

    const testManifestPath = path.join(runDir, "manifest.json");
    const runningManifest = {
      runId: testRunId,
      status: "running",
      stage: "scraping",
      updatedAt: new Date().toISOString(),
      discoveredCount: 50,
      evaluatedCount: 25,
      remainingCount: 25,
      keywords: ["Director Marketing"],
      portals: ["LinkedIn"],
      maxPages: 2,
      maxCardsPerPage: 10,
      units: [],
      cards: [],
    };

    fs.writeFileSync(testManifestPath, JSON.stringify(runningManifest, null, 2), "utf-8");
    fs.writeFileSync(LATEST_PATH, JSON.stringify({ runId: testRunId }, null, 2), "utf-8");

    // 2. User clicks STOP SEARCH -> calls abortScrapeState()
    const stopRes = await abortScrapeState(testRunId);
    expect(stopRes.success).toBe(true);
    expect(stopRes.status).toBe("stopping");

    // 3. Verify manifest.status is explicitly 'stopping' on disk
    const diskManifest = JSON.parse(fs.readFileSync(testManifestPath, "utf-8"));
    expect(diskManifest.status).toBe("stopping");

    // 4. Simulate refresh while stopping -> getActiveScrapeState() returns active state with status 'stopping'
    const activeRunWhileStopping = getActiveScrapeState();
    expect(activeRunWhileStopping).not.toBeNull();
    expect(activeRunWhileStopping?.isActive).toBe(true);
    expect(activeRunWhileStopping?.status).toBe("stopping");

    // 5. Backend completes graceful shutdown and sets status to 'stopped'
    diskManifest.status = "stopped";
    diskManifest.stage = "stopped";
    diskManifest.finishedAt = new Date().toISOString();
    fs.writeFileSync(testManifestPath, JSON.stringify(diskManifest, null, 2), "utf-8");

    // 6. Next poll gets terminal 'stopped' state
    const progressAfterStopped = getRunProgressState(testRunId);
    expect(progressAfterStopped?.status).toBe("stopped");
    expect(progressAfterStopped?.isActive).toBe(false);

    // 7. Subsequent getActiveScrapeState() returns null (does not float finished runs forever)
    const activeRunAfterStopped = getActiveScrapeState();
    expect(activeRunAfterStopped).toBeNull();
  });
});
