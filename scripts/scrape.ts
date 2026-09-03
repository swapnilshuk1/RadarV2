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
import type { FeedCard, PortalHandler, PortalName, WorkUnit, AcquisitionAttempt, AcquisitionOutcome, AcquisitionVariant } from "./scraper/types";
import { compileCoverageVariants, createFreshnessVariant } from "./scraper/run/acquisition-variants";

import { sanitizeCompanyName } from "./scraper/utils/sanitize";
import { normalizeUrl } from "./scraper/utils/url";
import { getDatabaseAdapter } from "../src/data/database";
import { fastFetchDetail } from "./scraper/utils/http-fetch";
import { EnrichmentQueue } from "./scraper/persist/queue";
import { resolveCanonicalIdentity } from "../src/lib/acquisition/canonical-identity";
import { FailurePolicyEngine } from "../src/lib/acquisition/failure-taxonomy";
import { ResponseValidator } from "../src/lib/acquisition/validator";
import { passesHardFilter } from "./scraper/utils/hard-filter";
import { HealthManager } from "./scraper/run/health-manager";
import { QueryMetricsStore } from "./scraper/run/metrics";
import { getRepositories } from "../src/data/sqlite/provider";
import { CredentialBroker } from "../src/lib/security/CredentialBroker";
import { establishPortalAuthSession, type PortalAuthSession } from "../src/lib/security/PortalAuthSession";
import type { AuthContext } from "../src/lib/security/auth";
import { CanonicalIngestionService, type CanonicalIngestionResult } from "../src/lib/acquisition/CanonicalIngestionService";



