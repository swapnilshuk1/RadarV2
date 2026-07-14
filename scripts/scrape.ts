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

import path from "path";
import fs from "fs";
import { CONFIG, DEFAULT_KEYWORDS, DEFAULT_PORTALS, SNAPSHOT_DIR, EXTRACTION_DIR } from "./scraper/config";
import { makeLogger } from "./scraper/utils/logger";
import { pool } from "./scraper/utils/concurrency";
import { jitter } from "./scraper/utils/jitter";
import { RunController } from "./scraper/run/manager";
import { linkedinHandler } from "./scraper/portals/linkedin";
import { indeedHandler } from "./scraper/portals/indeed";
import { naukriHandler } from "./scraper/portals/naukri";
import { closeAllPortalContexts, getPortalContext } from "./scraper/portals/base";
import type { FeedCard, PortalHandler, PortalName, WorkUnit } from "./scraper/types";
import { extract } from "./scraper/extract/extractor";
import { sanitizeCompanyName } from "./scraper/utils/sanitize";
import { normalizeUrl } from "./scraper/utils/url";
import {
  readSnapshotIfFresh,
  writeSnapshot,
  readExtractionIfFresh,
  writeExtraction,
  writeLiveScraped,
} from "./scraper/persist/writer";
import { EXTRACTOR_VERSION, SNAPSHOT_SCHEMA_VERSION, SCRAPER_VERSION } from "./scraper/versions";

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

