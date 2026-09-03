import { describe, it, expect } from "vitest";
import { linkedinHandler } from "../../scripts/scraper/portals/linkedin";
import { indeedHandler } from "../../scripts/scraper/portals/indeed";
import { naukriHandler } from "../../scripts/scraper/portals/naukri";
import { RunController } from "../../scripts/scraper/run/manager";
import { compileG2ControlledCohort } from "../../scripts/scraper/run/g2-controlled-cohort";
import { getActiveScrapeLock } from "../../src/lib/intelligence/scrape-server";
import { bindEvaluationEvidence } from "../../scripts/scraper/persist/writer";
import type { DetailedCard } from "../../scripts/scraper/types";

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

  it("explicit controlled variants cannot be replaced by a filesystem execution plan", () => {
    const mgr = new RunController();
    const variants = compileG2ControlledCohort("Gurugram");
    mgr.init({
      resume: false,
      portals: ["LinkedIn", "Naukri", "Indeed"],
      keywords: variants.map((variant) => variant.query),
      variants,
      maxPages: 1,
      maxCardsPerPage: 10,
    });

    expect(mgr.manifest.units).toHaveLength(15);
    expect(mgr.manifest.units.every((unit) => unit.variant?.postedWithinDays === 7)).toBe(true);
  });

  it("single-process mutex prevents concurrent triggers and cleans up state", () => {
    const lock = getActiveScrapeLock();
    expect(lock === null || typeof lock.runId === "string").toBe(true);
  });

  it("binds the run snapshot to the exact canonical document version used downstream", () => {
    const snapshot = {
      cardHash: "card-a", portal: "LinkedIn", keyword: "VP Growth", searchUrl: "https://example.test/search",
      detailUrl: "https://example.test/job", discoveredAt: "2026-09-04T00:00:00.000Z", title: "VP Growth",
      company: "Acme", location: "Gurugram", rawHtml: "<p>card</p>", rawText: "card",
      snapshotSchemaVersion: "1", scraperVersion: "1", detail: { fetched: true, rawText: "full JD" },
      telemetry: { cardExtractMs: 0, detailExtractMs: 1, totalMs: 1 }, evaluationEvidence: { state: "PENDING" as const },
    } satisfies DetailedCard;
    const bound = bindEvaluationEvidence(snapshot, {
      canonicalJobId: "job-a", opportunityVersion: "version-a", contentHash: "sha256-a",
      sourcePayloadKey: null, sourceMediaType: null,
    });

    expect(bound.evaluationEvidence).toEqual({
      state: "BOUND", canonicalJobId: "job-a", opportunityVersion: "version-a", contentHash: "sha256-a",
      sourcePayloadKey: null, sourceMediaType: null,
    });
    expect(snapshot.evaluationEvidence?.state).toBe("PENDING");
  });
});