import {
  readSnapshotIfFresh,
  bindEvaluationEvidence,
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

export async function syncManifestProgress(
  mgr: RunController,
  stage?: "discover" | "evaluate" | "prioritize" | "complete" | "stopped" | "failed"
) {
  const cardsFound = mgr.manifest.cards.length;
  let evaluated = 0;
  try {
    const stats = await enrichmentQueue.getRunStats(mgr.runId);
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

const activeContexts = new Map<PortalName, any>();
const activePages = new Map<PortalName, any>();
const activePageManagers = new Map<PortalName, PageManager>();
const activeAuthSessions = new Map<PortalName, PortalAuthSession>();
const activeRunControllers = new Map<string, RunController>();

export async function abortLiveRun(runId?: string): Promise<boolean> {
  const log = makeLogger("scrape:abort");
  log(`Instant abort requested for run: ${runId || "active"}`);
  
  if (runId && activeRunControllers.has(runId)) {
    const mgr = activeRunControllers.get(runId)!;
    mgr.manifest.status = "stopping";
    mgr.recordActivity("Stopping search... Closing browser workers and saving records");
  } else {
    for (const mgr of activeRunControllers.values()) {
      mgr.manifest.status = "stopping";
      mgr.recordActivity("Stopping search... Closing browser workers and saving records");
    }
  }

  // Force close all browser contexts to cancel active navigations and network calls immediately
  try {
    await closeAllPortalContexts();
  } catch (err: any) {
    log(`Warning closing contexts on abort: ${err.message}`);
  }
  return true;
}

export interface RunOptions {
  keywords?: string[];
  portals?: PortalName[];
  maxPages?: number;
  maxCardsPerPage?: number;
  resume?: boolean;
  autoConfirm?: boolean;
  authContext?: AuthContext;
  searchPlanId?: string;
  resolvedPlan?: import("../src/lib/intelligence/ScraperPlanResolver").ResolvedScraperPlan;
  variants?: AcquisitionVariant[];
}

export async function startRun(opts: RunOptions = {}): Promise<{ runId: string; completion: Promise<{ success: boolean; count: number; runId: string }> }> {
  const log = makeLogger("scrape");
  const freshRun = process.argv.includes('--fresh') || process.env.FRESH_RUN === 'true';

  let keywords = opts.keywords;
  let portals = opts.portals ?? DEFAULT_PORTALS;
  let maxPages = opts.maxPages ?? CONFIG.maxPages;
  const maxCardsPerPage = opts.maxCardsPerPage ?? CONFIG.maxCardsPerPage;

  // Command-line override support for agile, diverse crawl runs
  const keywordsArg = process.argv.find(arg => arg.startsWith('--keywords=') || arg.startsWith('--keyword='));
  if (keywordsArg) {
    keywords = keywordsArg.split('=')[1].split(',').map(k => k.trim());
  }
  const portalsArg = process.argv.find(arg => arg.startsWith('--portals=') || arg.startsWith('--portal='));
  if (portalsArg) {
    portals = portalsArg.split('=')[1].split(',').map(p => p.trim() as PortalName);
  }
  const maxPagesArg = process.argv.find(arg => arg.startsWith('--max-pages=') || arg.startsWith('--maxPages=') || arg.startsWith('--pages='));
  if (maxPagesArg) {
    const parsed = parseInt(maxPagesArg.split('=')[1], 10);
    if (!isNaN(parsed) && parsed > 0) maxPages = parsed;
  }

  const cliAutoConfirm = process.argv.includes('--autoConfirm') || 
    process.argv.includes('--auto-confirm') || 
    process.argv.includes('--yes') ||
    process.argv.includes('-y') ||
    process.env.AUTO_CONFIRM === 'true';
  if (cliAutoConfirm && opts.autoConfirm === undefined) {
    opts.autoConfirm = true;
  }

  let resolvedPlan: import("../src/lib/intelligence/ScraperPlanResolver").ResolvedScraperPlan | undefined = opts.resolvedPlan;

  if (opts.authContext) {
    // Authoritative resolution contract: resolve persisted search plan strictly via ScraperPlanResolver
    const { ScraperPlanResolver } = await import("../src/lib/intelligence/ScraperPlanResolver");
    const db = getDatabaseAdapter();
    const scope = { tenantId: opts.authContext.tenantId, personId: opts.authContext.userId };
    resolvedPlan = opts.resolvedPlan || (await ScraperPlanResolver.resolveActivePlan(
      scope,
      undefined,
      db,
      opts.searchPlanId
    ));

    if (!resolvedPlan || resolvedPlan.queries.length === 0) {
      const errorMsg = `[ScraperAuth] No active search plan found in Turso Cloud for tenant ${opts.authContext.tenantId} (person: ${opts.authContext.userId}). Scraper execution aborted (fallback keywords disabled for authenticated sessions).`;
      log(errorMsg, "error");
      throw new Error(errorMsg);
    }

    keywords = resolvedPlan.queries;

    log(
      `Resolved active evaluation context:\n` +
      `  tenant=${scope.tenantId}\n` +
      `  person=${scope.personId}\n` +
      `  searchPlan=${resolvedPlan.searchPlanId}\n` +
      `  snapshot=${resolvedPlan.snapshotId || "dynamic"}\n` +
      `  queries=${resolvedPlan.queryCount}\n\n` +
      `Using persisted search plan; fallback keywords disabled.`
    );
  } else if (!keywords) {
    keywords = DEFAULT_KEYWORDS;
    log(`Running in offline unauthenticated mode: using manual/default keywords (${keywords.length} queries).`);
  }
  
  const resolvedKeywords = keywords;
  const resolvedVariants = opts.variants || (resolvedPlan ? compileCoverageVariants(resolvedPlan, portals) : undefined);

  const mgr = new RunController();
  const { resumed } = mgr.init({
    keywords: resolvedKeywords, portals, maxPages,
    maxCardsPerPage,
    resume: freshRun ? false : (opts.resume !== false),
    variants: resolvedVariants,
  });
  
  activeRunControllers.set(mgr.runId, mgr);
  mgr.recordActivity("Building executive search schema from candidate profile...");
  const plannedUnits = mgr.manifest.units.length;
  log(`Run ${mgr.runId} ${resumed ? "resumed" : "started"} — portals=${mgr.manifest.portals.join(",")} units=${plannedUnits}`);
  mgr.recordActivity(`Search schema armed: ${plannedUnits} work units across ${portals.join(", ")}`);

  let runScope: any = null;
  if (opts.authContext) {
    runScope = {
      tenantId: opts.authContext.tenantId,
      personId: opts.authContext.userId,
      roles: [],
    };
    try {
      const repos = getRepositories();
      await repos.scrapeRuns.createRun(runScope, {
        id: mgr.runId,
        searchPlanId: resolvedPlan ? resolvedPlan.searchPlanId : (opts.searchPlanId || "default"),
        portalTargets: portals,
        initialStatus: "initializing",
        config: { maxPages, keywords: resolvedKeywords },
      });
      log(`Created durable scrape_run in Turso Cloud: ${mgr.runId} for tenant ${runScope.tenantId}`);
    } catch (e: any) {
      log(`Failed to create durable scrape_run: ${e.message}`, "warn");
      throw e;
    }
  }

  // Graceful shutdown: checkpoints already fsync'd — just close journal + browsers.
  const shutdown = async (signal: string) => {
    log(`Received ${signal}, checkpointing…`, "warn");
    mgr.journal.append({ type: "signal", signal });
    mgr.finalize("aborted");
    if (runScope) {
      try {
        await getRepositories().scrapeRuns.updateRunStatus(runScope, mgr.runId, "aborted", `Interrupted by ${signal}`);
      } catch {}
    }
    for (const session of activeAuthSessions.values()) {
      session.dispose();
    }
    activeAuthSessions.clear();
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
      if (runScope) {
        try {
          await getRepositories().scrapeRuns.updateRunStatus(runScope, mgr.runId, "running");
        } catch {}
      }

      await pool(portals, CONFIG.portalConcurrency, async (portal) => {
        const plog = makeLogger(`scrape:${portal}`);
        const handler = HANDLERS[portal];
        const units = mgr.pendingUnits().filter((u) => u.portal === portal);
        if (units.length === 0) { plog("no pending units"); return null; }

        if (portal === "LinkedIn") {
          mgr.recordActivity("Hooking into your LinkedIn profile session...");
        } else if (portal === "Naukri") {
          mgr.recordActivity("Establishing authenticated gateway to Naukri...");
        } else if (portal === "Indeed") {
          mgr.recordActivity("Saying hello to Indeed stealth channel...");
        } else {
          mgr.recordActivity(`Establishing secure session with ${portal}...`);
        }

        let browserContext: any;
        try { browserContext = await getPortalContext(portal); }
        catch (err: any) { 
          plog(`context launch failed: ${err.message}`, "error"); 
          mgr.updatePortalHealth(portal, { status: "error", details: err.message });
          mgr.recordActivity(`Error connecting to ${portal}: ${err.message}`);
          return null; 
        }
        
        activeContexts.set(portal, browserContext);
        const pageManager = new PageManager(portal, browserContext);
        activePageManagers.set(portal, pageManager);
        const { searchPage, detailPage, searchMutex, detailMutex } = await pageManager.initialize();
        activePages.set(portal, searchPage);

        // Establish JIT PortalAuthSession without retaining plaintext secrets
        let authSession: PortalAuthSession | null = null;
        try {
          if (opts.authContext) {
            const repos = await getRepositories();
            const broker = new CredentialBroker(repos.credentials);
            authSession = await establishPortalAuthSession(broker, opts.authContext, portal, browserContext);
            if (authSession) {
              activeAuthSessions.set(portal, authSession);
              plog(`authenticated session established (source: ${authSession.source}, version: ${authSession.version})`);
            }
          } else {
            plog(`No tenant authContext provided; proceeding unauthenticated for portal ${portal}`);
          }
        } catch (authErr: any) {
          plog(`auth session setup error (${authErr.name || "Error"}): ${authErr.message}`, "warn");
          mgr.updatePortalHealth(portal, { status: "error", details: `Auth setup error: ${authErr.message}` });
        }

        const t0 = Date.now();
        const sessionStatus = await handler.ensureSession({
          runId: mgr.runId, portal, keyword: "-", page: 0, searchUrl: "-", browserContext,
          searchPage, detailPage, searchMutex, detailMutex, pageManager, activePage: searchPage,
          authSession: authSession || undefined,
          logger: plog,
        });
        
        if (sessionStatus === "error") {
          plog(`session error — skipping portal`, "warn");
          mgr.updatePortalHealth(portal, { status: "error", details: `Session error` });
          mgr.recordActivity(`Session error on ${portal}`);
          activeContexts.delete(portal);
          activePages.delete(portal);
          return null;
        }

        if (sessionStatus === "ready") {
          // Navigate to search page so user can visually verify
          const searchUrl = handler.buildSearchUrl({
            ...(units[0].variant || {}),
            query: units[0].keyword,
            page: units[0].page,
          });
          try {
            mgr.updatePortalHealth(portal, { status: "navigating", details: "Loading search page..." });
            await searchPage.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: CONFIG.navTimeoutMs });
            const elapsed = Date.now() - t0;
            mgr.updatePortalHealth(portal, { status: "ready", details: `Logged in & search loaded (${elapsed}ms)` });
            if (portal === "LinkedIn") {
              mgr.recordActivity(`✓ Hooked to your LinkedIn profile (${elapsed}ms)`);
            } else if (portal === "Naukri") {
              mgr.recordActivity(`✓ Naukri session authenticated (${elapsed}ms)`);
            } else if (portal === "Indeed") {
              mgr.recordActivity(`✓ Say hello to Indeed! Connected (${elapsed}ms)`);
            } else {
              mgr.recordActivity(`✓ Connected to ${portal} (${elapsed}ms)`);
            }
          } catch (err: any) {
            mgr.updatePortalHealth(portal, { status: "error", details: `Search nav failed: ${err.message}` });
          }
        } else if (sessionStatus === "gated") {
          mgr.updatePortalHealth(portal, { status: "gated", details: `Waiting for manual login` });
          mgr.recordActivity(`Portal ${portal} requires authentication/captcha`);
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
          if (unit.page > 1 && !unit.variant?.postedWithinDays) {
            const avgNovelty = QueryMetricsStore.getAverageNoveltyRate(unit.portal, unit.keyword);
            if (avgNovelty < 0.05) {
              if (!unit.variant?.postedWithinDays) {
                mgr.enqueueVariant(createFreshnessVariant({
                  ...(unit.variant || {}),
                  portal: unit.portal,
                  definitionId: unit.definitionId,
                  query: unit.keyword,
                }, 7));
              }
              plog(`Adaptive Scheduler: Pruning page ${unit.page} for "${unit.keyword}" on ${unit.portal} (historical novelty ${(avgNovelty * 100).toFixed(1)}%)`, "info");
              mgr.updateUnit(unit.id, { status: "skipped_pruned", error: "Pruned by adaptive novelty scheduler (<5% historical novelty)" });
              continue;
            }
          }

          const outcome = await processUnit(
            mgr,
            handler,
            unit,
            browserContext,
            activePage,
            seenCardKeys,
            seenUrls,
            seenCanonicalIds,
            plog,
            maxCardsPerPage,
            runScope ? { tenantId: runScope.tenantId, personId: runScope.personId } : undefined,
          );
          if (outcome) {
            portalIngested += outcome.opportunities;
            portalFacts += outcome.factsCreated;
          }
          await syncManifestProgress(mgr, "discover");
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

      if (mgr.isCancellationRequested()) {
        log(`[Scrape] Run ${mgr.runId} was aborted/stopped by user. Finalizing...`, "warn");
        mgr.recordActivity("Search stopped. Finalizing acquired opportunities...");
        mgr.finalize("aborted");
        try {
          const records = collectRecords();
          writeLiveScraped(records);
        } catch {}
        return { success: false, count: ingestedCount, runId: mgr.runId };
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

      // Rebuild JSON models
      try {
        const records = collectRecords();
        writeLiveScraped(records);
        log(`Rebuilt live-scraped.json cache with ${records.length} total records.`);
      } catch (rebuildErr: any) {
        log(`[Scrape] Rebuild phase failed: ${rebuildErr.message}`, "error");
      }

      // Autonomous Evaluation Queue Drain:
      // Ensure all newly enqueued evaluation jobs are drained autonomously to completion
      try {
        log(`[Scrape] Automatically draining evaluation queue...`);
        const { EvaluationWorker } = await import("../src/lib/intelligence/EvaluationWorker");
        const worker = new EvaluationWorker("cli_scraper_drain");
        const drainStats = await worker.drainQueue({ maxJobs: 500, timeoutMs: 60000 });
        log(`[Scrape] Drained evaluation queue: ${drainStats.processed} processed (${drainStats.completed} completed, ${drainStats.failed} failed)`);
      } catch (drainErr: any) {
        log(`[Scrape] Autonomous evaluation drain warning: ${drainErr.message}`, "warn");
      }

      mgr.finalize("completed");
      const tm = mgr.manifest.telemetry || { httpAttempted: 0, httpSuccessful: 0, httpFallbacks: 0, llmCalls: 0 };
      if (runScope) {
        try {
          const repos = getRepositories();
          await repos.scrapeRuns.updateRunMetrics(runScope, mgr.runId, {
            totalDiscovered: mgr.manifest.cards.length,
            totalEnqueued: ingestedCount,
            metrics: tm as any,
          });
          await repos.scrapeRuns.updateRunStatus(runScope, mgr.runId, "completed");
        } catch {}
      }
      mgr.recordActivity("Search completed · Executive shortlist updated");
      const runDurationS = ((new Date().getTime() - new Date(mgr.manifest.startedAt).getTime()) / 1000).toFixed(1);
      
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
      if (runScope) {
        try {
          await getRepositories().scrapeRuns.updateRunStatus(runScope, mgr.runId, "failed", err.message);
        } catch {}
      }
      return { success: false, count: 0, runId: mgr.runId };
    } finally {
      activeRunControllers.delete(mgr.runId);
      for (const session of activeAuthSessions.values()) {
        session.dispose();
      }
      activeAuthSessions.clear();
      await closeAllPortalContexts();
    }
  })();

  return { runId: mgr.runId, completion };
}

export async function runScraper(opts: Partial<RunControllerOptions> = {}): Promise<{ success: boolean; count: number; runId: string }> {
  const { completion } = await startRun(opts);
  return completion;
}

export type ProcessOutcome = {
  status: "completed" | "failed" | "skipped_gated" | "skipped_empty" | "aborted";
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
  log: ReturnType<typeof makeLogger>,
  maxCardsPerPage: number,
  lineageScope?: { tenantId: string; personId: string },
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

  const unitStartTime = Date.now();
  mgr.updateUnit(unit.id, { status: "running", startedAt: new Date().toISOString(), attempts: unit.attempts + 1 });
  mgr.recordActivity(`Searching ${unit.portal}: "${unit.keyword}" (Page ${unit.page})...`);
  try {
    const searchUrl = handler.buildSearchUrl({
      ...(unit.variant || {}),
      query: unit.keyword,
      page: unit.page,
    });
    let cards: FeedCard[] = [];
    const pm = activePageManagers.get(unit.portal);
    
    try {
      cards = await handler.listCards({
        runId: mgr.runId, portal: unit.portal, keyword: unit.keyword, page: unit.page,
        searchUrl, browserContext, variant: unit.variant, maxCardsPerPage,
        searchPage: pm?.getPage("search") || activePage,
        detailPage: pm?.getPage("detail"),
        searchMutex: pm?.getMutex("search"),
        detailMutex: pm?.getMutex("detail"),
        pageManager: pm,
        activePage: pm?.getPage("search") || activePage,
        authSession: activeAuthSessions.get(unit.portal),
        logger: log,
        isCancelled: () => mgr.isCancellationRequested(),
      });
      if (mgr.isCancellationRequested()) {
        outcome.status = "aborted";
        return outcome;
      }
      mgr.recordListingSuccess(unit.portal);
      mgr.recordActivity(`Discovered ${cards.length} listings on ${unit.portal} for "${unit.keyword}"`);
    } catch (err: any) {
      const isAbortError = mgr.isCancellationRequested() ||
        err?.message?.includes("Target page, context or browser has been closed") ||
        err?.message?.includes("browser has been closed");

      if (isAbortError) {
        log(`listCards for ${unit.id} aborted cleanly during cancellation.`, "info");
        outcome.status = "aborted";
        return outcome;
      }

      mgr.recordListingFailure(unit.portal);
      let errorCategory = "Unknown";
      const msg = err.message.toLowerCase();
      if (msg.includes("timeout") || msg.includes("etimedout")) errorCategory = "Timeout";
      else if (msg.includes("navigat")) errorCategory = "Navigation";
      else if (msg.includes("selector")) errorCategory = "Selector";
      else if (msg.includes("blocked") || msg.includes("rate limit") || msg.includes("auth_expired") || msg.includes("429") || msg.includes("406")) errorCategory = "Blocked";
      
      if (errorCategory === "Blocked") {
        mgr.updatePortalHealth(unit.portal, { status: "error", details: "Blocked by anti-bot", score: 0 });
      }
      
      log(`listCards failed for ${unit.id} [${errorCategory}]: ${err.message}`, "error");
      outcome.status = "failed";
      outcome.warnings.push(`listCards failed: ${err.message}`);

      let unitAcqOutcome: "ANTI_BOT" | "TIMEOUT" | "TRANSPORT_ERROR" = "TRANSPORT_ERROR";
      if (errorCategory === "Blocked" || msg.includes("406") || msg.includes("429") || msg.includes("cloudflare")) {
        unitAcqOutcome = "ANTI_BOT";
      } else if (errorCategory === "Timeout") {
        unitAcqOutcome = "TIMEOUT";
      }

      try {
        QueryMetricsStore.record({
          runId: mgr.runId,
          portal: unit.portal,
          query: unit.keyword,
          page: unit.page,
          cardsSeen: 0,
          cardsParsed: 0,
          canonicalDuplicates: 0,
          ledgerKnown: 0,
          hardFiltered: 0,
          identityFailed: 0,
          novelAccepted: 0,
          novelAcquired: 0,
          noveltyRate: 1.0, // Excluded from novelty degradation
          elapsedMs: Date.now() - unitStartTime,
          timestamp: new Date().toISOString(),
          outcome: unitAcqOutcome,
          hasTransportError: true,
        });
      } catch {}

      return outcome;
    }

    outcome.listingCount = cards.length;

    if (mgr.isCancellationRequested()) {
      outcome.status = "aborted";
      return outcome;
    }

    const cardMeta = cards.map((c) => ({ id: `${unit.id}#${c.cardHash}`, cardHash: c.cardHash }));
    mgr.addCards(unit.id, cardMeta);

    const repos = getRepositories();

    // Cards for a single unit run in parallel with a bounded pool.
    await pool(cards, CONFIG.detailConcurrency, async (feedCard) => {
      const cardUnitId = `${unit.id}#${feedCard.cardHash}`;
      if (mgr.isCancellationRequested()) {
        mgr.updateCard(cardUnitId, { status: "skipped_pruned", error: "Run cancelled/aborted" });
        return null;
      }
      const cardUnit = mgr.manifest.cards.find((c) => c.id === cardUnitId);
      if (!cardUnit || cardUnit.status === "done") return null;

      mgr.updateCard(cardUnitId, { status: "running", attempts: cardUnit.attempts + 1 });
      mgr.recordActivity(`Reading JD: ${feedCard.title} (${feedCard.company})`);

      const recordLineage = async (
        ledgerId: string,
        sourceJobId: string,
        sourceUrl: string,
        validation: ReturnType<typeof ResponseValidator.validate>,
        canonical?: CanonicalIngestionResult,
        failureClass?: string,
      ): Promise<void> => {
        // Unauthenticated local runs have no durable scrape_run scope. They are
        // intentionally outside the validation cohort; authenticated runs must
        // retain durable source-to-canonical provenance.
        if (!lineageScope) return;
        await repos.acquisition.recordIngestionLineage({
          scrapeRunId: mgr.runId,
          tenantId: lineageScope.tenantId,
          personId: lineageScope.personId,
          acquisitionLedgerId: ledgerId,
          cardId: cardUnitId,
          ingestionAttempt: cardUnit.attempts,
          sourcePortal: unit.portal,
          sourceJobId,
          sourceUrl,
          captureState: validation.document.transportState,
          documentState: validation.document.usabilityState,
          contentHash: canonical?.contentHash,
          canonicalJobId: canonical?.canonicalJobId,
          opportunityVersion: canonical?.opportunityVersion,
          failureClass: failureClass || validation.failureClass,
        });
      };

      try {
        // 1. Cheap Pre-Filter (Allow missing company for LinkedIn pre-detail extraction)
        const preQual = passesHardFilter({
          title: feedCard.title,
          company: feedCard.company,
          location: feedCard.location || "",
        }, { allowMissingCompany: unit.portal === "LinkedIn" });

        if (!preQual.pass) {
          mgr.updateCard(cardUnitId, { status: "skipped_empty", error: preQual.reason });
          return null;
        }

        // 2. Canonical Identity Resolution
        const identity = resolveCanonicalIdentity({
          portal: unit.portal,
          url: feedCard.detailUrl,
          title: feedCard.title,
          companyName: feedCard.company || "Confidential / Unknown"
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
          let detail: import("./scraper/types").DetailedCard["detail"];
          let acquisitionRoute: import("./scraper/types").AcquisitionRoute = "DISCOVERY_RICH";
          let enrichmentStatus: import("./scraper/types").EnrichmentStatus = "NOT_APPLICABLE";
          let fallbackRoute: string | undefined = undefined;
          const acquisitionAttempts: AcquisitionAttempt[] = [];

          if (unit.portal === "Naukri") {
            // Naukri Multi-Tier Acquisition Architecture:
            // Tier 1: Direct Rich Ingestion (>= 500 chars)
            if (feedCard.rawText && feedCard.rawText.length >= 500 && feedCard.rawHtml && feedCard.rawHtml.length >= 500) {
              log(`[Naukri] Using rich discovery payload (${feedCard.rawText.length} chars) for ${feedCard.title} @ ${feedCard.company}`);
              acquisitionRoute = "DISCOVERY_RICH";
              enrichmentStatus = "NOT_APPLICABLE";
              detail = {
                fetched: true,
                rawHtml: feedCard.rawHtml,
                rawText: feedCard.rawText,
                fetchDurationMs: 0,
                httpStatus: 200,
              };
              acquisitionAttempts.push({
                method: "DISCOVERY_RICH",
                url: feedCard.detailUrl,
                timestamp: new Date().toISOString(),
                httpStatus: 200,
                outcome: "SUCCESS",
                qualityTier: "VALID",
                extractionMethod: "FALLBACK_CARD",
                details: `Direct rich discovery payload (${feedCard.rawText.length} chars)`
              });
            } 
            // Tier 2: External ATS Enrichment via applyRedirectUrl (< 500 chars)
            else if (feedCard.applyRedirectUrl) {
              log(`[Naukri] Attempting ATS enrichment via ${feedCard.applyRedirectUrl}`);
              const atsRes: import("./scraper/utils/http-fetch").HttpFetchResult = await fastFetchDetail(
                feedCard.applyRedirectUrl,
                undefined,
                undefined,
                { "Referer": "https://www.naukri.com/" },
                feedCard.title,
                feedCard.company
              ).catch((err: any): import("./scraper/utils/http-fetch").HttpFetchResult => ({
                fetched: false,
                fetchError: err.message,
                fetchDurationMs: 0,
                httpStatus: undefined,
                outcome: "TRANSPORT_ERROR" as AcquisitionOutcome,
                rawHtml: "",
                rawText: ""
              }));

              if (atsRes.fetched && atsRes.outcome === "SUCCESS" && atsRes.rawText) {
                log(`[Naukri] ATS enrichment successful (${atsRes.rawText.length} chars, quality=${atsRes.qualityTier || 'VALID'}, method=${atsRes.extractionMethod}) for ${feedCard.title} @ ${feedCard.company}`);
                acquisitionRoute = "ATS_ENRICHED";
                enrichmentStatus = "ENRICHED_SUCCESS";
                detail = {
                  fetched: true,
                  rawHtml: atsRes.rawHtml,
                  rawText: atsRes.rawText,
                  fetchDurationMs: atsRes.fetchDurationMs,
                  httpStatus: atsRes.httpStatus || 200,
                };
                acquisitionAttempts.push({
                  method: "ATS_HTTP",
                  url: feedCard.applyRedirectUrl,
                  timestamp: new Date().toISOString(),
                  httpStatus: atsRes.httpStatus || 200,
                  outcome: "SUCCESS",
                  qualityTier: atsRes.qualityTier || "VALID",
                  extractionMethod: atsRes.extractionMethod,
                  details: `Extracted ${atsRes.rawText.length} chars via ${atsRes.extractionMethod}`
                });
              } else {
                log(`[Naukri] ATS enrichment rejected/failed (${atsRes.fetchError || atsRes.outcome}); preserving attempt and evaluating discovery fallback`);
                enrichmentStatus = "ENRICHED_FAILED";
                fallbackRoute = "ORIGINAL_DISCOVERY_PAYLOAD";
                acquisitionAttempts.push({
                  method: "ATS_HTTP",
                  url: feedCard.applyRedirectUrl,
                  timestamp: new Date().toISOString(),
                  httpStatus: atsRes.httpStatus,
                  outcome: atsRes.outcome || "EXTRACTION_FAILURE",
                  qualityTier: atsRes.qualityTier || "NON_JOB",
                  extractionMethod: atsRes.extractionMethod,
                  details: atsRes.fetchError || `Rejected by quality gate (${atsRes.qualityResult?.reasons?.join("; ") || "unsubstantive"})`
                });

                // Minimum candidate threshold: 200 chars for substantive evaluation
                if (feedCard.rawText && feedCard.rawText.length >= 200) {
                  acquisitionRoute = "DISCOVERY_FALLBACK_PARTIAL";
                  detail = {
                    fetched: true,
                    rawHtml: feedCard.rawHtml,
                    rawText: feedCard.rawText,
                    fetchDurationMs: 0,
                    httpStatus: 200,
                  };
                  acquisitionAttempts.push({
                    method: "DISCOVERY_RICH",
                    url: feedCard.detailUrl,
                    timestamp: new Date().toISOString(),
                    httpStatus: 200,
                    outcome: "SUCCESS",
                    qualityTier: feedCard.rawText.length >= 500 ? "VALID" : "SPARSE",
                    extractionMethod: "FALLBACK_CARD",
                    details: `Fallback retained discovery card text (${feedCard.rawText.length} chars)`
                  });
                } else {
                  detail = {
                    fetched: false,
                    fetchError: `Insufficient description length (${feedCard.rawText?.length || 0} < 200 chars)`,
                    rawHtml: feedCard.rawHtml || "",
                    rawText: feedCard.rawText || "",
                    fetchDurationMs: 0,
                    httpStatus: 200,
                  };
                }
              }
            } 
            // Tier 3: In-Portal QuickApply / Headhunter Mandates (< 500 chars, no applyRedirectUrl)
            else {
              enrichmentStatus = "NOT_APPLICABLE";
              // Minimum candidate threshold: 200 chars, subject to full ResponseValidator
              if (feedCard.rawText && feedCard.rawText.length >= 200) {
                acquisitionRoute = "DISCOVERY_QUICKAPPLY_PARTIAL";
                detail = {
                  fetched: true,
                  rawHtml: feedCard.rawHtml,
                  rawText: feedCard.rawText,
                  fetchDurationMs: 0,
                  httpStatus: 200,
                };
                acquisitionAttempts.push({
                  method: "DISCOVERY_QUICKAPPLY",
                  url: feedCard.detailUrl,
                  timestamp: new Date().toISOString(),
                  httpStatus: 200,
                  outcome: "SUCCESS",
                  qualityTier: "SPARSE",
                  extractionMethod: "FALLBACK_CARD",
                  details: `In-portal quick-apply specification (${feedCard.rawText.length} chars)`
                });
              } else {
                detail = {
                  fetched: false,
                  fetchError: `Insufficient description length (${feedCard.rawText?.length || 0} < 200 chars)`,
                  rawHtml: feedCard.rawHtml || "",
                  rawText: feedCard.rawText || "",
                  fetchDurationMs: 0,
                  httpStatus: 200,
                };
              }
            }
          } else {
            // Other Portals (LinkedIn, Indeed, etc.) - Preserved without modification
            if (feedCard.rawText && feedCard.rawText.length >= 400 && feedCard.rawHtml && feedCard.rawHtml.length >= 400) {
              log(`[${unit.portal}] Using rich discovery payload (${feedCard.rawText.length} chars) for ${feedCard.title} @ ${feedCard.company}`);
              detail = {
                fetched: true,
                rawHtml: feedCard.rawHtml,
                rawText: feedCard.rawText,
                fetchDurationMs: 0,
                httpStatus: 200,
              };
              acquisitionAttempts.push({
                method: "DISCOVERY_RICH",
                url: feedCard.detailUrl,
                timestamp: new Date().toISOString(),
                httpStatus: 200,
                outcome: "SUCCESS",
                qualityTier: "VALID",
                extractionMethod: "FALLBACK_CARD",
                details: `Direct rich discovery payload (${feedCard.rawText.length} chars)`
              });
            } else {
              mgr.journal.append({ type: "detail_extraction_started", cardId: cardUnitId });
              const pmDetail = activePageManagers.get(unit.portal);
              detail = await handler.fetchDetail({
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
              if (detail.fetched) {
                acquisitionAttempts.push({
                  method: "PORTAL_DETAIL",
                  url: feedCard.detailUrl,
                  timestamp: new Date().toISOString(),
                  httpStatus: detail.httpStatus || 200,
                  outcome: "SUCCESS",
                  qualityTier: (detail.rawText?.length || 0) >= 500 ? "VALID" : "SPARSE",
                  extractionMethod: "TARGETED_DOM",
                  details: `Extracted ${detail.rawText?.length || 0} chars via detail handler`
                });
              }
            }
          }
          
          // 4. Standalone Response Validation
          const valResult = ResponseValidator.validate({
            html: detail.rawText || "",
            url: feedCard.applyRedirectUrl || feedCard.detailUrl,
            sourcePortal: unit.portal,
            httpStatus: detail.httpStatus,
            extractedTitle: feedCard.title,
            extractedCompany: feedCard.company,
            extractedDescription: detail.rawText
          });

          if (!valResult.isValid || !detail.fetched) {
            const failureClass = valResult.failureClass || (detail.fetchError?.includes("< 200") ? "INSUFFICIENT_CONTENT" : "UNKNOWN_FAILURE");
            // Isolate external ATS failure from Naukri portal health/circuit-breaker
            if (unit.portal !== "Naukri") {
              HealthManager.recordFailure(unit.portal, failureClass);
            }
            await repos.acquisition.updateJobState(ledgerItem.id, {
              state: "ACQUIRING",
              terminalState: failureClass === "REMOVED_404" ? "PERMANENT_FAILURE" : undefined,
              lastFailureClass: failureClass,
              acquisitionQuality: valResult.quality,
              validationConfidence: valResult.confidence
            });
            mgr.updateCard(cardUnitId, { status: "failed", error: `Validation failed: ${failureClass}` });

            // Failed acquisition remains in the ledger and lineage as evidence,
            // but may never create a canonical market record.  A title/card or
            // an error page is not a recoverable substitute for a validated JD.
            if (lineageScope) {
              await recordLineage(
                ledgerItem.id,
                identity.sourceJobId,
                feedCard.detailUrl,
                valResult,
                undefined,
                failureClass,
              );
            }

            return null;
          }

          HealthManager.recordSuccess(unit.portal);

          // Post-Detail Company Resolution & Lineage Enforcement
          const rawCompany = (detail.extractedCompany || feedCard.company || "").trim();
          const isConfidentialOrMissing = !rawCompany || /^(confidential|unknown|undisclosed|stealth|private)\b/i.test(rawCompany);

          let effectiveCompany: string;
          let companyId: string;

          if (isConfidentialOrMissing) {
            effectiveCompany = rawCompany || "Confidential Employer";
            // Scoped surrogate company ID per opportunity to maintain entity lineage isolation
            companyId = `confidential:${unit.portal.toLowerCase()}:${feedCard.cardHash || ledgerItem.sourceJobId || ledgerItem.id}`;
          } else {
            effectiveCompany = rawCompany;
            companyId = effectiveCompany.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
          }

          feedCard.company = effectiveCompany;

          // Re-derive canonical identity with resolved company
          const resolvedIdentity = resolveCanonicalIdentity({
            portal: unit.portal,
            url: feedCard.detailUrl,
            title: feedCard.title,
            companyName: effectiveCompany
          });

          detailedCard = {
            ...feedCard,
            company: effectiveCompany,
            snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
            scraperVersion: SCRAPER_VERSION,
            acquisitionRoute,
            enrichmentStatus,
            fallbackRoute,
            applyRedirectUrl: feedCard.applyRedirectUrl,
            detail,
            acquisitionAttempts: acquisitionAttempts.length > 0 ? acquisitionAttempts : undefined,
            evaluationEvidence: { state: "PENDING" },
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
            lastAcquisitionMethod: acquisitionRoute
          });

          await repos.companies.registerCompany({
            id: companyId,
            name: effectiveCompany,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            provenance: {
              schemaVersion: SNAPSHOT_SCHEMA_VERSION,
              runId: mgr.runId,
              timestamp: new Date().toISOString()
            }
          });

          await repos.opportunities.mergeOpportunity({
            id: resolvedIdentity.canonicalJobId,
            companyId,
            canonicalTitle: feedCard.title,
            location: feedCard.location,
            fingerprint: resolvedIdentity.canonicalJobId,
            lifecycle: "Verified",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            provenance: {
              schemaVersion: SNAPSHOT_SCHEMA_VERSION,
              runId: mgr.runId,
              timestamp: new Date().toISOString()
            }
          });

          // [M10.1] Canonical Acquisition Interceptor: Global Identity, Versioning, Attention Gate & Queue
          try {
            const canonicalIngest = new CanonicalIngestionService();
            const ingestRes = await canonicalIngest.ingestOpportunity({
              sourcePortal: unit.portal,
              sourceJobId: resolvedIdentity.sourceJobId,
              canonicalUrl: feedCard.detailUrl,
              jobTitle: feedCard.title,
              companyName: feedCard.company,
              location: feedCard.location || "",
              employmentType: (detail as any)?.employmentType || null,
              rawContent: detail.rawText || "",
              httpStatus: detail.httpStatus,
              postedAt: feedCard.postedAt,
              postedPrecision: (feedCard as any)?.postedPrecision || null
            }, lineageScope);
            detailedCard = bindEvaluationEvidence(detailedCard, {
              canonicalJobId: ingestRes.canonicalJobId,
              opportunityVersion: ingestRes.opportunityVersion,
              contentHash: ingestRes.contentHash,
              sourcePayloadKey: ingestRes.sourcePayloadKey,
              sourceMediaType: ingestRes.sourceMediaType,
            });
            writeSnapshot(detailedCard);
            mgr.journal.append({
              type: "snapshot_evidence_bound",
              cardId: cardUnitId,
              canonicalJobId: ingestRes.canonicalJobId,
              opportunityVersion: ingestRes.opportunityVersion,
              contentHash: ingestRes.contentHash,
            });
            mgr.recordTelemetry("canonicalIngestSuccess");
            if (ingestRes.isNewOpportunity) {
              mgr.recordTelemetry("canonicalOpportunitiesIngested");
            } else {
              mgr.recordTelemetry("canonicalOpportunitiesReused");
            }
            if (ingestRes.isNewVersion) {
              mgr.recordTelemetry("newVersionsCreated");
            } else {
              mgr.recordTelemetry("duplicateVersionsSuppressed");
            }
            if (ingestRes.candidatesProjected > 0) {
              mgr.recordTelemetry("candidatesProjected", ingestRes.candidatesProjected);
            }
            if (ingestRes.jobsEnqueued > 0) {
              mgr.recordTelemetry("evaluationJobsEnqueued", ingestRes.jobsEnqueued);
            }
            await recordLineage(
              ledgerItem.id,
              resolvedIdentity.sourceJobId,
              feedCard.detailUrl,
              valResult,
              ingestRes,
            );
          } catch (err: any) {
            log(`[M10_CANONICAL_INGEST_WARN] Canonical acquisition error for ${feedCard.cardHash}: ${err.message}`, "warn");
            mgr.recordTelemetry("canonicalIngestFailure");
            if (lineageScope) {
              await recordLineage(
                ledgerItem.id,
                resolvedIdentity.sourceJobId,
                feedCard.detailUrl,
                valResult,
                undefined,
                err?.name || "CANONICAL_INGEST_FAILURE",
              );
              throw err;
            }
          }

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

        const payloadKey = `snapshots/${filteredCard.cardHash}.json`;
        try {
          const { getBlobStore } = await import("../src/lib/storage/blob-store");
          await getBlobStore().put(payloadKey, JSON.stringify(detailedCard), "application/json");
        } catch (e: any) {
          log(`Failed to write blob ${payloadKey}: ${e.message}`, "warn");
          mgr.updateCard(cardUnitId, { status: "failed", error: `Acquisition artifact rejected: ${e.message}` });
          mgr.journal.append({ type: "card_failed", cardId: cardUnitId, error: `Acquisition artifact rejected: ${e.message}` });
          return null;
        }

        await enrichmentQueue.enqueue(
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
          0,   // execution_priority
          payloadKey
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
    let validationFailed = 0;
    let novelAccepted = 0;
    let novelAcquired = 0;
    let cancelledOrPruned = 0;

    for (const feedCard of cards) {
      const cardUnitId = `${unit.id}#${feedCard.cardHash}`;
      const cu = mgr.manifest.cards.find((c) => c.id === cardUnitId);
      if (!cu) continue;

      // Finalize unclassified card states if cancellation occurred
      if (mgr.isCancellationRequested() && (cu.status === "pending" || cu.status === "running")) {
        mgr.updateCard(cardUnitId, { status: "skipped_pruned", error: "Run cancelled/aborted" });
      }

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
        const errStr = cu.error || "";
        if (errStr.toLowerCase().includes("identity")) {
          identityFailed++;
        } else {
          validationFailed++;
        }
      } else if (cu.status === "skipped_pruned" || cu.status === "skipped_gated") {
        cancelledOrPruned++;
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
    const classified = canonicalDuplicates + ledgerKnown + hardFiltered + identityFailed + validationFailed + novelAccepted + cancelledOrPruned;
    
    if (classified !== cardsParsed) {
      log(`[AccountingInvariantViolation] cardsParsed=${cardsParsed}, classified=${classified} (Duplicates=${canonicalDuplicates}, Ledger=${ledgerKnown}, HardFiltered=${hardFiltered}, IdentityFailed=${identityFailed}, ValidationFailed=${validationFailed}, NovelAccepted=${novelAccepted}, CancelledPruned=${cancelledOrPruned})`, "warn");
    }
    if (novelAcquired > novelAccepted) {
      log(`[AccountingInvariantViolation] novelAcquired (${novelAcquired}) > novelAccepted (${novelAccepted})`, "warn");
    }

    const newJobs = novelAccepted;
    const duplicates = canonicalDuplicates;
    const rejected = ledgerKnown + hardFiltered + identityFailed + validationFailed;
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
      // Each acquisition surface has its own yield curve. A freshness pass
      // must not inherit the coverage lane's low-yield streak.
      const yieldKey = unit.variant?.id || unit.definitionId;
      let streak = lowYieldTracking.get(yieldKey) || 0;
      
      if (currentLowYield) {
        streak += 1;
        lowYieldTracking.set(yieldKey, streak);
      } else {
        lowYieldTracking.set(yieldKey, 0); // reset streak
      }

      if (streak >= maxConsecutiveLowYield && unit.page >= 1) {
        const currentFreshness = unit.variant?.postedWithinDays;
        const nextFreshness = currentFreshness === undefined ? 7 : currentFreshness === 7 ? 1 : undefined;
        if (nextFreshness !== undefined) {
          mgr.enqueueVariant(createFreshnessVariant({
            ...(unit.variant || {}),
            portal: unit.portal,
            definitionId: unit.definitionId,
            query: unit.keyword,
          }, nextFreshness));
          reason = `ConsecutiveLowYield:EnqueuedFreshness${nextFreshness}d`;
          log(`Low yield on ${unit.definitionId}; enqueued ${nextFreshness}-day freshness variant after ${streak} pages`, "info");
        } else {
          decision = "STOP";
          reason = "ConsecutiveLowYield";
          log(`Early stopping triggered for ${unit.definitionId} after ${streak} consecutive low-yield pages`, "warn");
        }
        const currentSurfaceKey = unit.variant?.id || unit.definitionId;
        mgr.manifest.units.forEach(u => {
          const candidateSurfaceKey = u.variant?.id || u.definitionId;
          if (candidateSurfaceKey === currentSurfaceKey && u.status === "pending" && u.page > unit.page) {
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

      let unitAcqOutcome: AcquisitionOutcome = "SUCCESS";
      const unitWarning = outcome.warnings.join(" ");
      if (outcome.status === "aborted" || mgr.isCancellationRequested()) {
        unitAcqOutcome = "TRANSPORT_ERROR"; // Excluded from novelty degradation
      } else if (outcome.status === "failed" || outcome.status === "skipped_gated") {
        if (unitWarning.includes("406") || unitWarning.includes("429") || unitWarning.includes("Cloudflare") || unitWarning.includes("blocked") || unitWarning.includes("Anti-bot") || unitWarning.includes("Circuit breaker")) {
          unitAcqOutcome = "ANTI_BOT";
        } else if (unitWarning.includes("timeout") || unitWarning.includes("ETIMEDOUT")) {
          unitAcqOutcome = "TIMEOUT";
        } else {
          unitAcqOutcome = "TRANSPORT_ERROR";
        }
      } else if (cards.length === 0) {
        unitAcqOutcome = "SUCCESS_EMPTY";
      }

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
        noveltyRate: cardsParsed > 0 ? (novelAccepted / cardsParsed) : (unitAcqOutcome === "SUCCESS_EMPTY" ? 0 : 1.0),
        elapsedMs: runtimeMs,
        timestamp: new Date().toISOString(),
        outcome: unitAcqOutcome,
        hasTransportError: unitAcqOutcome !== "SUCCESS" && unitAcqOutcome !== "SUCCESS_EMPTY"
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
      extractionErrors: identityFailed + validationFailed,
      qualified: null,
      recommended: null,
      newCompanies: null,
      decision,
      reason
    };

    mgr.updateUnit(unit.id, { decisionRecord });

    log(`\n=== PAGE SUMMARY ===\nPortal: ${unit.portal}\nKeyword: ${unit.keyword}\nPage: ${unit.page}\n\nCards Seen ............ ${cards.length}\nCards Parsed .......... ${cardsParsed}\n  ├── Canonical Duplicates ... ${canonicalDuplicates}\n  ├── Ledger Known ........... ${ledgerKnown}\n  ├── Hard Filtered .......... ${hardFiltered}\n  ├── Identity Failures ...... ${identityFailed}\n  ├── Validation Failures .... ${validationFailed}\n  └── Novel Accepted ......... ${novelAccepted} (Acquired: ${novelAcquired})\n\nNovelty Rate .......... ${((novelAccepted / Math.max(1, cardsParsed)) * 100).toFixed(1)}%\nDecision .............. ${decision}\nReason ................ ${reason}\n====================\n`, "info");
    
    if (outcome.status !== "aborted") {
      outcome.status = cards.length === 0 ? "skipped_empty" : "completed";
    }
  } catch (err: any) {
    if (mgr.isCancellationRequested() || err?.message?.includes("Target page, context or browser has been closed") || err?.message?.includes("browser has been closed")) {
      outcome.status = "aborted";
    } else {
      outcome.status = "failed";
      outcome.warnings.push(`Exception: ${err.message}`);
      log(`processUnit exception for ${unit.id}: ${err.stack || err.message}`, "error");
    }
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
