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
import { RunController, type RunControllerOptions } from "./scraper/run/manager";
import { linkedinHandler } from "./scraper/portals/linkedin";
import { indeedHandler } from "./scraper/portals/indeed";
import { naukriHandler } from "./scraper/portals/naukri";
import { closeAllPortalContexts, getPortalContext } from "./scraper/portals/base";
import { PageManager } from "./scraper/run/page-manager";
import type { FeedCard, PortalHandler, PortalName, WorkUnit } from "./scraper/types";

import { sanitizeCompanyName } from "./scraper/utils/sanitize";
import { normalizeUrl } from "./scraper/utils/url";
import { EnrichmentQueue } from "./scraper/persist/queue";
import { resolveCanonicalIdentity } from "../src/lib/acquisition/canonical-identity";
import { FailurePolicyEngine } from "../src/lib/acquisition/failure-taxonomy";
import { ResponseValidator } from "../src/lib/acquisition/validator";
import { CheapFilter } from "./scraper/run/cheap-filter";
import { HealthManager } from "./scraper/run/health-manager";
import { QueryMetricsStore } from "./scraper/run/metrics";
import { getRepositories } from "../src/data/sqlite/provider";

import {
  readSnapshotIfFresh,
  writeSnapshot,
  writeLiveScraped,
} from "./scraper/persist/writer";
import { EXTRACTOR_VERSION, EXTRACTOR_PROMPT_VERSION, SNAPSHOT_SCHEMA_VERSION, SCRAPER_VERSION, CATALOG_VERSION, PLANNER_VERSION, RULE_VERSION, TELEMETRY_SCHEMA_VERSION } from "./scraper/versions";

const HANDLERS: Record<PortalName, PortalHandler> = {
  LinkedIn: linkedinHandler,
  Indeed: indeedHandler,
  Naukri: naukriHandler,
};

const enrichmentQueue = new EnrichmentQueue();

export function syncManifestProgress(
  mgr: RunController,
  stage?: "discover" | "evaluate" | "prioritize" | "complete" | "stopped" | "failed"
) {
  const cardsFound = mgr.manifest.cards.length;
  let evaluated = 0;
  try {
    const stats = enrichmentQueue.getRunStats(mgr.runId);
    evaluated = stats?.completed || 0;
  } catch {}

  const currentStage =
    stage ||
    (mgr.manifest.status === "enriching"
      ? "evaluate"
      : mgr.manifest.status === "completed"
        ? "complete"
        : mgr.manifest.status === "stopped" || mgr.manifest.status === "stopping" || mgr.manifest.status === "aborted"
          ? "stopped"
          : mgr.manifest.status === "failed"
            ? "failed"
            : "discover");

  const sources: Record<string, "pending" | "searching" | "completed" | "failed"> = {};
  for (const portal of mgr.manifest.portals) {
    const units = mgr.manifest.units.filter((u) => u.portal === portal);
    const hasRunning = units.some((u) => u.status === "running");
    const allDone = units.every((u) => u.status === "done" || u.status.startsWith("skipped"));
    if (hasRunning) sources[portal] = "searching";
    else if (allDone && units.length > 0) sources[portal] = "completed";
    else sources[portal] = "pending";
  }

  mgr.updateCanonicalMetrics({
    opportunitiesFound: cardsFound,
    evaluatedCount: evaluated,
    remainingCount: Math.max(0, cardsFound - evaluated),
    stage: currentStage,
    sources,
  });
}

export interface RunOptions {
  keywords?: string[];
  portals?: PortalName[];
  maxPages?: number;
  resume?: boolean;
  autoConfirm?: boolean;
}

