import fs from "fs";
import path from "path";
import crypto from "crypto";
import { RUNS_DIR, SNAPSHOT_DIR, SEARCH_METRICS_NDJSON } from "../config";
import {
  MANIFEST_VERSION,
  SCRAPER_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  EXTRACTOR_VERSION,
  RECOMMENDATION_SCHEMA_VERSION,
} from "../versions";
import type {
  RunManifest,
  WorkUnit,
  CardUnit,
  PortalName,
  UnitStatus,
  AcquisitionVariant,
  RunState,
} from "../types";
import { writeJsonAtomic, readJsonSafe } from "../utils/fs-atomic";
import { Journal } from "./journal";
import { HealthManager } from "./health-manager";

import {
  acquireExclusiveLock,
  releaseExclusiveLock,
  readExclusiveLock,
  defaultIsProcessAlive,
  type ExclusiveLockToken,
  type LockDeps,
} from "./exclusive-lock";

export {
  acquireExclusiveLock,
  releaseExclusiveLock,
  readExclusiveLock,
  defaultIsProcessAlive,
  type ExclusiveLockToken,
  type LockDeps,
};

export type OwnerLock = ExclusiveLockToken;

export function acquireOwnerLock(
  runDir: string,
  runId: string,
  deps: LockDeps = {},
): OwnerLock {
  return acquireExclusiveLock(
    path.join(runDir, ".owner"),
    { runId },
    deps,
  );
}

export function releaseOwnerLock(token: OwnerLock | null | undefined): void;
export function releaseOwnerLock(runDir: string, runId?: string): void;

export function releaseOwnerLock(
  tokenOrRunDir: OwnerLock | string | null | undefined,
  runId?: string,
): void {
  if (!tokenOrRunDir) return;
  if (typeof tokenOrRunDir !== "string") {
    releaseExclusiveLock(tokenOrRunDir);
    return;
  }

  const lockPath = path.join(tokenOrRunDir, ".owner");
  const existing = readExclusiveLock(lockPath);

  if (!existing) return;

  if (runId && existing.runId !== runId) {
    return;
  }

  /*
   * Compatibility cleanup only. Never delete a live owner's lock unless owned by current process.
   */
  const ownedByCurrentProcess =
    existing.pid === process.pid &&
    (!runId || existing.runId === runId);

  if (!ownedByCurrentProcess && defaultIsProcessAlive(existing.pid)) {
    return;
  }

  try {
    fs.unlinkSync(lockPath);
  } catch {}
}

// Where "latest" points so a resume doesn't need a runId argument.
const LATEST_POINTER = path.join(RUNS_DIR, "latest.json");

export interface RunControllerOptions {
  keywords: string[];
  portals: PortalName[];
  maxPages: number;
  maxCardsPerPage: number;
  resume: boolean;
  variants?: AcquisitionVariant[];
  adaptiveDepth?: boolean;
  initialPages?: number;
  searchPlanId?: string;
  snapshotId?: string;
  contextFingerprint?: string;
  variantsSignature?: string;
}

export class RunController {
  runId!: string;
  runDir!: string;
  manifestPath!: string;
  journalPath!: string;
  manifest!: RunManifest;
  journal!: Journal;
  ownerLock?: OwnerLock;

  // Circuit breakers (ephemeral per-run)
  listingFailures: Map<string, number> = new Map();
  failedHttpUrls: Map<string, string> = new Map();
  seenSourceIdentitiesBySurface: Map<string, Set<string>> = new Map();
  lowYieldStreaks: Map<string, number> = new Map();
  private isFinalized: boolean = false;

  static generateRunId(): string {
    return `run-${Date.now()}`;
  }

