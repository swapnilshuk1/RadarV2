import fs from "fs";
import path from "path";
import { RUNS_DIR, SNAPSHOT_DIR, SEARCH_METRICS_NDJSON } from "../config";
import {
  MANIFEST_VERSION,
  SCRAPER_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  EXTRACTOR_VERSION,
  RECOMMENDATION_SCHEMA_VERSION,
} from "../versions";
import type { RunManifest, WorkUnit, CardUnit, PortalName, UnitStatus } from "../types";
import { writeJsonAtomic, readJsonSafe } from "../utils/fs-atomic";
import { Journal } from "./journal";

// Where "latest" points so a resume doesn't need a runId argument.
const LATEST_POINTER = path.join(RUNS_DIR, "latest.json");

export interface RunControllerOptions {
  keywords: string[];
  portals: PortalName[];
  maxPages: number;
  maxCardsPerPage: number;
  resume: boolean;
}

export class RunController {
  runId!: string;
  runDir!: string;
  manifestPath!: string;
  journalPath!: string;
  manifest!: RunManifest;
  journal!: Journal;

  // Circuit breakers (ephemeral per-run)
  listingFailures: Map<string, number> = new Map();
  detailFailures: Map<string, number> = new Map();
  failedHttpUrls: Map<string, string> = new Map();

  init(opts: RunControllerOptions): { resumed: boolean } {
    const latest = readJsonSafe<{ runId: string }>(LATEST_POINTER);
    const resumable = opts.resume && latest?.runId
      ? this.tryLoadForResume(latest.runId, opts)
      : null;

    if (resumable) {
      this.runId = resumable.runId;
      this.runDir = resumable.runDir;
      this.manifestPath = resumable.manifestPath;
      this.journalPath = resumable.journalPath;
      this.manifest = resumable.manifest;
      this.journal = new Journal(this.journalPath);
      this.markResume();
      return { resumed: true };
    }

    this.runId = `run-${Date.now()}`;
    this.runDir = path.join(RUNS_DIR, this.runId);
    fs.mkdirSync(this.runDir, { recursive: true });
    this.manifestPath = path.join(this.runDir, "manifest.json");
    this.journalPath = path.join(this.runDir, "journal.ndjson");

    const planPath = path.join(process.cwd(), ".radar", "runs", "ExecutionPlan.json");
    let plan = null;
    if (fs.existsSync(planPath)) {
      plan = readJsonSafe<any>(planPath);
    }

    const units: WorkUnit[] = [];
    
    if (plan && plan.workUnits) {
      console.log(`Loading ${plan.workUnits.length} units from ExecutionPlan.json...`);
      for (const u of plan.workUnits) {
        units.push({
          id: u.id,
          portal: u.portal as PortalName,
          keyword: u.keyword,
          page: u.page,
          status: "pending",
          attempts: 0,
          cardIds: [],
          executionPlanId: plan.id || "unknown-plan",
          definitionId: u.definitionId,
          familyId: u.familyId
        });
      }
    } else {
      for (const portal of opts.portals) {
        for (const kw of opts.keywords) {
          const adhocId = `adhoc:${portal}:${kw.replace(/\s+/g, '-').toLowerCase()}`;
          for (let p = 1; p <= opts.maxPages; p++) {
            units.push({
              id: `${portal}:${kw}:${p}`,
              portal,
              keyword: kw,
              page: p,
              status: "pending",
              attempts: 0,
              cardIds: [],
              executionPlanId: `plan:${adhocId}`,
              definitionId: `def:${adhocId}`,
              familyId: `fam:${adhocId}`
            });
          }
        }
      }
    }

    this.manifest = {
      runId: this.runId,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "initializing",
      scraperVersion: SCRAPER_VERSION,
      snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
      extractorVersion: EXTRACTOR_VERSION,
      recommendationSchemaVersion: RECOMMENDATION_SCHEMA_VERSION,
      keywords: opts.keywords,
      portals: opts.portals,
      maxPages: opts.maxPages,
      maxCardsPerPage: opts.maxCardsPerPage,
      telemetry: {
        httpAttempted: 0,
        httpSuccessful: 0,
        httpFallbacks: 0,
        llmCalls: 0,
      },
      pageExecutionRecords: [],
      units,
      cards: [],
    };
    this.persistManifest();
    writeJsonAtomic(LATEST_POINTER, { runId: this.runId, manifestVersion: MANIFEST_VERSION });
    this.journal = new Journal(this.journalPath);
    this.journal.append({ type: "run_started", runId: this.runId, opts });
    return { resumed: false };
  }

