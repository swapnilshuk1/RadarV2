import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { Journal } from "../../scripts/scraper/run/journal";
import { RunController } from "../../scripts/scraper/run/manager";

describe("P1: Scraper Journal Lifecycle & Shutdown Resilience", () => {
  let tmpDir: string;
  let journalPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-journal-test-"));
    journalPath = path.join(tmpDir, "test-journal.ndjson");
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  test("1. Normal append, fsync, and replay", () => {
    const journal = new Journal(journalPath);
    expect(journal.isOpen()).toBe(true);

    journal.append({ type: "event_1", data: "alpha" });
    journal.append({ type: "event_2", data: "beta" });
    journal.close();
    expect(journal.isOpen()).toBe(false);

    const replayed = Journal.replay(journalPath);
    expect(replayed.length).toBe(2);
    expect(replayed[0].type).toBe("event_1");
    expect(replayed[1].type).toBe("event_2");
  });

  test("2. Idempotent close — closing multiple times never throws", () => {
    const journal = new Journal(journalPath);
    expect(journal.isOpen()).toBe(true);

    journal.append({ type: "init" });
    journal.close();
    expect(journal.isOpen()).toBe(false);

    // Repeated close calls must be safe no-ops
    expect(() => journal.close()).not.toThrow();
    expect(() => journal.close()).not.toThrow();
    expect(journal.isOpen()).toBe(false);
  });

  test("3. Append after close is a safe no-op and never throws EBADF", () => {
    const journal = new Journal(journalPath);
    journal.append({ type: "before_close" });
    journal.close();

    // Appending after close must not throw EBADF or resurrect fd
    expect(() => {
      journal.append({ type: "post_close_event", data: "late_logger" });
    }).not.toThrow();
    expect(journal.isOpen()).toBe(false);

    // Verify only pre-close entries are in the file
    const replayed = Journal.replay(journalPath);
    expect(replayed.length).toBe(1);
    expect(replayed[0].type).toBe("before_close");
  });

  test("4. RunController.finalize is idempotent and guards against late logger appends", () => {
    const controller = new RunController();
    const manifestPath = path.join(tmpDir, "manifest.json");
    const cJournalPath = path.join(tmpDir, "controller-journal.ndjson");

    controller.runId = "test-run-123";
    controller.runDir = tmpDir;
    controller.manifestPath = manifestPath;
    controller.journalPath = cJournalPath;
    controller.journal = new Journal(cJournalPath);
    controller.manifest = {
      runId: "test-run-123",
      status: "running",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      portals: ["Indeed"],
      keywords: ["VP Growth"],
      units: [],
      cards: [],
      pageExecutionRecords: [],
      recentActivities: []
    } as any;

    controller.recordActivity("Scraping started");
    expect(controller.journal.isOpen()).toBe(true);

    // First finalize
    controller.finalize("completed");
    expect(controller.manifest.status).toBe("completed");
    expect(controller.journal.isOpen()).toBe(false);

    // Second finalize (double finalize simulation)
    expect(() => controller.finalize("aborted")).not.toThrow();
    expect(controller.manifest.status).toBe("completed"); // Status preserved from first finalize

    // Late activity log after finalize must not throw EBADF
    expect(() => controller.recordActivity("Late activity after shutdown")).not.toThrow();
  });

  test("5. Simulated SIGINT shutdown flow never throws EBADF", async () => {
    const journal = new Journal(journalPath);
    
    // Simulate events leading up to SIGINT
    journal.append({ type: "portal_started", portal: "Indeed" });
    
    // SIGINT handler sequence:
    // 1. Append signal event
    journal.append({ type: "signal", signal: "SIGINT" });
    // 2. Finalize & close
    journal.append({ type: "run_finished", status: "aborted" });
    journal.close();

    // 3. Late post-shutdown callback tries to log
    expect(() => {
      journal.append({ type: "shutdown_cleanup_complete" });
    }).not.toThrow();

    const events = Journal.replay(journalPath);
    expect(events.map(e => e.type)).toEqual(["portal_started", "signal", "run_finished"]);
  });
});