export async function startRun(opts: RunOptions = {}): Promise<{ runId: string; completion: Promise<{ success: boolean; count: number; runId: string }> }> {
  const log = makeLogger("scrape");
  const keywords = opts.keywords ?? DEFAULT_KEYWORDS;
  const portals = opts.portals ?? DEFAULT_PORTALS;
  const maxPages = opts.maxPages ?? CONFIG.maxPages;

  const mgr = new RunController();
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
  const seenUrls = new Set<string>();       // cross-portal exact URL dedup

  const completion = (async () => {
    try {
      // Phase 1: Initializing
      mgr.transitionTo("initializing");
      const activeContexts = new Map<PortalName, any>();
      const activePages = new Map<PortalName, any>();

      await pool(portals, CONFIG.portalConcurrency, async (portal) => {
        const plog = makeLogger(`scrape:${portal}`);
        const handler = HANDLERS[portal];
        const units = mgr.pendingUnits().filter((u) => u.portal === portal);
        if (units.length === 0) { plog("no pending units"); return null; }

        let browserContext: any;
        try { browserContext = await getPortalContext(portal); }
        catch (err: any) { 
          plog(`context launch failed: ${err.message}`, "error"); 
          mgr.updatePortalHealth(portal, { status: "error", details: err.message });
          return null; 
        }
        
        activeContexts.set(portal, browserContext);
        const pages = browserContext.pages();
        const initialPage = pages.length > 0 ? pages[0] : await browserContext.newPage();
        activePages.set(portal, initialPage);

        const t0 = Date.now();
        const sessionStatus = await handler.ensureSession({
          runId: mgr.runId, portal, keyword: "-", page: 0, searchUrl: "-", browserContext, activePage: initialPage, logger: plog,
        });
        
        if (sessionStatus === "error") {
          plog(`session error — skipping portal`, "warn");
          mgr.updatePortalHealth(portal, { status: "error", details: `Session error` });
          return null;
        }

        if (sessionStatus === "ready") {
          // Navigate to search page so user can visually verify
          const searchUrl = handler.buildSearchUrl(units[0].keyword, units[0].page);
          try {
            mgr.updatePortalHealth(portal, { status: "navigating", details: "Loading search page..." });
            await initialPage.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.navTimeoutMs });
            // Intentionally NOT closing the page here. We leave it open so the user 
            // can visually verify the page, solve captchas, or log in during the pause.
            const elapsed = Date.now() - t0;
            mgr.updatePortalHealth(portal, { status: "ready", details: `Logged in & search loaded (${elapsed}ms)` });
          } catch (err: any) {
            mgr.updatePortalHealth(portal, { status: "error", details: `Search nav failed: ${err.message}` });
          }
        } else if (sessionStatus === "gated") {
          // If gated, ensureSession already left a tab open for manual verification/login.
          mgr.updatePortalHealth(portal, { status: "gated", details: `Waiting for manual login` });
        }
      });

      // Phase 2: Polling Pause
      if (!CONFIG.autoConfirm) {
        mgr.transitionTo("waiting_for_confirmation");
        log("Waiting for user confirmation. (Set AUTO_CONFIRM=true to bypass)");
        const deadline = Date.now() + 15 * 60 * 1000; // 15 mins
        while (true) {
          if (Date.now() > deadline) {
             mgr.transitionTo("aborted");
             log("Run aborted due to 15-minute confirmation timeout.", "error");
             break;
          }
          // Read from disk to get latest state from UI
          let currentManifest = mgr.manifest;
          try {
            currentManifest = JSON.parse(fs.readFileSync(mgr.manifestPath, "utf-8"));
          } catch {}
          if (currentManifest.status === "running") {
             mgr.manifest = currentManifest; // sync in-memory
             log("Confirmation received! Starting execution...");
             break;
          }
          if (currentManifest.status === "aborted") {
             mgr.manifest = currentManifest; // sync in-memory
             log("Run aborted by user.", "error");
             break;
          }
          await new Promise(r => setTimeout(r, 1000));
        }
      } else {
        mgr.transitionTo("running");
      }

      if (mgr.manifest.status === "aborted") {
        mgr.finalize("aborted");
        return { success: false, count: 0, runId: mgr.runId };
      }

      // Phase 3: Execution
      await pool(portals, CONFIG.portalConcurrency, async (portal) => {
        const plog = makeLogger(`scrape:${portal}`);
        const handler = HANDLERS[portal];
        const units = mgr.pendingUnits().filter((u) => u.portal === portal);
        const browserContext = activeContexts.get(portal);
        const activePage = activePages.get(portal);
        if (!browserContext || !activePage) return;

        mgr.updatePortalHealth(portal, { status: "ready", details: "Executing" });
        plog(`Active tabs before execution: ${browserContext.pages().length}`);

        for (const unit of units) {
          await processUnit(mgr, handler, unit, browserContext, activePage, seenCardKeys, seenUrls, plog);
          await jitter();
        }
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

      // Phase 7: ASCII Performance Dashboard
      const runDurationS = ((new Date().getTime() - new Date(mgr.manifest.startedAt).getTime()) / 1000).toFixed(1);
      
      const tm = mgr.manifest.telemetry || { httpAttempted: 0, httpSuccessful: 0, httpFallbacks: 0, llmCalls: 0 };
      const { getLLMQueueStats } = await import("./scraper/extract/extractor");
      const { groqMetrics } = await import("./scraper/enrich/providers/groq");
      const q = getLLMQueueStats();
      
      console.log(`
============================================================
              RADAR SCRAPER RUN COMPLETE
============================================================
⏱️  Wall-clock time:       ${runDurationS}s
📊  Portals processed:     ${portals.length} (${portals.join(", ")})
🎯  Feed cards found:      ${mgr.manifest.cards.length}
✅  Opportunities saved:   ${records.length}
============================================================
           OPTIMIZATION & TELEMETRY SUMMARY
============================================================
HTTP
--------
Attempts:              ${tm.httpAttempted}
Successful:            ${tm.httpSuccessful}
Fallbacks:             ${tm.httpFallbacks}
Browser-only:          ${mgr.manifest.cards.length - tm.httpAttempted}

LLM (Groq)
--------
Queued:                ${q.count}
Average queue wait:    ${(q.avg / 1000).toFixed(1)}s
P95 queue wait:        ${(q.p95 / 1000).toFixed(1)}s
429 retries:           ${groqMetrics.retries429}
Successful enrichments:${groqMetrics.successes}
Failures:              ${groqMetrics.failures}
============================================================
      `);

      return { success: true, count: records.length, runId: mgr.runId };
    } catch (err: any) {
      log(`Fatal: ${err.message}`, "error");
      mgr.finalize("failed");
      return { success: false, count: 0, runId: mgr.runId };
    } finally {
      await closeAllPortalContexts();
    }
  })();

  return { runId: mgr.runId, completion };
}

export async function run(opts: RunOptions = {}): Promise<{ success: boolean; count: number; runId: string }> {
  const { completion } = await startRun(opts);
  return completion;
}