  private tryLoadForResume(runId: string, opts: RunControllerOptions) {
    const runDir = path.join(RUNS_DIR, runId);
    const manifestPath = path.join(runDir, "manifest.json");
    const journalPath = path.join(runDir, "journal.ndjson");
    const manifest = readJsonSafe<RunManifest>(manifestPath);
    if (!manifest) return null;

    // Version-compat gate: if extractor or snapshot schema moved, start fresh.
    if (
      manifest.scraperVersion !== SCRAPER_VERSION ||
      manifest.snapshotSchemaVersion !== SNAPSHOT_SCHEMA_VERSION ||
      manifest.extractorVersion !== EXTRACTOR_VERSION
    ) {
      return null;
    }
    if (
      JSON.stringify(manifest.keywords) !== JSON.stringify(opts.keywords) ||
      JSON.stringify(manifest.portals) !== JSON.stringify(opts.portals) ||
      manifest.maxPages !== opts.maxPages
    ) {
      // Scope changed — new run avoids stale unit set.
      return null;
    }
    if (manifest.status === "completed") return null;
    return { runId, runDir, manifestPath, journalPath, manifest };
  }

  private markResume(): void {
    // Anything left "running" from a prior crashed process becomes "pending"
    // so it gets picked up again by the next scheduling pass.
    for (const u of this.manifest.units) if (u.status === "running") u.status = "pending";
    for (const c of this.manifest.cards) if (c.status === "running") c.status = "pending";
    this.manifest.status = "running";
    this.persistManifest();
  }

  nextPendingUnit(): WorkUnit | undefined {
    return this.manifest.units.find((u) => u.status === "pending");
  }

  pendingUnits(): WorkUnit[] {
    return this.manifest.units.filter((u) => u.status === "pending");
  }

  updateUnit(unitId: string, patch: Partial<WorkUnit>): void {
    const u = this.manifest.units.find((x) => x.id === unitId);
    if (!u) return;
    Object.assign(u, patch);
    this.manifest.updatedAt = new Date().toISOString();
    this.persistManifest();
  }

  addCards(parentUnitId: string, cards: Omit<CardUnit, "parentUnitId" | "status" | "attempts">[]): CardUnit[] {
    const added: CardUnit[] = [];
    for (const c of cards) {
      if (this.manifest.cards.find((x) => x.id === c.id)) continue;
      const cu: CardUnit = { ...c, parentUnitId, status: "pending", attempts: 0 };
      this.manifest.cards.push(cu);
      added.push(cu);
    }
    const parent = this.manifest.units.find((u) => u.id === parentUnitId);
    if (parent) parent.cardIds = [...new Set([...parent.cardIds, ...cards.map((c) => c.id)])];
    this.persistManifest();
    return added;
  }

  updateCard(cardId: string, patch: Partial<CardUnit>): void {
    const c = this.manifest.cards.find((x) => x.id === cardId);
    if (!c) return;
    Object.assign(c, patch);
    this.manifest.updatedAt = new Date().toISOString();
    this.persistManifest();
  }

  cardsForUnit(unitId: string): CardUnit[] {
    return this.manifest.cards.filter((c) => c.parentUnitId === unitId);
  }

  appendMetric(metric: import("../types").PageExecutionRecord): void {
    if (!this.manifest.pageExecutionRecords) this.manifest.pageExecutionRecords = [];
    this.manifest.pageExecutionRecords.push(metric);
    this.persistManifest();
    
    // Also append directly to the NDJSON sink
    fs.appendFileSync(SEARCH_METRICS_NDJSON, JSON.stringify(metric) + "\n");
  }

  finalize(status: UnitStatus | "completed" | "failed" | "aborted"): void {
    this.manifest.status = (["completed", "failed", "aborted"].includes(status as string)
      ? status
      : "completed") as RunManifest["status"];
    this.manifest.finishedAt = new Date().toISOString();
    this.persistManifest();
    this.journal.append({ type: "run_finished", status: this.manifest.status });
    this.journal.close();
    this.printRunHealthDashboard();
  }

