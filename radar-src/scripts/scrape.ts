// Top-level orchestrator for the RADAR live scraper.
//
// Pipeline (per the approved plan):
//   Acquisition -> JobSnapshot (per card, cached on disk)
//   Extraction  -> ExtractionResult (deterministic-first, LLM fallback)
//   Assembly    -> RecommendationRecord (schema the app consumes)
//   Persistence -> live-scraped.json (system of record, atomic write)
//
// Resumability is layered on top: a RunManager tracks each unit of work
// (portal × keyword × page and per-card sub-units) in manifest.json plus an
// append-only journal.ndjson. Any crash / SIGINT can resume from the last
// checkpoint, and layer-level caches skip re-scraping / re-extracting when
// artifacts on disk are still fresh.

import { CONFIG, DEFAULT_KEYWORDS, DEFAULT_PORTALS } from "./scraper/config";
import { makeLogger } from "./scraper/utils/logger";
import { pool } from "./scraper/utils/concurrency";
import { jitter } from "./scraper/utils/jitter";
import { RunManager } from "./scraper/run/manager";
import { linkedinHandler } from "./scraper/portals/linkedin";
import { indeedHandler } from "./scraper/portals/indeed";
import { naukriHandler } from "./scraper/portals/naukri";
import { closeAllPortalContexts, getPortalContext } from "./scraper/portals/base";
import type { CardHandle, PortalHandler, PortalName, WorkUnit } from "./scraper/types";
import { extract } from "./scraper/extract/extractor";
import { sanitizeCompanyName } from "./scraper/utils/sanitize";
import {
  readSnapshotIfFresh,
  writeSnapshot,
  readExtractionIfFresh,
  writeExtraction,
  writeLiveScraped,
} from "./scraper/persist/writer";
import { EXTRACTOR_VERSION } from "./scraper/versions";

const HANDLERS: Record<PortalName, PortalHandler> = {
  LinkedIn: linkedinHandler,
  Indeed: indeedHandler,
  Naukri: naukriHandler,
};

export interface RunOptions {
  keywords?: string[];
  portals?: PortalName[];
  maxPages?: number;
  resume?: boolean;
}