async function processUnit(
  mgr: RunController,
  handler: PortalHandler,
  unit: WorkUnit,
  browserContext: any,
  activePage: any,
  seenCardKeys: Set<string>,
  seenUrls: Set<string>,
  log: ReturnType<typeof makeLogger>
): Promise<void> {
  if (mgr.isPortalDisabled(unit.portal)) {
    mgr.updateUnit(unit.id, { status: "skipped_gated", finishedAt: new Date().toISOString(), error: "Circuit breaker open" });
    return;
  }

  mgr.updateUnit(unit.id, { status: "running", startedAt: new Date().toISOString(), attempts: unit.attempts + 1 });
  mgr.journal.append({ type: "unit_started", unitId: unit.id });

  const searchUrl = handler.buildSearchUrl(unit.keyword, unit.page);
  let cards: FeedCard[] = [];
  try {
    cards = await handler.listCards({
      runId: mgr.runId, portal: unit.portal, keyword: unit.keyword, page: unit.page,
      searchUrl, browserContext, activePage, logger: log,
    });
    
    mgr.recordListingSuccess(unit.portal);
  } catch (err: any) {
    mgr.recordListingFailure(unit.portal);
    
    // Attempt to categorize error for better logs
    let errorCategory = "Unknown";
    const msg = err.message.toLowerCase();
    if (msg.includes("timeout")) errorCategory = "Timeout";
    else if (msg.includes("navigat")) errorCategory = "Navigation";
    else if (msg.includes("selector")) errorCategory = "Selector";
    
    log(`listCards failed for ${unit.id} [${errorCategory}]: ${err.message}`, "error");
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
  await pool(cards, CONFIG.detailConcurrency, async (feedCard) => {
    const cardUnitId = `${unit.id}#${feedCard.cardHash}`;
    const cardUnit = mgr.manifest.cards.find((c) => c.id === cardUnitId);
    if (!cardUnit || cardUnit.status === "done") return null;

    mgr.updateCard(cardUnitId, { status: "running", attempts: cardUnit.attempts + 1 });

    try {
      const normalizedUrl = normalizeUrl(feedCard.detailUrl);
      if (seenUrls.has(normalizedUrl)) {
        mgr.updateCard(cardUnitId, { status: "skipped_empty", error: "Duplicate URL" });
        return null;
      }
      seenUrls.add(normalizedUrl);

      // Layer 1 — Snapshot (cached).
      const snapshotPath = path.join(SNAPSHOT_DIR, `${feedCard.cardHash}.json`);
      const isHistoricallyNew = !fs.existsSync(snapshotPath);
      let detailedCard: import("./scraper/types").DetailedCard | null = null;
      let snapshot = readSnapshotIfFresh(feedCard.cardHash, CONFIG.snapshotFreshHours);
      
      if (!snapshot) {
        // Stage: Detail Extraction
        mgr.journal.append({ type: "detail_extraction_started", cardId: cardUnitId });
        const detail = await handler.fetchDetail({
          runId: mgr.runId, portal: unit.portal, keyword: unit.keyword, page: unit.page,
          searchUrl, browserContext, logger: log,
          isHttpDisabled: (url: string) => mgr.isHttpFastPathDisabled(unit.portal) || mgr.failedHttpUrls.has(url),
          recordHttpFailure: (url: string, reason: string) => mgr.recordDetailFailure(unit.portal, url, reason),
          recordTelemetry: (event: any) => mgr.recordTelemetry(event),
        }, feedCard.detailUrl);
        mgr.journal.append({ type: "detail_extraction_finished", cardId: cardUnitId, durationMs: detail.fetchDurationMs });
        
        detailedCard = {
          ...feedCard,
          snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
          scraperVersion: SCRAPER_VERSION,
          detail,
          telemetry: { cardExtractMs: 0, detailExtractMs: detail.fetchDurationMs || 0, totalMs: detail.fetchDurationMs || 0 },
        };
        
        writeSnapshot(detailedCard);
        mgr.journal.append({ type: "snapshot_written", cardId: cardUnitId, path: snapshotPath });
      } else {
        detailedCard = snapshot;
      }
      mgr.updateCard(cardUnitId, { snapshotPath, isNew: isHistoricallyNew });
      
      if (!detailedCard) return null;

      // Cross-portal dedup on (title|company|location).
      const key = [detailedCard.title, detailedCard.company, detailedCard.location]
        .map((s) => (s || "").toLowerCase().trim()).join("|");
      if (seenCardKeys.has(key)) {
        mgr.updateCard(cardUnitId, { status: "skipped_empty" });
        return null;
      }
      seenCardKeys.add(key);

      // Boundary sanitisation — drop unresolvable guest-area rows here.
      const cleanCompany = sanitizeCompanyName(
        detailedCard.company, detailedCard.title || "",
        detailedCard.rawText || "", detailedCard.detailUrl
      );
      if (!cleanCompany || !detailedCard.title) {
        mgr.updateCard(cardUnitId, { status: "skipped_empty" });
        return null;
      }
      
      // Stage: Filtered Card (Immutable)
      const filteredCard = {
        ...detailedCard,
        company: cleanCompany
      } as import("./scraper/types").DetailedCard;

      // Layer 2 — Extraction (cached, extractor-version guarded).
      const extractionPath = path.join(EXTRACTION_DIR, `${filteredCard.cardHash}.json`);
      let extraction = readExtractionIfFresh(filteredCard.cardHash, CONFIG.extractionFreshHours, EXTRACTOR_VERSION);
      if (!extraction) {
        // Stage: Extraction & Enrichment
        mgr.journal.append({ type: "extraction_started", cardId: cardUnitId });
        extraction = await extract(filteredCard);
        mgr.journal.append({ type: "extraction_finished", cardId: cardUnitId, llmCalled: extraction.telemetry.llmCalled });
        writeExtraction(filteredCard.cardHash, extraction);
        mgr.journal.append({
          type: "extraction_written", cardId: cardUnitId,
          jobHash: extraction.jobHash, llmCalled: extraction.telemetry.llmCalled,
        });
        if (extraction.telemetry.llmCalled) mgr.recordTelemetry("llmCalls");
      }
      mgr.updateCard(cardUnitId, { extractionPath });

      mgr.updateCard(cardUnitId, { status: "done" });
    } catch (err: any) {
      log(`card ${cardUnitId} failed: ${err.message}`, "error");
      mgr.updateCard(cardUnitId, { status: "failed", error: err.message });
      mgr.journal.append({ type: "card_failed", cardId: cardUnitId, error: err.message });
    }
    return null;
  });

  let newJobs = 0;
  let duplicates = 0;
  let currentStreak = 0;
  let maxDuplicateStreak = 0;
  let saved = 0;

  for (const feedCard of cards) {
    const cardUnitId = `${unit.id}#${feedCard.cardHash}`;
    const cu = mgr.manifest.cards.find((c) => c.id === cardUnitId);
    if (!cu) continue;

    if (cu.isNew) {
      newJobs++;
      currentStreak = 0;
    } else {
      duplicates++;
      currentStreak++;
      if (currentStreak > maxDuplicateStreak) maxDuplicateStreak = currentStreak;
    }

    if (cu.extractionPath && fs.existsSync(cu.extractionPath)) {
      saved++;
    }
  }

  const runtimeMs = new Date().getTime() - new Date(mgr.manifest.units.find(u => u.id === unit.id)!.startedAt!).getTime();

  mgr.appendMetric({
    runId: mgr.runId,
    portal: unit.portal,
    keyword: unit.keyword,
    page: unit.page,
    cardsFound: cards.length,
    duplicates,
    newJobs,
    duplicateStreak: maxDuplicateStreak,
    qualified: saved,
    saved,
    runtimeMs
  });

  mgr.updateUnit(unit.id, { status: "done", finishedAt: new Date().toISOString() });
  mgr.journal.append({ type: "unit_done", unitId: unit.id });
}

function collectRecords(mgr: RunController): unknown[] {
  const records: unknown[] = [];
  const seenJobHash = new Set<string>();
  for (const card of mgr.manifest.cards) {
    if (card.status !== "done" || !card.extractionPath) continue;
    try {
      const ex = fs.readFileSync(card.extractionPath, "utf-8");
      const parsed = JSON.parse(ex);
      if (seenJobHash.has(parsed.jobHash)) continue;
      seenJobHash.add(parsed.jobHash);
      records.push(parsed);
    } catch (err: any) { 
      console.error(`collectRecords error for ${card.id}:`, err);
    }
  }
  return records;
}

// Execute if run directly from the CLI
if (import.meta.url.startsWith("file:") && process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() || '')) {
  run().then((res) => {
    if (!res.success) process.exit(1);
  });
}