export async function startRun(opts: RunOptions = {}): Promise<{ runId: string; completion: Promise<{ success: boolean; count: number; runId: string }> }> {
  const log = makeLogger("scrape");
  let keywords = opts.keywords;
  if (!keywords) {
    try {
      const profilePath = path.join(process.cwd(), "src", "data", "candidate-profile.json");
      const taxonomyPath = path.join(process.cwd(), "config", "ontologies", "taxonomy.json");
      const lexiconPath = path.join(process.cwd(), "config", "ontologies", "lexicon.json");
      const searchPlanOutputPath = path.join(process.cwd(), "src", "data", "search-plan.json");
      
      const { CareerIntentModel } = await import("./scraper/run/career-intent");
      const intent = CareerIntentModel.extractIntent(profilePath, taxonomyPath);
      
      const { SearchPlanner } = await import("./scraper/run/search-planner");
      const searchPlan = SearchPlanner.plan(intent, taxonomyPath, lexiconPath);
      
      fs.writeFileSync(searchPlanOutputPath, JSON.stringify(searchPlan, null, 2), "utf-8");
      log(`Generated and persisted Search Plan first-class artifact to: ${searchPlanOutputPath}`);
      
      // Select all ranked queries to fully capture the environment!
      keywords = searchPlan.rankedQueries.map(q => q.query);
      log(`Search Planner compiled all ${keywords.length} portal queries: ${keywords.join(", ")}`);
    } catch (e: any) {
      log(`Search Planner failed to dynamically generate Search Plan (${e.message}). Falling back to static defaults.`, "warn");
      keywords = DEFAULT_KEYWORDS;
    }
  }
  let portals = opts.portals ?? DEFAULT_PORTALS;
  const maxPages = opts.maxPages ?? CONFIG.maxPages;

  // Command-line override support for agile, diverse crawl runs
  const keywordsArg = process.argv.find(arg => arg.startsWith('--keywords='));
  if (keywordsArg) {
    keywords = keywordsArg.split('=')[1].split(',').map(k => k.trim());
  }
  const portalsArg = process.argv.find(arg => arg.startsWith('--portals='));
  if (portalsArg) {
    portals = portalsArg.split('=')[1].split(',').map(p => p.trim() as PortalName);
  }

  const freshRun = process.argv.includes('--fresh') || process.env.FRESH_RUN === 'true';
  const mgr = new RunController();
  const { resumed } = mgr.init({
    keywords, portals, maxPages,
    maxCardsPerPage: CONFIG.maxCardsPerPage,
    resume: freshRun ? false : (opts.resume !== false),
  });
  const plannedUnits = mgr.manifest.units.length;
  log(`Run ${mgr.runId} ${resumed ? "resumed" : "started"} — portals=${mgr.manifest.portals.join(",")} units=${plannedUnits}`);

  // Graceful shutdown: checkpoints already fsync'd — just close journal + browsers.
  const shutdown = async (signal: string) => {
    log(`Received ${signal}, checkpointing…`, "warn");
    mgr.journal.append({ type: "signal", signal });
    mgr.finalize("aborted");
    await closeAllPortalContexts();
    
    try {
      const records = collectRecords();
      writeLiveScraped(records);
      log(`Rebuilt live-scraped.json with ${records.length} total records on shutdown.`);
    } catch (e: any) {
      log(`Failed to write live-scraped on shutdown: ${e.message}`, "error");
    }
    
    process.exit(0);
  };
  process.once("SIGINT",  () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  const seenCardKeys = new Set<string>();   // cross-portal dedup
  const seenUrls = new Set<string>();       // cross-portal exact URL dedup
  const seenCanonicalIds = new Set<string>(); // cross-portal canonical ID dedup

  const completion = (async () => {
    try {
      // Phase 1: Initializing
      mgr.transitionTo("initializing");

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
        const pageManager = new PageManager(portal, browserContext);
        activePageManagers.set(portal, pageManager);
        const { searchPage, detailPage, searchMutex, detailMutex } = await pageManager.initialize();
        activePages.set(portal, searchPage);

        const t0 = Date.now();
        const sessionStatus = await handler.ensureSession({
          runId: mgr.runId, portal, keyword: "-", page: 0, searchUrl: "-", browserContext,
          searchPage, detailPage, searchMutex, detailMutex, pageManager, activePage: searchPage, logger: plog,
        });
        
        if (sessionStatus === "error") {
          plog(`session error — skipping portal`, "warn");
          mgr.updatePortalHealth(portal, { status: "error", details: `Session error` });
          activeContexts.delete(portal);
          activePages.delete(portal);
          return null;
        }

        if (sessionStatus === "ready") {
          // Navigate to search page so user can visually verify
          const searchUrl = handler.buildSearchUrl(units[0].keyword, units[0].page);
          try {
            mgr.updatePortalHealth(portal, { status: "navigating", details: "Loading search page..." });
            await searchPage.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.navTimeoutMs });
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
      const autoConfirm = opts.autoConfirm ?? CONFIG.autoConfirm;
      if (!autoConfirm) {
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
      const poolResults = await pool(portals, CONFIG.portalConcurrency, async (portal) => {
        const plog = makeLogger(`scrape:${portal}`);
        const handler = HANDLERS[portal];
        const units = mgr.pendingUnits().filter((u) => u.portal === portal);
        const browserContext = activeContexts.get(portal);
        const activePage = activePages.get(portal);
        if (!browserContext || !activePage) return;

        mgr.updatePortalHealth(portal, { status: "ready", details: "Executing" });
        plog(`Active tabs before execution: ${browserContext.pages().length}`);

        let portalIngested = 0;
        let portalFacts = 0;

        for (const unit of units) {
          if (mgr.isCancellationRequested()) {
             plog("Run cancellation requested (stopping/aborted). Halting portal unit loop.", "warn");
             break;
          }

          // Adaptive Novelty Scheduler: Skip query page if historical novelty rate is < 5% on this portal (after page 1)
          if (unit.page > 1) {
            const avgNovelty = QueryMetricsStore.getAverageNoveltyRate(unit.portal, unit.keyword);
            if (avgNovelty < 0.05) {
              plog(`Adaptive Scheduler: Pruning page ${unit.page} for "${unit.keyword}" on ${unit.portal} (historical novelty ${(avgNovelty * 100).toFixed(1)}%)`, "info");
              mgr.updateUnit(unit.id, { status: "skipped_pruned", error: "Pruned by adaptive novelty scheduler (<5% historical novelty)" });
              continue;
            }
          }

          const outcome = await processUnit(mgr, handler, unit, browserContext, activePage, seenCardKeys, seenUrls, seenCanonicalIds, plog);
          if (outcome) {
            portalIngested += outcome.opportunities;
            portalFacts += outcome.factsCreated;
          }
          syncManifestProgress(mgr, "discover");
          await jitter();
        }
        return { portalIngested, portalFacts };
      });

      let ingestedCount = 0;
      let totalFacts = 0;
      for (const res of poolResults) {
        if (res && !(res instanceof Error)) {
          ingestedCount += res.portalIngested;
          totalFacts += res.portalFacts;
        }
      }

      log(`Enqueued ${ingestedCount} cards for enrichment.`);

      // Certification: Ensure no units are left running
      const runningUnits = mgr.manifest.units.filter(u => u.status === "running");
      if (runningUnits.length > 0) {
        log(`CERTIFICATION FAILED: ${runningUnits.length} units are stuck in running state!`, "error");
        mgr.manifest.status = "failed";
        mgr.finalize("failed");
      }

      // Transition to enriching state so the UI tracks it in real-time
      mgr.transitionTo("enriching");
      
      try {
        log(`[Scrape] Automatically starting inline AI enrichment for run ${mgr.runId}...`);
        const { enrichJobsForRun } = await import("./enrich");
        await enrichJobsForRun(mgr.runId);
      } catch (enrichErr: any) {
        log(`[Scrape] Enrichment phase failed: ${enrichErr.message}`, "error");
      }

      // Rebuild read models and JSON models
      try {
        log(`[Scrape] Rebuilding SQLite read models...`);
        const { runRebuildReadModels } = await import("./rebuild-read-models");
        runRebuildReadModels();

        const records = collectRecords();
        writeLiveScraped(records);
        log(`Rebuilt live-scraped.json cache with ${records.length} total records.`);
      } catch (rebuildErr: any) {
        log(`[Scrape] Rebuild phase failed: ${rebuildErr.message}`, "error");
      }

      mgr.finalize("completed");
      const runDurationS = ((new Date().getTime() - new Date(mgr.manifest.startedAt).getTime()) / 1000).toFixed(1);
      
      const tm = mgr.manifest.telemetry || { httpAttempted: 0, httpSuccessful: 0, httpFallbacks: 0, llmCalls: 0 };
      
      const { generateAcquisitionReport } = await import("./scraper/run/report");
      generateAcquisitionReport(mgr.runId);

      printAcquisitionTelemetry(mgr);


      console.log(`
============================================================
              RADAR SCRAPER RUN COMPLETE
============================================================
⏱️  Wall-clock time:       ${runDurationS}s
📊  Portals processed:     ${portals.length} (${portals.join(", ")})
🎯  Feed cards found:      ${mgr.manifest.cards.length}
✅  Opportunities saved:   ${ingestedCount}
============================================================
           OPTIMIZATION & TELEMETRY SUMMARY
============================================================
HTTP
--------
Attempts:              ${tm.httpAttempted}
Successful:            ${tm.httpSuccessful}
Fallbacks:             ${tm.httpFallbacks}
Browser-only:          ${mgr.manifest.cards.length - tm.httpAttempted}
============================================================
      `);

      return { success: true, count: ingestedCount, runId: mgr.runId };
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

const activeContexts = new Map<PortalName, any>();
const activePages = new Map<PortalName, any>();
const activePageManagers = new Map<PortalName, PageManager>();

export async function runScraper(opts: Partial<RunControllerOptions> = {}): Promise<{ success: boolean; count: number; runId: string }> {
  const { completion } = await startRun(opts);
  return completion;
}

export type ProcessOutcome = {
  status: "completed" | "failed" | "skipped_gated" | "skipped_empty";
  listingCount: number;
  detailCount: number;
  opportunities: number;
  factsCreated: number;
  telemetryErrors: number;
  newJobs: number;
  duplicates: number;
  warnings: string[];
};

// Track consecutive low-yield pages per definition
const lowYieldTracking = new Map<string, number>();

async function processUnit(
  mgr: RunController,
  handler: PortalHandler,
  unit: WorkUnit,
  browserContext: any,
  activePage: any,
  seenCardKeys: Set<string>,
  seenUrls: Set<string>,
  seenCanonicalIds: Set<string>,
  log: ReturnType<typeof makeLogger>
): Promise<ProcessOutcome> {
  const outcome: ProcessOutcome = {
    status: "failed",
    listingCount: 0,
    detailCount: 0,
    opportunities: 0,
    factsCreated: 0,
    telemetryErrors: 0,
    newJobs: 0,
    duplicates: 0,
    warnings: [],
  };

  if (mgr.isPortalDisabled(unit.portal)) {
    mgr.updateUnit(unit.id, { status: "skipped_gated", finishedAt: new Date().toISOString(), error: "Circuit breaker open" });
    outcome.status = "skipped_gated";
    return outcome;
  }

  const latestUnitState = mgr.manifest.units.find(u => u.id === unit.id);
  if (latestUnitState && latestUnitState.status !== "pending") {
    log(`Skipping unit ${unit.id} as it is no longer pending (status: ${latestUnitState.status})`, "info");
    outcome.status = latestUnitState.status as any;
    return outcome;
  }

  mgr.updateUnit(unit.id, { status: "running", startedAt: new Date().toISOString(), attempts: unit.attempts + 1 });
  try {
    const searchUrl = handler.buildSearchUrl(unit.keyword, unit.page);
    let cards: FeedCard[] = [];
    const pm = activePageManagers.get(unit.portal);
    
    try {
      cards = await handler.listCards({
        runId: mgr.runId, portal: unit.portal, keyword: unit.keyword, page: unit.page,
        searchUrl, browserContext,
        searchPage: pm?.getPage("search") || activePage,
        detailPage: pm?.getPage("detail"),
        searchMutex: pm?.getMutex("search"),
        detailMutex: pm?.getMutex("detail"),
        pageManager: pm,
        activePage: pm?.getPage("search") || activePage,
        logger: log,
      });
      mgr.recordListingSuccess(unit.portal);
    } catch (err: any) {
      mgr.recordListingFailure(unit.portal);
      let errorCategory = "Unknown";
      const msg = err.message.toLowerCase();
      if (msg.includes("timeout")) errorCategory = "Timeout";
      else if (msg.includes("navigat")) errorCategory = "Navigation";
      else if (msg.includes("selector")) errorCategory = "Selector";
      else if (msg.includes("blocked")) errorCategory = "Blocked";
      
      if (errorCategory === "Blocked") {
        mgr.updatePortalHealth(unit.portal, { status: "error", details: "Blocked by anti-bot", score: 0 });
      }
      
      log(`listCards failed for ${unit.id} [${errorCategory}]: ${err.message}`, "error");
      outcome.status = "failed";
      outcome.warnings.push(`listCards failed: ${err.message}`);
      return outcome;
    }

    outcome.listingCount = cards.length;

    if (cards.length === 0) {
      outcome.status = "skipped_empty";
      return outcome;
    }

    const cardMeta = cards.map((c) => ({ id: `${unit.id}#${c.cardHash}`, cardHash: c.cardHash }));
    mgr.addCards(unit.id, cardMeta);

    const repos = getRepositories();

    // Cards for a single unit run in parallel with a bounded pool.
    await pool(cards, CONFIG.detailConcurrency, async (feedCard) => {
      const cardUnitId = `${unit.id}#${feedCard.cardHash}`;
      const cardUnit = mgr.manifest.cards.find((c) => c.id === cardUnitId);
      if (!cardUnit || cardUnit.status === "done") return null;

      mgr.updateCard(cardUnitId, { status: "running", attempts: cardUnit.attempts + 1 });

      try {
        // 1. Cheap Pre-Filter
        const preQual = CheapFilter.evaluate({
          title: feedCard.title,
          companyName: feedCard.company,
          location: feedCard.location,
          rawUrl: feedCard.detailUrl
        });

        if (!preQual.shouldAcquire) {
          mgr.updateCard(cardUnitId, { status: "skipped_empty", error: preQual.reason });
          return null;
        }

        // 2. Canonical Identity Resolution
        const identity = resolveCanonicalIdentity({
          portal: unit.portal,
          url: feedCard.detailUrl,
          title: feedCard.title,
          companyName: feedCard.company,
          rawJobId: feedCard.cardHash
        });

        // Pre-Detail Duplicate Detection:
        // Check in-memory sets AND persisted SQLite database before expensive detail extraction.
        const isInMemoryDuplicate = seenUrls.has(identity.canonicalUrl) || seenCanonicalIds.has(identity.canonicalJobId);
        let isPersistedDuplicate = false;
        if (!isInMemoryDuplicate) {
          const existingOpp = await repos.opportunities.getOpportunity(identity.canonicalJobId).catch(() => undefined);
          if (existingOpp) isPersistedDuplicate = true;
        }

        if (isInMemoryDuplicate || isPersistedDuplicate) {
          mgr.recordTelemetry("duplicatePreDetail");
          mgr.updateCard(cardUnitId, { status: "skipped_empty", error: "Duplicate Canonical URL (Pre-Detail)" });
          outcome.duplicates++;
          return null;
        }

        seenUrls.add(identity.canonicalUrl);
        seenCanonicalIds.add(identity.canonicalJobId);

        // 3. Upsert Discovered Job into Persistent Acquisition Ledger
        const ledgerItem = await repos.acquisition.upsertDiscoveredJob({
          canonicalJobId: identity.canonicalJobId,
          sourcePortal: identity.sourcePortal,
          sourceJobId: identity.sourceJobId,
          canonicalUrl: identity.canonicalUrl,
          title: feedCard.title,
          companyName: feedCard.company,
          location: feedCard.location,
          state: "QUEUED",
          firstSeenAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          validationConfidence: identity.identityConfidence
        });

        const snapshotPath = path.join(SNAPSHOT_DIR, `${feedCard.cardHash}.json`);
        const isHistoricallyNew = !fs.existsSync(snapshotPath);
        let detailedCard: import("./scraper/types").DetailedCard | null = null;
        let snapshot = readSnapshotIfFresh(feedCard.cardHash, CONFIG.snapshotFreshHours);
        
        if (!snapshot) {
          mgr.journal.append({ type: "detail_extraction_started", cardId: cardUnitId });
          const pmDetail = activePageManagers.get(unit.portal);
          const detail = await handler.fetchDetail({
            runId: mgr.runId, portal: unit.portal, keyword: unit.keyword, page: unit.page,
            searchUrl, browserContext,
            searchPage: pmDetail?.getPage("search") || activePage,
            detailPage: pmDetail?.getPage("detail"),
            searchMutex: pmDetail?.getMutex("search"),
            detailMutex: pmDetail?.getMutex("detail"),
            pageManager: pmDetail,
            logger: log,
            isHttpDisabled: (url: string) => mgr.isHttpFastPathDisabled(unit.portal) || mgr.failedHttpUrls.has(url),
            recordHttpFailure: (url: string, reason: string) => mgr.recordDetailFailure(unit.portal, url, reason),
            recordTelemetry: (event: any) => mgr.recordTelemetry(event),
          }, feedCard.detailUrl);
          mgr.journal.append({ type: "detail_extraction_finished", cardId: cardUnitId, durationMs: detail.fetchDurationMs });
          
          // 4. Standalone Response Validation
          const valResult = ResponseValidator.validate({
            html: detail.rawText || "",
            url: feedCard.detailUrl,
            sourcePortal: unit.portal,
            extractedTitle: feedCard.title,
            extractedCompany: feedCard.company,
            extractedDescription: detail.rawText
          });

          if (!valResult.isValid) {
            const healthAction = HealthManager.recordFailure(unit.portal, valResult.failureClass || "UNKNOWN_FAILURE");
            await repos.acquisition.updateJobState(ledgerItem.id, {
              state: "ACQUIRING",
              terminalState: valResult.failureClass === "REMOVED_404" ? "PERMANENT_FAILURE" : undefined,
              lastFailureClass: valResult.failureClass,
              acquisitionQuality: valResult.quality,
              validationConfidence: valResult.confidence
            });
            mgr.updateCard(cardUnitId, { status: "failed", error: `Validation failed: ${valResult.failureClass}` });
            return null;
          }

          HealthManager.recordSuccess(unit.portal);

          detailedCard = {
            ...feedCard,
            snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
            scraperVersion: SCRAPER_VERSION,
            detail,
            telemetry: { cardExtractMs: 0, detailExtractMs: detail.fetchDurationMs || 0, totalMs: detail.fetchDurationMs || 0 },
          };
          
          writeSnapshot(detailedCard);
          mgr.journal.append({ type: "snapshot_written", cardId: cardUnitId, path: snapshotPath });

          // 5. Record Validated State in Ledger & Merge Opportunity in SQLite
          await repos.acquisition.updateJobState(ledgerItem.id, {
            state: "VALIDATED",
            lastAcquiredAt: new Date().toISOString(),
            acquisitionQuality: valResult.quality,
            validationConfidence: valResult.confidence,
            lastAcquisitionMethod: (detail as any)?.method === "HTTP_FASTPATH" ? "HTTP_FASTPATH" : "BROWSER_DOM"
          });

          const companyId = feedCard.company.toLowerCase().replace(/[^a-z0-9]/g, "-");
          await repos.companies.registerCompany({
            id: companyId,
            name: feedCard.company,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            provenance: {
              schemaVersion: SNAPSHOT_SCHEMA_VERSION,
              runId: mgr.runId,
              timestamp: new Date().toISOString()
            }
          });

          await repos.opportunities.mergeOpportunity({
            id: identity.canonicalJobId,
            companyId,
            canonicalTitle: feedCard.title,
            location: feedCard.location,
            fingerprint: identity.canonicalJobId,
            lifecycle: "Verified",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            provenance: {
              schemaVersion: SNAPSHOT_SCHEMA_VERSION,
              runId: mgr.runId,
              timestamp: new Date().toISOString()
            }
          });
        } else {
          detailedCard = snapshot;
        }
        mgr.updateCard(cardUnitId, { snapshotPath, isNew: isHistoricallyNew });
        
        if (!detailedCard) return null;

        const key = [detailedCard.title, detailedCard.company, detailedCard.location]
          .map((s) => (s || "").toLowerCase().trim()).join("|");
        if (seenCardKeys.has(key)) {
          mgr.recordTelemetry("duplicatePostDetail");
          mgr.updateCard(cardUnitId, { status: "skipped_empty", error: "Duplicate Content Hash (Post-Detail)" });
          outcome.duplicates++;
          return null;
        }
        seenCardKeys.add(key);

        const cleanCompany = sanitizeCompanyName(
          detailedCard.company, detailedCard.title || "",
          detailedCard.rawText || "", detailedCard.detailUrl
        );
        if (!cleanCompany || !detailedCard.title) {
          mgr.updateCard(cardUnitId, { status: "skipped_empty" });
          return null;
        }
        
        const filteredCard = {
          ...detailedCard,
          company: cleanCompany
        } as import("./scraper/types").DetailedCard;

        enrichmentQueue.enqueue(
          cardUnitId,
          filteredCard.cardHash,
          snapshotPath,
          EXTRACTOR_VERSION, // pipeline version
          {
            runId: mgr.runId,
            executionPlanId: unit.id,
            definitionId: unit.definitionId || "unknown",
            familyId: "unknown",
            portal: unit.portal,
            page: unit.page,
            catalogVersion: CATALOG_VERSION,
            plannerVersion: PLANNER_VERSION,
            ruleVersion: RULE_VERSION,
            searchQuery: unit.keyword
          },
          10, // business_priority
          0   // execution_priority
        );
        
        mgr.updateCard(cardUnitId, { status: "done" });
      } catch (err: any) {
        log(`card ${cardUnitId} failed: ${err.message}`, "error");
        mgr.updateCard(cardUnitId, { status: "failed", error: err.message });
        mgr.journal.append({ type: "card_failed", cardId: cardUnitId, error: err.message });
      }
      return null;
    });

    let canonicalDuplicates = 0;
    let ledgerKnown = 0;
    let hardFiltered = 0;
    let identityFailed = 0;
    let novelAccepted = 0;
    let novelAcquired = 0;

    for (const feedCard of cards) {
      const cardUnitId = `${unit.id}#${feedCard.cardHash}`;
      const cu = mgr.manifest.cards.find((c) => c.id === cardUnitId);
      if (!cu) continue;

      if (cu.status === "skipped_empty") {
        const errStr = cu.error || "";
        if (errStr.toLowerCase().includes("duplicate")) {
          canonicalDuplicates++;
        } else if (errStr.toLowerCase().includes("ledger")) {
          ledgerKnown++;
        } else {
          hardFiltered++;
        }
      } else if (cu.status === "failed") {
        identityFailed++;
      } else if (cu.status === "done") {
        if (!cu.isNew) {
          canonicalDuplicates++;
        } else {
          novelAccepted++;
          if (cu.snapshotPath && fs.existsSync(cu.snapshotPath)) {
            novelAcquired++;
          }
        }
      }
    }
    
    const cardsParsed = cards.length;
    const classified = canonicalDuplicates + ledgerKnown + hardFiltered + identityFailed + novelAccepted;
    
    if (classified !== cardsParsed) {
      log(`[AccountingInvariantViolation] cardsParsed=${cardsParsed}, classified=${classified} (Duplicates=${canonicalDuplicates}, Ledger=${ledgerKnown}, HardFiltered=${hardFiltered}, IdentityFailed=${identityFailed}, NovelAccepted=${novelAccepted})`, "warn");
    }
    if (novelAcquired > novelAccepted) {
      log(`[AccountingInvariantViolation] novelAcquired (${novelAcquired}) > novelAccepted (${novelAccepted})`, "warn");
    }

    const newJobs = novelAccepted;
    const duplicates = canonicalDuplicates;
    const rejected = ledgerKnown + hardFiltered + identityFailed;
    const opportunities = novelAccepted;
    
    outcome.detailCount = novelAcquired;
    outcome.opportunities = opportunities;
    outcome.factsCreated = 0; // Enriched downstream

    outcome.newJobs = newJobs;
    outcome.duplicates = duplicates;

    let decision: "CONTINUE" | "STOP" = "CONTINUE";
    let reason = "DiscoveryRateAboveThreshold";
    
    if (unit.definitionId) {
      const minNewJobsPerPage = 2; // threshold for a page being "low yield"
      const maxConsecutiveLowYield = 2; // stop after this many consecutive low-yield pages
      
      const currentLowYield = newJobs < minNewJobsPerPage;
      let streak = lowYieldTracking.get(unit.definitionId) || 0;
      
      if (currentLowYield) {
        streak += 1;
        lowYieldTracking.set(unit.definitionId, streak);
      } else {
        lowYieldTracking.set(unit.definitionId, 0); // reset streak
      }

      if (streak >= maxConsecutiveLowYield && unit.page >= 1) {
        decision = "STOP";
        reason = "ConsecutiveLowYield";
        log(`Early stopping triggered for ${unit.definitionId} after ${streak} consecutive low-yield pages`, "warn");
        mgr.manifest.units.forEach(u => {
          if (u.definitionId === unit.definitionId && u.status === "pending" && u.page > unit.page) {
            mgr.updateUnit(u.id, { status: "skipped_pruned", error: "Pruned by low discovery stopping rule" });
          }
        });
      } else if (currentLowYield) {
        reason = "LowYieldWarning";
        log(`Low discovery on page ${unit.page} (${newJobs} new jobs). Streak: ${streak}/${maxConsecutiveLowYield}`, "info");
      }
    }

    const runtimeMs = new Date().getTime() - new Date(mgr.manifest.units.find(u => u.id === unit.id)!.startedAt!).getTime();

    // -------------------------------------------------------------
    // Emit PageExecutionRecord (The immutable telemetry record)
    // -------------------------------------------------------------
    try {
      mgr.appendMetric({
        type: "PageExecutionRecord",
        telemetrySchemaVersion: TELEMETRY_SCHEMA_VERSION,
        runId: mgr.runId,
        executionPlanId: unit.executionPlanId || "unknown",
        definitionId: unit.definitionId || "unknown",
        familyId: unit.familyId || "unknown",
        plannerVersion: PLANNER_VERSION,
        ruleVersion: RULE_VERSION,
        extractorVersion: EXTRACTOR_VERSION,
        promptVersion: EXTRACTOR_PROMPT_VERSION,
        portal: unit.portal,
        keyword: unit.keyword,
        page: unit.page,
        cardsSeen: cards.length,
        cardsParsed,
        duplicates: canonicalDuplicates,
        rejected,
        opportunities,
        saved: novelAcquired,
        qualified: null,
        latencyMs: runtimeMs,
        decision,
        decisionReason: reason,
        failureReason: null,
        timestamp: new Date().toISOString()
      });

      QueryMetricsStore.record({
        runId: mgr.runId,
        portal: unit.portal,
        query: unit.keyword,
        page: unit.page,
        cardsSeen: cards.length,
        cardsParsed,
        canonicalDuplicates,
        ledgerKnown,
        hardFiltered,
        identityFailed,
        novelAccepted,
        novelAcquired,
        noveltyRate: cardsParsed > 0 ? (novelAccepted / cardsParsed) : 0,
        elapsedMs: runtimeMs,
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      log(`Telemetry failed for ${unit.id}: ${err.stack || err.message}`, "warn");
      outcome.telemetryErrors++;
      outcome.warnings.push(`Telemetry failed: ${err.message}`);
    }

    const decisionRecord: import("./scraper/types").UnitDecisionRecord = {
      ruleVersion: "4.5",
      cardsSeen: cards.length,
      cardsParsed: cards.length,
      duplicates: canonicalDuplicates,
      extractionErrors: identityFailed,
      qualified: null,
      recommended: null,
      newCompanies: null,
      decision,
      reason
    };

    mgr.updateUnit(unit.id, { decisionRecord });

    log(`\n=== PAGE SUMMARY ===\nPortal: ${unit.portal}\nKeyword: ${unit.keyword}\nPage: ${unit.page}\n\nCards Seen ............ ${cards.length}\nCards Parsed .......... ${cardsParsed}\n  ├── Canonical Duplicates ... ${canonicalDuplicates}\n  ├── Ledger Known ........... ${ledgerKnown}\n  ├── Hard Filtered .......... ${hardFiltered}\n  ├── Identity Failures ...... ${identityFailed}\n  └── Novel Accepted ......... ${novelAccepted} (Acquired: ${novelAcquired})\n\nNovelty Rate .......... ${((novelAccepted / Math.max(1, cardsParsed)) * 100).toFixed(1)}%\nDecision .............. ${decision}\nReason ................ ${reason}\n====================\n`, "info");
    
    outcome.status = "completed";
  } catch (err: any) {
    outcome.status = "failed";
    outcome.warnings.push(`Exception: ${err.message}`);
    log(`processUnit exception for ${unit.id}: ${err.stack || err.message}`, "error");
  } finally {
    let terminalStatus: string = outcome.status;
    if (terminalStatus === "completed") terminalStatus = "done";
    
    mgr.updateUnit(unit.id, { status: terminalStatus as any, finishedAt: new Date().toISOString() });
    mgr.journal.append({ type: "unit_done", unitId: unit.id, outcome });
  }

  return outcome;
}

function printAcquisitionTelemetry(mgr: RunController) {
  const defs = new Map<string, any[]>();
  for (const u of mgr.manifest.units) {
    if (!u.definitionId) continue;
    if (!defs.has(u.definitionId)) defs.set(u.definitionId, []);
    defs.get(u.definitionId)!.push(u);
  }

  const portalStats = new Map<string, any>();
  for (const portal of mgr.manifest.portals) {
    portalStats.set(portal, {
      pagesAttempted: 0,
      pagesSucceeded: 0,
      pagesBlocked: 0,
      totalMs: 0
    });
  }

  let totalDefs = defs.size;
  let totalCards = 0;
  let totalUnique = 0;

  console.log(`\n============================================================`);
  console.log(`            ACQUISITION QUALITY & TELEMETRY`);
  console.log(`============================================================\n`);

  defs.forEach((units, defId) => {
    let pagesCrawled = 0;
    let cardsSeen = 0;
    let duplicates = 0;
    let stopReason = "Exhausted";
    
    const kw = units[0]?.keyword || defId;
    
    for (const u of units) {
      if (u.status === "done" || u.status === "skipped_empty" || u.status === "failed") pagesCrawled++;
      if (u.decisionRecord) {
        cardsSeen += u.decisionRecord.cardsSeen;
        duplicates += u.decisionRecord.duplicates;
        if (u.decisionRecord.decision === "STOP") {
          stopReason = u.decisionRecord.reason;
        }
      }
      
      const pStat = portalStats.get(u.portal);
      if (pStat) {
        pStat.pagesAttempted++;
        if (u.status === "done" || u.status === "skipped_empty") pStat.pagesSucceeded++;
        else if (u.error?.toLowerCase().includes("blocked") || u.error?.toLowerCase().includes("bot")) pStat.pagesBlocked++;
        if (u.startedAt && u.finishedAt) {
          pStat.totalMs += new Date(u.finishedAt).getTime() - new Date(u.startedAt).getTime();
        }
      }
    }
    
    totalCards += cardsSeen;
    totalUnique += (cardsSeen - duplicates);

    console.log(`--- DEFINITION SUMMARY: ${kw} ---`);
    console.log(`Pages Crawled ........ ${pagesCrawled}`);
    console.log(`Cards Seen ........... ${cardsSeen}`);
    console.log(`Duplicates ........... ${duplicates}`);
    console.log(`Qualified ............ N/A (Not measured)`);
    console.log(`Recommended .......... N/A (Not measured)`);
    console.log(`Companies ............ N/A (Requires enrichment)`);
    console.log(`Decision ............. STOP`);
    console.log(`Reason ............... ${stopReason}\n`);
  });

  console.log(`\n============================================================`);
  console.log(`                   PORTAL HEALTH SUMMARY`);
  console.log(`============================================================\n`);
  
  portalStats.forEach((stats, portal) => {
    const avgLatency = stats.pagesAttempted > 0 ? (stats.totalMs / stats.pagesAttempted / 1000).toFixed(1) : "0.0";
    const health = mgr.manifest.portalHealth?.[portal]?.score ?? 100;
    console.log(`--- PORTAL: ${portal} ---`);
    console.log(`Pages attempted ...... ${stats.pagesAttempted}`);
    console.log(`Succeeded ............ ${stats.pagesSucceeded}`);
    console.log(`Blocked .............. ${stats.pagesBlocked}`);
    console.log(`Average latency ...... ${avgLatency} s`);
    console.log(`Health ............... ${health}%`);
    if (health === 0 || stats.pagesBlocked > 0) {
      console.log(`Recommendation ....... Rest portal`);
    }
    console.log(``);
  });

  console.log(`\n============================================================`);
  console.log(`                   FAMILY SUMMARY`);
  console.log(`============================================================\n`);
  console.log(`Definitions ............ ${totalDefs}`);
  console.log(`Unique Companies ....... N/A (Requires enrichment)`);
  console.log(`Unique Jobs ............ ${totalUnique}`);
  console.log(`Recommendations ........ N/A (Not measured)`);
  console.log(`ROI .................... N/A (Not measured)\n`);
}

function collectRecords(): unknown[] {
  const records: unknown[] = [];
  const seenJobHash = new Set<string>();
  
  if (!fs.existsSync(EXTRACTION_DIR)) return records;
  
  const files = fs.readdirSync(EXTRACTION_DIR);
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const ex = fs.readFileSync(path.join(EXTRACTION_DIR, f), "utf-8");
      const parsed = JSON.parse(ex);
      if (seenJobHash.has(parsed.jobHash)) continue;
      seenJobHash.add(parsed.jobHash);
      records.push(parsed);
    } catch (err: any) { 
      console.error(`collectRecords error for ${f}:`, err);
    }
  }
  return records;
}

// Execute if run directly from the CLI
const isMainModule = typeof process !== 'undefined' && 
  process.argv && 
  process.argv.length >= 2 && 
  (process.argv[1].endsWith('scrape.ts') || process.argv[1].endsWith('scrape')) &&
  process.env.npm_lifecycle_event !== 'dev' &&
  !process.argv[1].includes('node_modules');

if (isMainModule) {
  runScraper().then((res: any) => {
    if (!res?.success) process.exit(1);
  });
}