  printRunHealthDashboard(): void {
    const start = new Date(this.manifest.startedAt || Date.now()).getTime();
    const end = this.manifest.finishedAt ? new Date(this.manifest.finishedAt).getTime() : Date.now();
    const elapsedSec = Math.floor((end - start) / 1000);
    const elapsedFormatted = `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`;

    const totalUnits = this.manifest.units.length;
    const completedUnits = this.manifest.units.filter((u) => u.status === "done" || u.status === "skipped_empty" || u.status === "skipped_gated" || u.status === "skipped_pruned").length;
    const cardsDiscovered = this.manifest.cards.length;

    const portalBreakdown: Record<string, number> = {};
    for (const u of this.manifest.units) {
      if (u.cardIds && u.cardIds.length > 0) {
        portalBreakdown[u.portal] = (portalBreakdown[u.portal] || 0) + u.cardIds.length;
      }
    }

    const telemetry = this.manifest.telemetry || { httpAttempted: 0, httpSuccessful: 0, httpFallbacks: 0, llmCalls: 0 };

    console.log(`
================================================================================
                       RADAR RUN HEALTH DASHBOARD
================================================================================
Run ID             : ${this.runId}
Status             : ${(this.manifest.status || "completed").toUpperCase()}
Elapsed Time       : ${elapsedFormatted}
Work Units         : ${completedUnits} / ${totalUnits} units executed
Cards Discovered   : ${cardsDiscovered} total
Portal Yield       : ${Object.entries(portalBreakdown).map(([p, count]) => `${p}=${count}`).join(" | ") || "None"}
FastPath Telemetry : Attempted=${telemetry.httpAttempted}, Success=${telemetry.httpSuccessful}, Fallbacks=${telemetry.httpFallbacks}
================================================================================
`);
  }

  private persistManifest(): void {
    writeJsonAtomic(this.manifestPath, this.manifest);
  }

  transitionTo(state: RunManifest["status"]): void {
    const oldState = this.manifest.status;
    if (oldState === state) return;
    const validTransitions: Record<RunManifest["status"], RunManifest["status"][]> = {
      initializing: ["initializing", "waiting_for_confirmation", "running", "failed", "aborted"],
      waiting_for_confirmation: ["running", "aborted", "initializing"],
      running: ["initializing", "enriching", "completed", "failed", "aborted"],
      enriching: ["initializing", "completed", "failed", "aborted"],
      completed: ["initializing"],
      failed: ["initializing"],
      aborted: ["initializing"]
    };
    if (!validTransitions[oldState].includes(state)) {
      throw new Error(`Invalid state transition from ${oldState} to ${state}`);
    }
    this.manifest.status = state;
    this.manifest.updatedAt = new Date().toISOString();
    this.persistManifest();
    this.journal.append({ type: "state_transition", from: oldState, to: state });
  }

  updatePortalHealth(portal: PortalName, patch: Partial<import("../types").PortalHealth>): void {
    if (!this.manifest.portalHealth) this.manifest.portalHealth = {};
    const ph = this.manifest.portalHealth[portal] || { status: "ready", score: 100, details: "" };
    Object.assign(ph, patch);
    this.manifest.portalHealth[portal] = ph;
    this.manifest.updatedAt = new Date().toISOString();
    this.persistManifest();
  }

  recordListingFailure(portal: PortalName): void {
    const fails = (this.listingFailures.get(portal) || 0) + 1;
    this.listingFailures.set(portal, fails);
    if (fails >= 2) {
      this.updatePortalHealth(portal, { status: "error", details: "Circuit breaker open", score: 0 });
    }
  }

  recordListingSuccess(portal: PortalName): void {
    this.listingFailures.delete(portal);
  }

  isPortalDisabled(portal: PortalName): boolean {
    return (this.listingFailures.get(portal) || 0) >= 2;
  }

  recordDetailFailure(portal: PortalName, url: string, reason: string): void {
    const fails = (this.detailFailures.get(portal) || 0) + 1;
    this.detailFailures.set(portal, fails);
    
    // Deterministic blockers cache immediately
    if (reason === "403" || reason === "AuthWall") {
       this.failedHttpUrls.set(url, reason);
    }
  }

  recordDetailSuccess(portal: PortalName): void {
    this.detailFailures.delete(portal);
  }

  isHttpFastPathDisabled(portal: PortalName): boolean {
    return (this.detailFailures.get(portal) || 0) >= 10;
  }

  recordTelemetry(event: "httpAttempted" | "httpSuccessful" | "httpFallbacks" | "llmCalls"): void {
    if (!this.manifest.telemetry) {
      this.manifest.telemetry = { httpAttempted: 0, httpSuccessful: 0, httpFallbacks: 0, llmCalls: 0 };
    }
    this.manifest.telemetry[event]++;
    this.persistManifest(); // Note: This might be chatty, but we want to ensure it's saved.
  }
}
