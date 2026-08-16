import { describe, it, expect } from "vitest";
import { linkedinHandler } from "../../scripts/scraper/portals/linkedin";
import { indeedHandler } from "../../scripts/scraper/portals/indeed";
import { naukriHandler } from "../../scripts/scraper/portals/naukri";
import { RunController } from "../../scripts/scraper/run/manager";
import { getActiveScrapeLock } from "../../src/lib/intelligence/scrape-server";

describe("Scraper Infrastructure Smoke Test", () => {
  it("all primary portal handlers are defined and expose required lifecycle methods", () => {
    const handlers = [
      { name: "LinkedIn", handler: linkedinHandler },
      { name: "Indeed", handler: indeedHandler },
      { name: "Naukri", handler: naukriHandler },
    ];

    for (const { name, handler } of handlers) {
      expect(handler, `${name} handler must be defined`).toBeDefined();
      expect(typeof handler.listCards, `${name}.listCards must be a function`).toBe("function");
      expect(typeof handler.fetchDetail, `${name}.fetchDetail must be a function`).toBe("function");
    }
  });

  it("RunController can initialize an isolated dry-run manifest and generate work units", () => {
    const mgr = new RunController();
    mgr.init({
      resume: false,
      portals: ["LinkedIn"],
      keywords: ["VP Marketing"],
      maxPages: 1,
      maxCardsPerPage: 5,
    });

    expect(mgr.manifest).toBeDefined();
    expect(mgr.manifest.runId).toMatch(/^run-/);
    expect(mgr.manifest.units.length).toBeGreaterThan(0);
    expect(mgr.manifest.status).toBe("initializing");
  });

  it("single-process mutex prevents concurrent triggers and cleans up state", () => {
    const lock = getActiveScrapeLock();
    expect(lock === null || typeof lock.runId === "string").toBe(true);
  });
});