export async function run(opts: RunOptions = {}): Promise<{ success: boolean; count: number; runId: string }> {
  const log = makeLogger("scrape");
  const keywords = opts.keywords ?? DEFAULT_KEYWORDS;
  const portals = opts.portals ?? DEFAULT_PORTALS;
  const maxPages = opts.maxPages ?? CONFIG.maxPages;

  const mgr = new RunManager();
  const { resumed } = mgr.init({
    keywords, portals, maxPages,
    maxCardsPerPage: CONFIG.maxCardsPerPage,
    resume: opts.resume !== false,
  });
  log(`Run ${mgr.runId} ${resumed ? "resumed" : "started"} — portals=${portals.join(",")} kw=${keywords.length} pages=${maxPages}`);

  // Graceful shutdown: checkpoints already fsync'd — just close journal + browsers.
  const shutdown = async (signal: string) => {
    log(`Received ${signal}, checkpointing…`, "warn");
    mgr.journal.append({ type: "signal", signal });
    mgr.finalize("aborted");
    await closeAllPortalContexts();
    process.exit(0);
  };
  process.once("SIGINT",  () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  const seenCardKeys = new Set<string>();   // cross-portal dedup

  try {
    // Portals run in parallel — each has its own persistent context.
    await pool(portals, CONFIG.portalConcurrency, async (portal) => {
      const plog = makeLogger(`scrape:${portal}`);
      const handler = HANDLERS[portal];
      const units = mgr.pendingUnits().filter((u) => u.portal === portal);
      if (units.length === 0) { plog("no pending units"); return null; }

      let browserContext: any;
      try { browserContext = await getPortalContext(portal); }
      catch (err: any) { plog(`context launch failed: ${err.message}`, "error"); return null; }

      // Establish session once per portal (handles CAPTCHA / login gate).
      const sessionStatus = await handler.ensureSession({
        portal, keyword: "-", page: 0, searchUrl: "-", browserContext, logger: plog,
      });
      if (sessionStatus !== "ready") {
        plog(`session ${sessionStatus} — skipping portal`, "warn");
        for (const u of units) mgr.updateUnit(u.id, { status: "skipped_gated" });
        return null;
      }

      for (const unit of units) {
        await processUnit(mgr, handler, unit, browserContext, seenCardKeys, plog);
        await jitter();
      }
      return null;
    });

    // Assemble live-scraped.json from all successful extractions in this run.
    const records = collectRecords(mgr);
    if (records.length > 0) {
      writeLiveScraped(records);
      log(`Wrote ${records.length} records to live-scraped.json`);
    } else {
      log("No records produced this run.", "warn");
    }
    mgr.finalize("completed");
    return { success: true, count: records.length, runId: mgr.runId };
  } catch (err: any) {
    log(`Fatal: ${err.message}`, "error");
    mgr.finalize("failed");
    return { success: false, count: 0, runId: mgr.runId };
  } finally {
    await closeAllPortalContexts();
  }
}

async function processUnit(
  mgr: RunManager,
  handler: PortalHandler,
  unit: WorkUnit,
  browserContext: any,
  seenCardKeys: Set<string>,
  log: ReturnType<typeof makeLogger>
): Promise<void> {
  mgr.updateUnit(unit.id, { status: "running", startedAt: new Date().toISOString(), attempts: unit.attempts + 1 });
  mgr.journal.append({ type: "unit_started", unitId: unit.id });

  const searchUrl = handler.buildSearchUrl(unit.keyword, unit.page);
  let cards: CardHandle[] = [];
  try {
    cards = await handler.listCards({
      portal: unit.portal, keyword: unit.keyword, page: unit.page,
      searchUrl, browserContext, logger: log,
    });
  } catch (err: any) {
    log(`listCards failed for ${unit.id}: ${err.message}`, "error");
    mgr.updateUnit(unit.id, { status: "failed", finishedAt: new Date().toISOString(), error: err.message });
    mgr.journal.append({ type: "unit_failed", unitId: unit.id, error: err.message });
    return;
  }

  if (cards.length === 0) {
    mgr.updateUnit(unit.id, { status: "skipped_empty", finishedAt: new Date().toISOString() });
    mgr.journal.append({ type: "unit_empty", unitId: unit.id });
    return;
  }

  const cardMeta = cards.map((c) => ({ id: `${unit.id}#${c.cardHash}`, cardHash: c.cardHash }));
  mgr.addCards(unit.id, cardMeta);

  // Cards for a single unit run in parallel with a bounded pool.
  await pool(cards, CONFIG.cardConcurrency, async (card) => {
    const cardUnitId = `${unit.id}#${card.cardHash}`;
    const cardUnit = mgr.manifest.cards.find((c) => c.id === cardUnitId);
    if (!cardUnit || cardUnit.status === "done") return null;

    mgr.updateCard(cardUnitId, { status: "running", attempts: cardUnit.attempts + 1 });

    try {
      // Layer 1 — Snapshot (cached).
      let snapshot = readSnapshotIfFresh(card.cardHash, CONFIG.snapshotFreshHours);
      if (!snapshot) {
        snapshot = await card.extractSnapshot();
        const p = writeSnapshot(snapshot);
        mgr.updateCard(cardUnitId, { snapshotPath: p });
        mgr.journal.append({ type: "snapshot_written", cardId: cardUnitId, path: p });
      }

      // Cross-portal dedup on (title|company|location).
      const key = [snapshot.card.title, snapshot.card.company, snapshot.card.location]
        .map((s) => (s || "").toLowerCase().trim()).join("|");
      if (seenCardKeys.has(key)) {
        mgr.updateCard(cardUnitId, { status: "skipped_empty" });
        return null;
      }
      seenCardKeys.add(key);

      // Boundary sanitisation — drop unresolvable guest-area rows here.
      const cleanCompany = sanitizeCompanyName(
        snapshot.card.company, snapshot.card.title || "",
        snapshot.card.rawText || "", snapshot.detailUrl
      );
      if (!cleanCompany || !snapshot.card.title) {
        mgr.updateCard(cardUnitId, { status: "skipped_empty" });
        return null;
      }
      snapshot.card.company = cleanCompany;

      // Layer 2 — Extraction (cached, extractor-version guarded).
      let extraction = readExtractionIfFresh(card.cardHash, CONFIG.extractionFreshHours, EXTRACTOR_VERSION);
      if (!extraction) {
        extraction = await extract(snapshot);
        const p = writeExtraction(card.cardHash, extraction);
        mgr.updateCard(cardUnitId, { extractionPath: p });
        mgr.journal.append({
          type: "extraction_written", cardId: cardUnitId,
          jobHash: extraction.jobHash, llmCalled: extraction.telemetry.llmCalled,
        });
      }

      mgr.updateCard(cardUnitId, { status: "done" });
    } catch (err: any) {
      log(`card ${cardUnitId} failed: ${err.message}`, "error");
      mgr.updateCard(cardUnitId, { status: "failed", error: err.message });
      mgr.journal.append({ type: "card_failed", cardId: cardUnitId, error: err.message });
    }
    return null;
  });

  mgr.updateUnit(unit.id, { status: "done", finishedAt: new Date().toISOString() });
  mgr.journal.append({ type: "unit_done", unitId: unit.id });
}

function collectRecords(mgr: RunManager): unknown[] {
  const records: unknown[] = [];
  const seenJobHash = new Set<string>();
  for (const card of mgr.manifest.cards) {
    if (card.status !== "done" || !card.extractionPath) continue;
    try {
      const ex = require("fs").readFileSync(card.extractionPath, "utf-8");
      const parsed = JSON.parse(ex);
      if (seenJobHash.has(parsed.jobHash)) continue;
      seenJobHash.add(parsed.jobHash);
      records.push(parsed);
    } catch { /* corrupted cache — skip */ }
  }
  return records;
}