  initFresh(runId: string, opts: RunControllerOptions): { resumed: boolean } {
    this.runId = runId;
    this.runDir = path.join(RUNS_DIR, this.runId);
    fs.mkdirSync(this.runDir, { recursive: true });

    // Acquire atomic ownership lock before creating manifest or journal
    this.ownerLock = acquireOwnerLock(this.runDir, this.runId);

    this.manifestPath = path.join(this.runDir, "manifest.json");
    this.journalPath = path.join(this.runDir, "journal.ndjson");

    const planPath = path.join(process.cwd(), ".radar", "runs", "ExecutionPlan.json");
    let plan = null;
    if (fs.existsSync(planPath)) {
      plan = readJsonSafe<any>(planPath);
    }

    const units: WorkUnit[] = [];
    
    // An explicit caller-supplied variant set is authoritative. In particular,
    // a controlled validation cohort must never be expanded by a stale local
    // ExecutionPlan artifact.
    if (!opts.variants?.length && plan && plan.workUnits) {
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
          familyId: u.familyId,
          variant: u.variant
        });
      }
    } else {
      const variants: AcquisitionVariant[] = opts.variants && opts.variants.length > 0
        ? opts.variants
        : (opts.keywords ?? []).map((query) => ({ query, channel: "search" as const }));
      const initialPages = opts.initialPages ?? (opts.adaptiveDepth ? 1 : opts.maxPages);
      for (const portal of opts.portals) {
        for (const variant of variants.filter((v) => !v.portal || v.portal === portal)) {
          const kw = variant.query;
          const adhocId = `adhoc:${portal}:${kw.replace(/\s+/g, '-').toLowerCase()}:${variant.location || "global"}`;
          for (let p = 1; p <= initialPages; p++) {
            units.push({
              id: `${portal}:${kw}:${variant.location || "global"}:${p}`,
              portal,
              keyword: kw,
              page: p,
              status: "pending",
              attempts: 0,
              cardIds: [],
              executionPlanId: `plan:${adhocId}`,
              definitionId: variant.definitionId || `def:${adhocId}`,
              familyId: variant.familyId || `fam:${adhocId}`,
              variant: { ...variant, query: kw }
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
      searchPlanId: opts.searchPlanId,
      snapshotId: opts.snapshotId,
      contextFingerprint: opts.contextFingerprint,
      variantsSignature: opts.variantsSignature,
      telemetry: {
        httpAttempted: 0,
        httpSuccessful: 0,
        httpFallbacks: 0,
        duplicatePreDetail: 0,
        duplicatePostDetail: 0,
        llmCalls: 0,
        acquisitionIntegrityFailures: 0,
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

  init(opts: RunControllerOptions): { resumed: boolean } {
    const latest = readJsonSafe<{ runId: string }>(LATEST_POINTER);
    const resumable = opts.resume && latest?.runId
      ? this.tryLoadForResume(latest.runId, opts)
      : null;

    if (resumable) {
      this.attachExistingRun(resumable);
      return { resumed: true };
    }

    return this.initFresh(RunController.generateRunId(), opts);
  }

  attachExistingRun(target: {
    runId: string;
    runDir: string;
    manifestPath: string;
    journalPath: string;
    manifest: RunManifest;
  }): void {
    this.ownerLock = acquireOwnerLock(target.runDir, target.runId);
    this.runId = target.runId;
    this.runDir = target.runDir;
    this.manifestPath = target.manifestPath;
    this.journalPath = target.journalPath;
    this.manifest = target.manifest;
    this.journal = new Journal(this.journalPath);
    this.markResume();
  }

  tryLoadForResume(runId: string, opts: RunControllerOptions): {
    runId: string;
    runDir: string;
    manifestPath: string;
    journalPath: string;
    manifest: RunManifest;
  } | null {
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
      manifest.maxPages !== opts.maxPages ||
      (opts.searchPlanId && manifest.searchPlanId !== opts.searchPlanId) ||
      (opts.snapshotId && manifest.snapshotId !== opts.snapshotId) ||
      (opts.contextFingerprint && manifest.contextFingerprint !== opts.contextFingerprint) ||
      (opts.variantsSignature && manifest.variantsSignature !== opts.variantsSignature)
    ) {
      // Scope changed — new run avoids stale unit set.
      return null;
    }
    if (!RunController.isStatusResumable(manifest.status)) {
      return null;
    }
    return { runId, runDir, manifestPath, journalPath, manifest };
  }

  tryLoadForConfirmationReattach(runId: string, opts: RunControllerOptions): {
    runId: string;
    runDir: string;
    manifestPath: string;
    journalPath: string;
    manifest: RunManifest;
  } | null {
    const runDir = path.join(RUNS_DIR, runId);
    const manifestPath = path.join(runDir, "manifest.json");
    const journalPath = path.join(runDir, "journal.ndjson");
    const manifest = readJsonSafe<RunManifest>(manifestPath);
    if (!manifest) return null;

    if (
      manifest.scraperVersion !== SCRAPER_VERSION ||
      manifest.snapshotSchemaVersion !== SNAPSHOT_SCHEMA_VERSION ||
      manifest.extractorVersion !== EXTRACTOR_VERSION
    ) {
      return null;
    }
    if (
      (opts.searchPlanId && manifest.searchPlanId !== opts.searchPlanId) ||
      (opts.snapshotId && manifest.snapshotId !== opts.snapshotId) ||
      (opts.contextFingerprint && manifest.contextFingerprint !== opts.contextFingerprint) ||
      (opts.variantsSignature && manifest.variantsSignature !== opts.variantsSignature)
    ) {
      return null;
    }
    if (manifest.status !== "waiting_for_confirmation" && manifest.status !== "initializing") {
      return null;
    }
    return { runId, runDir, manifestPath, journalPath, manifest };
  }

  static isStatusResumable(status: RunState): boolean {
    return status === "initializing" || status === "waiting_for_confirmation" || status === "running";
  }

  markResume(): void {
    // Anything left "running" from a prior crashed process becomes "pending"
    // so it gets picked up again by the next scheduling pass.
    for (const u of this.manifest.units) if (u.status === "running") u.status = "pending";
    for (const c of this.manifest.cards) if (c.status === "running") c.status = "pending";
    // NOTE: Keep prior lifecycle state intact! Do NOT force manifest.status = "running"
    this.persistManifest();
  }

  nextPendingUnit(): WorkUnit | undefined {
    return this.manifest.units.find((u) => u.status === "pending");
  }

  nextPendingUnitForPortal(portal: PortalName): WorkUnit | undefined {
    return this.manifest.units.find((u) => u.portal === portal && u.status === "pending");
  }

  pendingUnits(): WorkUnit[] {
    return this.manifest.units.filter((u) => u.status === "pending");
  }

  runningUnits(): WorkUnit[] {
    return this.manifest.units.filter((u) => u.status === "running");
  }

  /** Add a bounded adaptive acquisition surface to the current run. */
  enqueueVariant(variant: AcquisitionVariant, maxPages = this.manifest.maxPages): WorkUnit[] {
    const variantKey = variant.id || `${variant.portal || "all"}:${variant.query}:${variant.location || "global"}:${variant.postedWithinDays || "all"}`;
    const existing = this.manifest.units.filter((u) => {
      const key = u.variant?.id || `${u.portal}:${u.keyword}:${u.variant?.location || "global"}:${u.variant?.postedWithinDays || "all"}`;
      return key === variantKey;
    });
    if (existing.length > 0) return existing;

    const portals = variant.portal ? [variant.portal] : this.manifest.portals;
    const added: WorkUnit[] = [];
    for (const portal of portals) {
      for (let page = 1; page <= maxPages; page++) {
        const id = `adaptive:${variantKey}:${portal}:${page}`;
        const unit: WorkUnit = {
          id,
          portal,
          keyword: variant.query,
          page,
          status: "pending",
          attempts: 0,
          cardIds: [],
          executionPlanId: `adaptive:${variantKey}`,
          definitionId: variant.definitionId || `adaptive:${variantKey}`,
          familyId: `adaptive:${variantKey}`,
          variant: { ...variant, portal },
        };
        this.manifest.units.push(unit);
        added.push(unit);
      }
    }
    if (added.length > 0) this.persistManifest();
    return added;
  }

  /** Add a single adaptive page unit to the manifest if not already present. */
  enqueueAdaptivePageUnit(variant: AcquisitionVariant & { page: number }): WorkUnit | null {
    const portal = (variant.portal || "all") as PortalName;
    const location = variant.location || "global";
    const unitId = `${portal}:${variant.query}:${location}:${variant.page}`;

    if (this.manifest.units.some((u) => u.id === unitId)) {
      return null;
    }

    const adhocId = `adhoc:${portal}:${variant.query.replace(/\s+/g, '-').toLowerCase()}:${location}`;
    const unit: WorkUnit = {
      id: unitId,
      portal,
      keyword: variant.query,
      page: variant.page,
      status: "pending",
      attempts: 0,
      cardIds: [],
      executionPlanId: variant.definitionId ? `plan:${variant.definitionId}` : `plan:${adhocId}`,
      definitionId: variant.definitionId || `def:${adhocId}`,
      familyId: variant.familyId || `fam:${adhocId}`,
      variant: { ...variant, query: variant.query },
    };

    this.manifest.units.push(unit);
    this.persistManifest();
    return unit;
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
    if (this.isFinalized) return;
    this.isFinalized = true;

    this.manifest.status = (["completed", "failed", "aborted"].includes(status as string)
      ? status
      : "completed") as RunManifest["status"];
    this.manifest.finishedAt = new Date().toISOString();
    this.persistManifest();
    this.journal.append({ type: "run_finished", status: this.manifest.status });
    this.journal.close();
    releaseOwnerLock(this.ownerLock);
    this.ownerLock = undefined;
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

    const telemetry = this.manifest.telemetry || {
      httpAttempted: 0,
      httpSuccessful: 0,
      httpFallbacks: 0,
      duplicatePreDetail: 0,
      duplicatePostDetail: 0,
      llmCalls: 0,
      canonicalIngestSuccess: 0,
      canonicalIngestFailure: 0,
      canonicalOpportunitiesIngested: 0,
      canonicalOpportunitiesReused: 0,
      newVersionsCreated: 0,
      duplicateVersionsSuppressed: 0,
      candidatesProjected: 0,
      evaluationJobsEnqueued: 0,
    };

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
Duplicate Filter   : Pre-Detail=${telemetry.duplicatePreDetail || 0}, Post-Detail=${telemetry.duplicatePostDetail || 0}
Canonical Ingestion: Opps Ingested=${telemetry.canonicalOpportunitiesIngested || 0}, Reused=${telemetry.canonicalOpportunitiesReused || 0}, New Versions=${telemetry.newVersionsCreated || 0}, Suppressed=${telemetry.duplicateVersionsSuppressed || 0}
Candidate & Queue  : Candidates Projected=${telemetry.candidatesProjected || 0}, Jobs Enqueued=${telemetry.evaluationJobsEnqueued || 0}, Ingest Failures=${telemetry.canonicalIngestFailure || 0}
================================================================================
`);
  }

  persistManifest(): void {
    writeJsonAtomic(this.manifestPath, this.manifest);
  }

  isCancellationRequested(): boolean {
    try {
      if (fs.existsSync(this.manifestPath)) {
        const diskManifest = JSON.parse(fs.readFileSync(this.manifestPath, "utf-8"));
        if (["stopping", "stopped", "aborted"].includes(diskManifest.status)) {
          this.manifest.status = diskManifest.status;
          return true;
        }
      }
    } catch {}
    return ["stopping", "stopped", "aborted"].includes(this.manifest.status);
  }

  updateCanonicalMetrics(metrics: Partial<RunManifest>): void {
    Object.assign(this.manifest, metrics);
    this.manifest.updatedAt = new Date().toISOString();
    this.persistManifest();
  }

  recordActivity(message: string): void {
    if (!this.manifest) return;
    if (!this.manifest.recentActivities) {
      this.manifest.recentActivities = [];
    }
    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const formatted = `[${ts}] ${message}`;
    this.manifest.recentActivities = [formatted, ...this.manifest.recentActivities.slice(0, 9)];
    this.manifest.updatedAt = new Date().toISOString();
    this.persistManifest();
    try {
      this.journal.append({ type: "activity", message: formatted });
    } catch {}
  }

  transitionTo(state: RunManifest["status"]): void {
    const oldState = this.manifest.status;
    if (oldState === state) return;

    const terminalStates: RunManifest["status"][] = ["completed", "failed", "aborted", "stopped"];
    if (terminalStates.includes(oldState)) {
      console.warn(`[Manager] Rejecting transition from terminal state '${oldState}' to '${state}'.`);
      return;
    }

    const validTransitions: Record<RunManifest["status"], RunManifest["status"][]> = {
      queued: ["queued", "initializing", "running", "failed", "aborted", "stopping", "stopped"],
      initializing: ["initializing", "waiting_for_confirmation", "running", "failed", "aborted", "stopping", "stopped"],
      waiting_for_confirmation: ["running", "aborted", "initializing", "stopping", "stopped"],
      running: ["initializing", "enriching", "completing", "completed", "failed", "aborted", "stopping", "stopped"],
      enriching: ["initializing", "completing", "completed", "failed", "aborted", "stopping", "stopped"],
      stopping: ["stopping", "stopped", "aborted", "failed"],
      completing: ["completing", "completed", "failed", "aborted", "stopping", "stopped"],
      completed: [],
      stopped: [],
      failed: [],
      aborted: []
    };
    if (validTransitions[oldState] && !validTransitions[oldState].includes(state)) {
      console.warn(`[Manager] Unplanned transition from ${oldState} to ${state}, allowing for resilience.`);
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
    HealthManager.recordFastPathFailure(portal, reason);
    
    // Deterministic blockers cache immediately
    if (reason === "403" || reason === "AuthWall") {
       this.failedHttpUrls.set(url, reason);
    }
  }

  recordDetailSuccess(portal: PortalName): void {
    HealthManager.recordFastPathSuccess(portal);
  }

  isHttpFastPathDisabled(portal: PortalName): boolean {
    return !HealthManager.isFastPathAvailable(portal);
  }

  recordTelemetry(
    event:
      | "httpAttempted"
      | "httpSuccessful"
      | "httpFallbacks"
      | "duplicatePreDetail"
      | "duplicatePostDetail"
      | "llmCalls"
      | "m4ShadowPathSuccess"
      | "m4ShadowPathFailure"
      | "canonicalIngestSuccess"
      | "canonicalIngestFailure"
      | "canonicalOpportunitiesIngested"
      | "canonicalOpportunitiesReused"
      | "newVersionsCreated"
      | "duplicateVersionsSuppressed"
      | "candidatesProjected"
      | "evaluationJobsEnqueued"
      | "heuristicDuplicateSuspect"
      | "hardFiltered"
      | "duplicateAtsUrlObserved"
      | "acquisitionIntegrityFailures",
    amount: number = 1
  ): void {
    if (!this.manifest.telemetry) {
      this.manifest.telemetry = {
        httpAttempted: 0,
        httpSuccessful: 0,
        httpFallbacks: 0,
        duplicatePreDetail: 0,
        duplicatePostDetail: 0,
        llmCalls: 0,
        m4ShadowPathSuccess: 0,
        m4ShadowPathFailure: 0,
        canonicalIngestSuccess: 0,
        canonicalIngestFailure: 0,
        canonicalOpportunitiesIngested: 0,
        canonicalOpportunitiesReused: 0,
        newVersionsCreated: 0,
        duplicateVersionsSuppressed: 0,
        candidatesProjected: 0,
        evaluationJobsEnqueued: 0,
        heuristicDuplicateSuspect: 0,
        hardFiltered: 0,
      };
    }
    this.manifest.telemetry[event] = ((this.manifest.telemetry[event] as number) || 0) + amount;
    this.persistManifest();
  }

  getTelemetry(event: keyof NonNullable<RunManifest["telemetry"]>): number {
    return (this.manifest.telemetry?.[event] as number) || 0;
  }
}
