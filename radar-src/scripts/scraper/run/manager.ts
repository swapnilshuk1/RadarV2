import fs from "fs";
import path from "path";
import { RUNS_DIR } from "../config";
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

export interface RunManagerOptions {
  keywords: string[];
  portals: PortalName[];
  maxPages: number;
  maxCardsPerPage: number;
  resume: boolean;
}

export class RunManager {
  runId!: string;
  runDir!: string;
  manifestPath!: string;
  journalPath!: string;
  manifest!: RunManifest;
  journal!: Journal;

  init(opts: RunManagerOptions): { resumed: boolean } {
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

    const units: WorkUnit[] = [];
    for (const portal of opts.portals) {
      for (const kw of opts.keywords) {
        for (let p = 1; p <= opts.maxPages; p++) {
          units.push({
            id: `${portal}:${kw}:${p}`,
            portal,
            keyword: kw,
            page: p,
            status: "pending",
            attempts: 0,
            cardIds: [],
          });
        }
      }
    }

    this.manifest = {
      runId: this.runId,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "running",
      scraperVersion: SCRAPER_VERSION,
      snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
      extractorVersion: EXTRACTOR_VERSION,
      recommendationSchemaVersion: RECOMMENDATION_SCHEMA_VERSION,
      keywords: opts.keywords,
      portals: opts.portals,
      maxPages: opts.maxPages,
      maxCardsPerPage: opts.maxCardsPerPage,
      units,
      cards: [],
    };
    this.persistManifest();
    writeJsonAtomic(LATEST_POINTER, { runId: this.runId, manifestVersion: MANIFEST_VERSION });
    this.journal = new Journal(this.journalPath);
    this.journal.append({ type: "run_started", runId: this.runId, opts });
    return { resumed: false };
  }

  private tryLoadForResume(runId: string, opts: RunManagerOptions) {
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

  finalize(status: UnitStatus | "completed" | "failed" | "aborted"): void {
    this.manifest.status = (["completed", "failed", "aborted"].includes(status as string)
      ? status
      : "completed") as RunManifest["status"];
    this.manifest.finishedAt = new Date().toISOString();
    this.persistManifest();
    this.journal.append({ type: "run_finished", status: this.manifest.status });
    this.journal.close();
  }

  private persistManifest(): void {
    writeJsonAtomic(this.manifestPath, this.manifest);
  }
}
