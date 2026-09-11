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
import {
  CONFIG,
  DEFAULT_KEYWORDS,
  DEFAULT_PORTALS,
  SNAPSHOT_DIR,
  EXTRACTION_DIR,
  verifyArtifactStorage,
  GLOBAL_MARKET_LOCK_PATH,
  RUNS_DIR,
} from "./scraper/config";
import { resolveScraperRuntimeOptions, type ScraperRuntimeOptions } from "./scraper/options";
import { makeLogger } from "./scraper/utils/logger";
import { pool } from "./scraper/utils/concurrency";
import { jitter } from "./scraper/utils/jitter";
import { RunController, type RunControllerOptions } from "./scraper/run/manager";
import {
  acquireExclusiveLock,
  releaseExclusiveLock,
  type ExclusiveLockToken,
} from "./scraper/run/exclusive-lock";
import { linkedinHandler } from "./scraper/portals/linkedin";
import { indeedHandler } from "./scraper/portals/indeed";
import { naukriHandler } from "./scraper/portals/naukri";
import {
  closeAllPortalContexts,
  getPortalContext,
  closePortalContextsForRun,
} from "./scraper/portals/base";
import { PageManager } from "./scraper/run/page-manager";
import type {
  CardUnit,
  DetailedCard,
  FeedCard,
  PortalHandler,
  PortalName,
  WorkUnit,
  AcquisitionAttempt,
  AcquisitionOutcome,
  AcquisitionVariant,
} from "./scraper/types";
import { sanitizeCompanyName } from "./scraper/utils/sanitize";
import {
  compileCoverageVariants,
  compileMultiLocationCoverageVariants,
  createFreshnessVariant,
  createAdaptivePageVariant,
  evaluateSourceNovelty,
} from "./scraper/run/acquisition-variants";
import { normalizeUrl } from "./scraper/utils/url";
import { getDatabaseAdapter } from "../src/data/database";
import { fastFetchDetail } from "./scraper/utils/http-fetch";
import { EnrichmentQueue } from "./scraper/persist/queue";
import { resolveCanonicalIdentity, sourceIdentityForCard, acquisitionSurfaceKey } from "../src/lib/acquisition/canonical-identity";
import { parseVerifiedIndeedListingUrl } from "../src/lib/acquisition/indeed-listing-identity";
import {
  FailurePolicyEngine,
  type FailureClass,
  normalizeFailureClass,
  classifyCardFailure,
} from "../src/lib/acquisition/failure-taxonomy";
import { ResponseValidator } from "../src/lib/acquisition/validator";
import { passesHardFilter } from "./scraper/utils/hard-filter";
import { HealthManager } from "./scraper/run/health-manager";
import { QueryMetricsStore } from "./scraper/run/metrics";
import { getRepositories } from "../src/data/sqlite/provider";
import { CredentialBroker } from "../src/lib/security/CredentialBroker";
import { establishPortalAuthSession, type PortalAuthSession } from "../src/lib/security/PortalAuthSession";
import crypto from "crypto";
import type { AuthContext } from "../src/lib/security/auth";
import {
  CanonicalIngestionService,
  type CanonicalIngestionResult,
  AcquisitionIntegrityError,
} from "../src/lib/acquisition/CanonicalIngestionService";

export async function withPersistenceBoundary<T>(operationName: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (err instanceof AcquisitionIntegrityError) throw err;
    throw new AcquisitionIntegrityError(
      `Persistence failure during ${operationName}: ${err?.message}`,
      err
    );
  }
}

export interface ScraperCapabilities {
  databaseAvailable: boolean;
  canonicalPersistenceEnabled: boolean;
  enrichmentDispatchEnabled: boolean;
  localArtifactPersistenceEnabled: boolean;
}

export async function resolveScraperCapabilities(
  mode: "GLOBAL_MARKET" | "SCOPED"
): Promise<ScraperCapabilities> {
  let databaseAvailable = false;
  try {
    const db = getDatabaseAdapter();
    await db.one("SELECT 1");
    databaseAvailable = true;
  } catch {
    databaseAvailable = false;
  }

  if (mode === "SCOPED") {
    if (!databaseAvailable) {
      throw new Error(
        "FATAL_DATABASE_UNAVAILABLE: SCOPED mode requires a working database connection (Turso Cloud). Execution aborted."
      );
    }
    return {
      databaseAvailable: true,
      canonicalPersistenceEnabled: true,
      enrichmentDispatchEnabled: true,
      localArtifactPersistenceEnabled: true,
    };
  }

  // GLOBAL_MARKET mode
  if (!databaseAvailable) {
    return {
      databaseAvailable: false,
      canonicalPersistenceEnabled: false,
      enrichmentDispatchEnabled: false,
      localArtifactPersistenceEnabled: true,
    };
  }

  return {
    databaseAvailable: true,
    canonicalPersistenceEnabled: true,
    enrichmentDispatchEnabled: true,
    localArtifactPersistenceEnabled: true,
  };
}

export function computeVariantsSignature(variants?: AcquisitionVariant[]): string | undefined {
  if (!variants || variants.length === 0) return undefined;
  const normalized = variants.map((v) => {
    return {
      channel: v.channel ?? null,
      department: v.department ?? null,
      industry: v.industry ?? null,
      location: v.location ?? null,
      portal: v.portal ?? null,
      postedWithinDays: v.postedWithinDays ?? null,
      query: v.query ?? null,
      radiusKm: v.radiusKm ?? null,
      sort: v.sort ?? null,
    };
  });
  const sorted = normalized
    .map((obj) => JSON.stringify(obj))
    .sort()
    .join("|");
  return crypto.createHash("sha256").update(sorted).digest("hex");
}

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

let _enrichmentQueue: EnrichmentQueue | null = null;
function getEnrichmentQueue(): EnrichmentQueue {
  if (!_enrichmentQueue) {
    _enrichmentQueue = new EnrichmentQueue();
  }
  return _enrichmentQueue;
}

export async function syncManifestProgress(
  mgr: RunController,
  stage?: "discover" | "evaluate" | "prioritize" | "complete" | "stopped" | "failed"
) {
  const cardsFound = mgr.manifest.cards.length;
  let evaluated = 0;
  const runSession = activeRunSessions.get(mgr.runId);
  let enrichmentEnabled = true;
  if (runSession?.capabilities) {
    enrichmentEnabled = runSession.capabilities.enrichmentDispatchEnabled;
  } else {
    try {
      getDatabaseAdapter();
    } catch {
      enrichmentEnabled = false;
    }
  }
  if (enrichmentEnabled) {
    try {
      const stats = await getEnrichmentQueue().getRunStats(mgr.runId);
      evaluated = stats?.completed || 0;
    } catch {}
  }

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
    const units = mgr.manifest.units.filter(
      u => u.portal === portal
    );

    const hasRunning = units.some(
      u => u.status === "running"
    );

    const hasFailed = units.some(
      u => u.status === "failed"
    );

    const allTerminal =
      units.length > 0 &&
      units.every(
        u =>
          u.status === "done" ||
          u.status === "failed" ||
          u.status.startsWith("skipped") ||
          u.status === "aborted"
      );

    if (hasRunning) {
      sources[portal] = "searching";
    } else if (hasFailed) {
      sources[portal] = "failed";
    } else if (allTerminal) {
      sources[portal] = "completed";
    } else {
      sources[portal] = "pending";
    }
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
  maxCardsPerPage?: number;
  resume?: boolean;
  autoConfirm?: boolean;
  authContext?: AuthContext;
  searchPlanId?: string;
  resolvedPlan?: import("../src/lib/intelligence/ScraperPlanResolver").ResolvedScraperPlan;
  variants?: AcquisitionVariant[];
}

export interface RunRuntimeSession {
  runId: string;
  tenantId?: string;
  personId?: string;
  capabilities?: ScraperCapabilities;
  health: import("./scraper/run/health-manager").RunHealthManager;
  contexts: Map<PortalName, any>;
  pages: Map<PortalName, any>;
  pageManagers: Map<PortalName, PageManager>;
  authSessions: Map<PortalName, PortalAuthSession>;
}

export const activeRunSessions = new Map<string, RunRuntimeSession>();

export const activeRunControllers = new Map<string, RunController>();

export function createRunSession(
  runId: string,
  opts: RunOptions,
  capabilities?: ScraperCapabilities,
): RunRuntimeSession {
  const session: RunRuntimeSession = {
    runId,
    tenantId: opts.authContext?.tenantId,
    personId: opts.authContext?.userId,
    capabilities,
    health: HealthManager.forRun(runId),
    contexts: new Map(),
    pages: new Map(),
    pageManagers: new Map(),
    authSessions: new Map(),
  };

  activeRunSessions.set(runId, session);

  return session;
}

export async function abortLiveRun(runId?: string): Promise<boolean> {
  if (runId) {
    const mgr = activeRunControllers.get(runId);
    const runtime = activeRunSessions.get(runId);

    if (!mgr) {
      return false;
    }

    mgr.manifest.status = "stopping";
    mgr.persistManifest();

    if (runtime) {
      for (const session of runtime.authSessions.values()) {
        session.dispose();
      }
      runtime.authSessions.clear();
    }

    await closePortalContextsForRun(runId);

    HealthManager.clearRun(runId);
    activeRunSessions.delete(runId);

    return true;
  }

  await shutdownAllRuns("explicit-global-abort");

  return true;
}

let shutdownStarted = false;

export async function shutdownAllRuns(reason: string): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;

  try {
    const controllers = [...activeRunControllers.entries()];
    const sessions = [...activeRunSessions.entries()];

    for (const [, mgr] of controllers) {
      try {
        mgr.manifest.status = "stopping";
        mgr.persistManifest();
      } catch {}
    }

    for (const [, runtime] of sessions) {
      for (const authSession of runtime.authSessions.values()) {
        authSession.dispose();
      }
      runtime.authSessions.clear();
    }

    await closeAllPortalContexts();

    for (const [runId] of sessions) {
      HealthManager.clearRun(runId);
    }

    activeRunSessions.clear();

    for (const [, mgr] of controllers) {
      try {
        mgr.finalize("aborted");
      } catch {}
    }

    activeRunControllers.clear();
  } finally {
    shutdownStarted = false;
  }
}

let signalsInstalled = false;

function installSignalHandlers(): void {
  if (signalsInstalled) return;
  signalsInstalled = true;

  process.once("SIGINT", () => {
    void shutdownAllRuns("SIGINT").finally(() => process.exit(0));
  });

  process.once("SIGTERM", () => {
    void shutdownAllRuns("SIGTERM").finally(() => process.exit(0));
  });
}

installSignalHandlers();

export async function startRun(opts: RunOptions = {}): Promise<{ runId: string; completion: Promise<{ success: boolean; count: number; runId: string }> }> {
  const log = makeLogger("scrape");
  const storageRes = verifyArtifactStorage();
  if (!storageRes.ok) {
    throw new Error(`STORAGE_UNWRITABLE: ${storageRes.fatalError || "Essential artifact storage unwritable"}`);
  }
  if (storageRes.cacheDegraded) {
    log(`[Storage] Non-essential cache directories degraded: ${storageRes.warnings.join("; ")}`, "warn");
  }

  const runtimeOpts = resolveScraperRuntimeOptions(process.argv.slice(2), process.env);
  const explicitScoped = runtimeOpts.mode === "SCOPED" || process.argv.includes("--scoped");
  const hasTenant = Boolean(opts.authContext?.tenantId || runtimeOpts.tenantId);
  const hasPerson = Boolean(opts.authContext?.userId || runtimeOpts.personId);

  // Partial SCOPED identity must fail closed BEFORE any browser launch
  if ((explicitScoped && (!hasTenant || !hasPerson)) || (hasTenant && !hasPerson) || (!hasTenant && hasPerson)) {
    throw new Error(
      `PARTIAL_SCOPED_IDENTITY: SCOPED mode requires both --tenant-id and --person-id. Provided tenantId=${opts.authContext?.tenantId || runtimeOpts.tenantId || "none"}, personId=${opts.authContext?.userId || runtimeOpts.personId || "none"}. Refusing execution before browser initialization.`
    );
  }

  let effectiveAuthContext: any = opts.authContext;
  if (!effectiveAuthContext && (hasTenant && hasPerson)) {
    const { resolveScraperAuthContext } = await import("../src/lib/security/scope-resolver");
    const db = getDatabaseAdapter();
    const resolvedAuth = await resolveScraperAuthContext(
      runtimeOpts.personId!,
      runtimeOpts.tenantId!,
      db
    );
    effectiveAuthContext = resolvedAuth.authContext;
  }

  const mode = effectiveAuthContext ? "SCOPED" : "GLOBAL_MARKET";
  const effectiveSearchPlanId = opts.searchPlanId || runtimeOpts.searchPlanId;
  const capabilities = await resolveScraperCapabilities(mode);

  if (!capabilities.databaseAvailable && mode === "GLOBAL_MARKET") {
    log(
      "GLOBAL_MARKET running in LOCAL_ONLY mode: canonical persistence and enrichment queue are disabled.",
      "warn"
    );
  }

  const freshRun = runtimeOpts.fresh || process.argv.includes('--fresh') || process.env.FRESH_RUN === 'true';

  let keywords = opts.keywords ?? (runtimeOpts.keywords && runtimeOpts.keywords.length > 0 ? runtimeOpts.keywords : undefined);
  let portals = opts.portals ?? (runtimeOpts.portals.length > 0 ? runtimeOpts.portals : DEFAULT_PORTALS);
  let maxPages = opts.maxPages ?? runtimeOpts.maxPages ?? CONFIG.maxPages;
  const maxCardsPerPage = opts.maxCardsPerPage ?? runtimeOpts.maxCardsPerPage;

  const resolvedAutoConfirm = opts.autoConfirm !== undefined ? opts.autoConfirm : runtimeOpts.autoConfirm;
  if (!resolvedAutoConfirm) {
    if (runtimeOpts.headless || (typeof process !== "undefined" && !process.stdin.isTTY)) {
      throw new Error(
        "CONFIRMATION_NOT_SUPPORTED_NON_INTERACTIVE: Scraper paused for manual confirmation, but running in headless mode or non-interactive TTY. Set --auto-confirm or AUTO_CONFIRM=true."
      );
    }
  }

  let resolvedPlan: import("../src/lib/intelligence/ScraperPlanResolver").ResolvedScraperPlan | undefined = opts.resolvedPlan;
  let searchSource: "PLAN" | "SUPPLIED" | "DEFAULT" = "DEFAULT";
  let evaluationProjection: "ACTIVE" | "DEFERRED_NO_SEARCH_PLAN" = "DEFERRED_NO_SEARCH_PLAN";

  if (effectiveAuthContext) {
    const { ScraperPlanResolver } = await import("../src/lib/intelligence/ScraperPlanResolver");
    const db = getDatabaseAdapter();
    const scope = { tenantId: effectiveAuthContext.tenantId, personId: effectiveAuthContext.userId };

    try {
      resolvedPlan = opts.resolvedPlan || (await ScraperPlanResolver.resolveActivePlan(
        scope,
        undefined,
        db,
        effectiveSearchPlanId
      ));
    } catch (planErr: any) {
      log(`[ScraperAuth] Failed to resolve active search plan: ${planErr.message}`, "warn");
    }

    if (resolvedPlan && resolvedPlan.queries.length > 0) {
      keywords = resolvedPlan.queries;
      searchSource = "PLAN";
      evaluationProjection = "ACTIVE";
      log(
        `Resolved active evaluation context:\n` +
        `  tenant=${scope.tenantId}\n` +
        `  person=${scope.personId}\n` +
        `  searchPlan=${resolvedPlan.searchPlanId}\n` +
        `  snapshot=${resolvedPlan.snapshotId || "dynamic"}\n` +
        `  queries=${resolvedPlan.queryCount}\n\n` +
        `Using persisted search plan.`
      );
    } else {
      // Planless SCOPED execution per Amendment 1
      if (keywords && keywords.length > 0) {
        searchSource = "SUPPLIED";
      } else {
        keywords = DEFAULT_KEYWORDS;
        searchSource = "DEFAULT";
      }
      evaluationProjection = "DEFERRED_NO_SEARCH_PLAN";
      resolvedPlan = undefined;
      log(
        `[ScraperAuth] Running planless scoped acquisition for tenant ${effectiveAuthContext.tenantId} (person: ${effectiveAuthContext.userId}).\n` +
        `  searchSource=${searchSource}, evaluationProjection=${evaluationProjection}. Queries: ${keywords.length}. Evaluation deferred until search plan created.`
      );
    }
  } else if (!keywords) {
    keywords = DEFAULT_KEYWORDS;
    searchSource = "DEFAULT";
    evaluationProjection = "DEFERRED_NO_SEARCH_PLAN";
    log(`Running in offline unauthenticated mode: using manual/default keywords (${keywords.length} queries).`);
  }
  
  const resolvedKeywords = keywords;
  const resolvedVariants = opts.variants || (resolvedPlan ? compileMultiLocationCoverageVariants(resolvedPlan, portals) : undefined);
  const variantsSignature = computeVariantsSignature(resolvedVariants);

  const runControllerOpts: RunControllerOptions = {
    keywords: resolvedKeywords,
    portals,
    maxPages,
    maxCardsPerPage: maxCardsPerPage ?? CONFIG.maxCardsPerPage,
    resume: freshRun ? false : (opts.resume !== false),
    variants: resolvedVariants,
    adaptiveDepth: true,
    initialPages: 1,
    searchPlanId: resolvedPlan?.searchPlanId || effectiveSearchPlanId,
    snapshotId: resolvedPlan?.snapshotId,
    contextFingerprint: resolvedPlan?.contextFingerprint,
    variantsSignature,
  };

  let mgr = new RunController();
  let resumed = false;
  let runScope: any = null;
  let globalMarketLock: ExclusiveLockToken | null = null;

  if (effectiveAuthContext) {
    runScope = {
      tenantId: effectiveAuthContext.tenantId,
      personId: effectiveAuthContext.userId,
      roles: [],
    };
    try {
      const repos = getRepositories();
      const activeDurableRun = await repos.scrapeRuns.getActiveRun(runScope);

      if (activeDurableRun) {
        const activeStatus = activeDurableRun.status;

        // Invariant: If actively in downstream pipeline, refuse fresh acquisition to protect workers
        if (activeStatus === "enriching" || activeStatus === "completing") {
          log(
            `Active durable run ${activeDurableRun.id} is currently in downstream state '${activeStatus}'. Refusing fresh acquisition to protect active downstream pipeline.`,
            "error"
          );
          throw new Error(
            `Cannot start fresh acquisition for (${runScope.tenantId}, ${runScope.personId}): active run ${activeDurableRun.id} is currently ${activeStatus}.`
          );
        }

        const earlyRecoveryPhases = ["queued", "initializing", "waiting_for_confirmation", "running", "stopping"];
        const isEarlyPhase = earlyRecoveryPhases.includes(activeStatus);

        let tryResumed = false;
        if (!freshRun && opts.resume !== false) {
          // Check reattachment / resume based on active status
          if (activeStatus === "waiting_for_confirmation") {
            const reattachable = mgr.tryLoadForConfirmationReattach(activeDurableRun.id, runControllerOpts);
            if (reattachable) {
              mgr.attachExistingRun(reattachable);
              resumed = true;
              tryResumed = true;
              log(`Reattached to existing durable scrape_run in waiting_for_confirmation: ${mgr.runId}`);
            }
          } else if (activeStatus === "initializing" || activeStatus === "running") {
            const resumable = mgr.tryLoadForResume(activeDurableRun.id, runControllerOpts);
            if (resumable) {
              mgr.attachExistingRun(resumable);
              resumed = true;
              tryResumed = true;
              log(`Validated existing durable scrape_run for resume: ${mgr.runId} (status: ${activeStatus})`);
            }
          }
        }

        if (!tryResumed) {
          if (isEarlyPhase) {
            log(
              `Active durable run ${activeDurableRun.id} in state '${activeStatus}' is unresumable or fresh run requested. Transitioning to aborted (LOCAL_RUNTIME_STATE_UNRECOVERABLE).`,
              "warn"
            );
            await repos.scrapeRuns.transitionRunStatus(
              runScope,
              activeDurableRun.id,
              activeStatus as any,
              "aborted",
              "LOCAL_RUNTIME_STATE_UNRECOVERABLE: local manifest missing or incompatible"
            );
            await repos.scrapeRuns.recordEvent(runScope, activeDurableRun.id, {
              stage: "recovery",
              eventType: "RUN_ABORTED_UNRESUMABLE",
              payload: {
                previousStatus: activeStatus,
                reason: "LOCAL_RUNTIME_STATE_UNRECOVERABLE",
              },
            });
          } else {
            throw new Error(
              `Cannot resume active run ${activeDurableRun.id} in state '${activeStatus}': local manifest missing or incompatible.`
            );
          }
        }
      }

      if (!resumed) {
        // No active durable run (or previous unresumable run aborted). Create clean new run!
        const newRunId = RunController.generateRunId();
        await repos.scrapeRuns.createRun(runScope, {
          id: newRunId,
          searchPlanId: resolvedPlan ? resolvedPlan.searchPlanId : (effectiveSearchPlanId || null),
          portalTargets: portals,
          initialStatus: "initializing",
          config: {
            maxPages,
            keywords: resolvedKeywords,
            searchSource,
            evaluationProjection,
            acquisitionIdentity: resolvedPlan ? {
              searchPlanId: resolvedPlan?.searchPlanId,
              snapshotId: resolvedPlan?.snapshotId,
              contextFingerprint: resolvedPlan?.contextFingerprint,
              variantsSignature,
            } : {
              variantsSignature,
            },
          },
        });
        log(`Created new durable scrape_run in Turso Cloud: ${newRunId}`);

        // Initialize local RunController with compensation if it fails
        try {
          mgr.initFresh(newRunId, runControllerOpts);
        } catch (initErr: any) {
          log(`Local initFresh failed for ${newRunId}: ${initErr.message}; compensating in Turso Cloud`, "error");
          try {
            await repos.scrapeRuns.transitionRunStatus(
              runScope,
              newRunId,
              "initializing",
              "aborted",
              `Local initialization failed: ${initErr.message}`
            );
          } catch (compErr: any) {
            log(`Failed to compensate aborted run ${newRunId}: ${compErr.message}`, "error");
          }
          throw initErr;
        }
      }
    } catch (e: any) {
      log(`Failed to create or validate durable scrape_run: ${e.message}`, "warn");
      throw e;
    }
  } else {
    // Unauthenticated mode: standard local RunController init
    globalMarketLock = acquireExclusiveLock(
      GLOBAL_MARKET_LOCK_PATH,
      `global-market:${process.pid}`,
    );

    try {
      const initRes = mgr.init(runControllerOpts);
      resumed = initRes.resumed;
    } catch (err) {
      releaseExclusiveLock(globalMarketLock);
      globalMarketLock = null;
      throw err;
    }
  }

  activeRunControllers.set(mgr.runId, mgr);
  const effectiveRunOpts: RunOptions = {
    ...opts,
    authContext: effectiveAuthContext,
    searchPlanId: effectiveSearchPlanId,
    resolvedPlan,
  };
  const runtime = createRunSession(mgr.runId, effectiveRunOpts, capabilities);
  if (!capabilities.canonicalPersistenceEnabled) {
    (mgr.manifest as any).executionMode = "LOCAL_ONLY_NO_CANONICAL_PERSISTENCE";
  }

  mgr.recordActivity("Building executive search schema from candidate profile...");
  const plannedUnits = mgr.manifest.units.length;
  log(`Run ${mgr.runId} ${resumed ? "resumed" : "started"} — portals=${mgr.manifest.portals.join(",")} units=${plannedUnits}`);
  mgr.recordActivity(`Search schema armed: ${plannedUnits} work units across ${portals.join(", ")}`);

  const seenUrls = new Set<string>();           // cross-portal exact URL dedup (authoritative)
  const seenCanonicalIds = new Set<string>();   // cross-portal canonical ID dedup (authoritative)
  const seenAtsUrls = new Set<string>();        // cross-portal ATS target URL dedup (authoritative)
  const seenHeuristicKeys = new Set<string>();  // cross-portal heuristic telemetry only

  const completion = (async () => {
    try {
      // Phase 1: Initializing
      if (mgr.manifest.status !== "waiting_for_confirmation" && mgr.manifest.status !== "running") {
        mgr.transitionTo("initializing");
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
        try {
          browserContext = await getPortalContext(
            portal,
            {
              runId: mgr.runId,
              mode: runScope ? "SCOPED" : "GLOBAL_MARKET",
              tenantId: effectiveAuthContext?.tenantId,
              personId: effectiveAuthContext?.userId,
            },
            {},
            {
              headless: runtimeOpts.headless,
            }
          );
        } catch (err: any) { 
          plog(`context launch failed: ${err.message}`, "error"); 
          mgr.updatePortalHealth(portal, { status: "error", details: err.message });
          mgr.recordActivity(`Error connecting to ${portal}: ${err.message}`);
          
          const errCode = err?.code || "PORTAL_INITIALIZATION_FAILED";
          for (const u of mgr.manifest.units) {
            if (u.portal === portal && (u.status === "pending" || u.status === "running")) {
              mgr.updateUnit(u.id, {
                status: "failed",
                error: `[${errCode}] ${err.message}`,
              });
            }
          }
          return null; 
        }
        
        runtime.contexts.set(portal, browserContext);
        const pageManager = new PageManager(portal, browserContext);
        runtime.pageManagers.set(portal, pageManager);
        const { searchPage, detailPage, searchMutex, detailMutex } = await pageManager.initialize();
        runtime.pages.set(portal, searchPage);

        // Establish JIT PortalAuthSession without retaining plaintext secrets
        let authSession: PortalAuthSession | null = null;
        try {
          if (opts.authContext) {
            const repos = await getRepositories();
            const broker = new CredentialBroker(repos.credentials);
            authSession = await establishPortalAuthSession(broker, opts.authContext, portal, browserContext);
            if (authSession) {
              runtime.authSessions.set(portal, authSession);
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
          for (const u of mgr.manifest.units) {
            if (u.portal === portal && (u.status === "pending" || u.status === "running")) {
              mgr.updateUnit(u.id, {
                status: "failed",
                error: `[PORTAL_INITIALIZATION_FAILED] Session error`,
              });
            }
          }
          runtime.contexts.delete(portal);
          runtime.pages.delete(portal);
          runtime.pageManagers.delete(portal);
          runtime.authSessions.delete(portal);
          return null;
        }

        if (sessionStatus === "ready") {
          // Navigate to search page so user can visually verify
          const targetMaxCards = maxCardsPerPage ?? CONFIG.getMaxCardsPerPage(portal);
          const searchUrl = handler.buildSearchUrl({
            ...(units[0].variant || {}),
            query: units[0].keyword,
            page: units[0].page,
            maxCardsPerPage: targetMaxCards,
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
          if (resolvedAutoConfirm) {
            for (const u of mgr.manifest.units) {
              if (u.portal === portal && (u.status === "pending" || u.status === "running")) {
                mgr.updateUnit(u.id, {
                  status: "skipped_gated",
                  error: `[PORTAL_SESSION_GATED] Portal requires manual authentication or captcha`,
                });
              }
            }
          }
        }
      });

      // Phase 2: Confirmation / Polling Pause
      if (!resolvedAutoConfirm) {
        mgr.transitionTo("waiting_for_confirmation");
        if (runScope) {
          const repos = getRepositories();
          const transitioned =
            await repos.scrapeRuns.transitionRunStatus(
              runScope,
              mgr.runId,
              "initializing",
              "waiting_for_confirmation"
            );

          if (!transitioned) {
            const refreshed =
              await repos.scrapeRuns.getRun(runScope, mgr.runId);

            if (
              refreshed?.status !== "waiting_for_confirmation" &&
              refreshed?.status !== "running"
            ) {
              throw new Error(
                `WAITING_CONFIRMATION_CAS_CONFLICT: ${refreshed?.status}`
              );
            }
          }
        }
        log("Waiting for user confirmation. (Set AUTO_CONFIRM=true to bypass)");
        const deadline = Date.now() + 15 * 60 * 1000; // 15 mins
        if (runScope) {
          while (true) {
            if (Date.now() > deadline) {
              const repos = getRepositories();

              const transitioned =
                await repos.scrapeRuns.transitionRunStatus(
                  runScope,
                  mgr.runId,
                  "waiting_for_confirmation",
                  "aborted",
                  "Confirmation timeout (15 mins)"
                );

              const refreshed =
                await repos.scrapeRuns.getRun(
                  runScope,
                  mgr.runId
                );

              if (
                !transitioned &&
                refreshed?.status !== "aborted"
              ) {
                throw new Error(
                  `CONFIRMATION_TIMEOUT_CAS_CONFLICT: durable status=${refreshed?.status}`
                );
              }

              mgr.manifest.status = "aborted";
              mgr.persistManifest();
              break;
            }

            const durableRun =
              await getRepositories()
                .scrapeRuns
                .getRun(runScope, mgr.runId);

            if (!durableRun) {
              throw new Error(
                "DURABLE_RUN_DISAPPEARED_DURING_CONFIRMATION"
              );
            }

            if (durableRun.status === "running") {
              mgr.manifest.status = "running";
              mgr.persistManifest();
              break;
            }

            if (durableRun.status === "aborted") {
              mgr.manifest.status = "aborted";
              mgr.persistManifest();
              break;
            }

            if (
              durableRun.status !== "waiting_for_confirmation"
            ) {
              throw new Error(
                `CONFIRMATION_STATE_CONFLICT: ${durableRun.status}`
              );
            }

            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } else {
          // Unauthenticated / local-only confirmation polling
          while (true) {
            if (Date.now() > deadline) {
              mgr.manifest.status = "aborted";
              mgr.persistManifest();
              break;
            }
            let currentManifest = mgr.manifest;
            try {
              currentManifest = JSON.parse(fs.readFileSync(mgr.manifestPath, "utf-8"));
            } catch {}
            if (currentManifest.status === "running") {
              mgr.manifest.status = "running";
              break;
            }
            if (currentManifest.status === "aborted") {
              mgr.manifest.status = "aborted";
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      } else {
        if (runScope) {
          let transitioned = false;
          try {
            transitioned = await getRepositories().scrapeRuns.transitionRunStatus(
              runScope,
              mgr.runId,
              ["initializing", "waiting_for_confirmation"],
              "running"
            );
          } catch (e: any) {
            log(`Error during auto-confirm transition to running: ${e.message}`, "error");
            mgr.manifest.status = "failed";
            mgr.finalize("failed");
            throw new Error(`AUTO_CONFIRM_CAS_FAILED: ${e.message}`);
          }

          if (!transitioned) {
            const durableRun = await getRepositories().scrapeRuns.getRun(runScope, mgr.runId);
            if (durableRun?.status !== "running") {
              log(`Auto-confirm CAS failed: durable run status is '${durableRun?.status}', expected 'running'`, "error");
              mgr.manifest.status = "failed";
              mgr.finalize("failed");
              throw new Error(`AUTO_CONFIRM_CAS_FAILED: Durable run status is '${durableRun?.status}', not 'running'`);
            }
          }
        }
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
        const browserContext = runtime.contexts.get(portal);
        const activePage = runtime.pages.get(portal);
        if (!browserContext || !activePage) {
          for (const u of mgr.manifest.units) {
            if (u.portal === portal && (u.status === "pending" || u.status === "running")) {
              mgr.updateUnit(u.id, {
                status: "failed",
                error: `[PORTAL_INITIALIZATION_FAILED] Portal context unavailable`,
              });
            }
          }
          return;
        }

        mgr.updatePortalHealth(portal, { status: "ready", details: "Executing" });
        plog(`Active tabs before execution: ${browserContext.pages().length}`);

        let portalIngested = 0;
        let portalFacts = 0;

        while (!mgr.isCancellationRequested()) {
          const unit = mgr.nextPendingUnitForPortal(portal);
          if (!unit) break;

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
            seenUrls,
            seenCanonicalIds,
            seenAtsUrls,
            seenHeuristicKeys,
            plog,
            maxCardsPerPage,
            runScope ? { tenantId: runScope.tenantId, personId: runScope.personId, searchPlanId: resolvedPlan?.searchPlanId || effectiveSearchPlanId } : undefined,
            resolvedPlan?.criteria,
            runtime.pageManagers.get(unit.portal),
            runtime.authSessions.get(unit.portal),
          );
          if (outcome) {
            portalIngested += outcome.opportunities;
            portalFacts += outcome.factsCreated;
            if (outcome.pausePortalQueue) {
              plog(`Portal queue pause triggered for ${unit.portal}. Pruning remaining pending units for this portal.`, "warn");
              for (const u of mgr.manifest.units) {
                if (u.portal === unit.portal && u.status === "pending") {
                  mgr.updateUnit(u.id, {
                    status: "skipped_gated",
                    error: `Pruned due to portal pause condition in ${unit.id}`
                  });
                }
              }
              break;
            }
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

      // Certification: Ensure no units are left running or unexecuted
      const runningUnits = mgr.runningUnits();
      const pendingUnits = mgr.pendingUnits();
      if (runningUnits.length > 0 || pendingUnits.length > 0) {
        log(`CERTIFICATION FAILED: Incomplete work units detected (${runningUnits.length} running, ${pendingUnits.length} pending)!`, "error");
        mgr.manifest.status = "failed";
        mgr.finalize("failed");
        if (runScope) await getRepositories().scrapeRuns.updateRunStatus(runScope, mgr.runId, "failed", `Certification failed: ${runningUnits.length} units running, ${pendingUnits.length} units pending.`);
        return { success: false, count: ingestedCount, runId: mgr.runId };
      }

      const manifestCards = mgr.manifest.cards;
      const integrityFailureCards = manifestCards.filter(c => c.failureKind === "INTEGRITY_FAILURE");
      const sourceFailureCards = manifestCards.filter(c => c.failureKind === "SOURCE_FAILURE");
      const nonTerminalCards = manifestCards.filter(c => c.status === "pending" || c.status === "running");
      const unexplainedAttemptCards = manifestCards.filter(
        c => c.detailAttempted && !c.usableDetailDocument && !c.failureKind && c.status !== "skipped_gated"
      );

      mgr.recordTelemetry("acquisitionIntegrityFailures", integrityFailureCards.length);

      const tm = mgr.manifest.telemetry || { httpAttempted: 0, httpSuccessful: 0, httpFallbacks: 0, llmCalls: 0 };
      const failedUnits = mgr.manifest.units.filter(u => u.status === "failed");
      const integrityFailures = (mgr.getTelemetry("acquisitionIntegrityFailures" as any) || 0) + integrityFailureCards.length;
      const allUnitsFailedOrGated = mgr.manifest.units.length > 0 && mgr.manifest.units.every(u => u.status === "failed" || u.status === "skipped_gated");

      if (integrityFailures > 0 || allUnitsFailedOrGated) {
        log(`[Scrape] Run failed: ${integrityFailures > 0 ? `${integrityFailures} integrity failures` : `all ${mgr.manifest.units.length} units failed or gated`}. Failing run closed.`, "error");
        mgr.finalize("failed");
        if (runScope) {
          const repos = getRepositories();
          await repos.scrapeRuns.updateRunMetrics(runScope, mgr.runId, {
            totalDiscovered: mgr.manifest.cards.length,
            totalEnqueued: ingestedCount,
            metrics: tm as any,
          });
          await repos.scrapeRuns.updateRunStatus(
            runScope,
            mgr.runId,
            "failed",
            `Acquisition failed: ${failedUnits.length} unit(s) failed, ${integrityFailures} integrity failure(s)`
          );
        }
        printAcquisitionTelemetry(mgr);
        return { success: false, count: ingestedCount, runId: mgr.runId };
      }

      if (runScope && capabilities.enrichmentDispatchEnabled) {
        mgr.transitionTo("enriching");
        const repos = getRepositories();
        await repos.scrapeRuns.updateRunMetrics(runScope, mgr.runId, {
          totalDiscovered: mgr.manifest.cards.length,
          totalEnqueued: ingestedCount,
          metrics: tm as any,
        });
        const transitioned = await repos.scrapeRuns.updateRunStatus(runScope, mgr.runId, "enriching");
        if (!transitioned) {
          throw new Error(
            `Failed durable running->enriching transition for ${mgr.runId}`
          );
        }
        log(`[Scrape] Acquisition complete. Dispatched ${ingestedCount} cards to distributed enrichment & evaluation pipeline.`);
        mgr.recordActivity(`Acquisition complete · ${ingestedCount} cards dispatched for enrichment`);

        try {
          const { RunReconciliationService } = await import("../src/lib/intelligence/RunReconciliationService");
          const reconciler = new RunReconciliationService();
          await reconciler.reconcileRun(mgr.runId);
        } catch (e: any) {
          log(`[Scrape] Initial run reconciliation deferred: ${e.message}`, "warn");
        }
      } else {
        mgr.finalize("completed");
        try {
          const records = collectRecords();
          writeLiveScraped(records);
        } catch (err: any) {
          log(`[Scrape] Failed writing live-scraped output: ${err.message}`, "warn");
        }
        log(`[Scrape] Acquisition run complete (local terminalization). Manifest marked completed.`);
        mgr.recordActivity(`Acquisition complete · Local run finalized as completed`);
      }
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
      for (const session of runtime.authSessions.values()) {
        session.dispose();
      }
      runtime.authSessions.clear();
      await closePortalContextsForRun(mgr.runId);
      if (globalMarketLock) {
        try {
          releaseExclusiveLock(globalMarketLock);
          globalMarketLock = null;
        } catch {}
      }
      HealthManager.clearRun(mgr.runId);
      activeRunSessions.delete(mgr.runId);
      activeRunControllers.delete(mgr.runId);
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
  pausePortalQueue?: boolean;
};

export interface DetailPolicyDeps {
  sleep?: (ms: number) => Promise<void>;
  evaluatePolicy?: typeof FailurePolicyEngine.evaluate;
}

export async function executeCardDetailWithPolicy(
  options: {
    cardUnitId: string;
    cardUnit: CardUnit;
    mgr: RunController;

    fetchDetail: () => Promise<DetailedCard["detail"]>;

    validateDetail: (
      detail: DetailedCard["detail"]
    ) => ReturnType<typeof ResponseValidator.validate>;

    isPortalPaused: () => boolean;
    triggerPortalPause: () => void;
  },
  deps: DetailPolicyDeps = {},
): Promise<
  | {
      ok: true;
      detail: DetailedCard["detail"];
    }
  | {
      ok: false;
      failureClass?: FailureClass;
      paused: boolean;
    }
> {
  const sleep =
    deps.sleep ??
    ((ms: number) =>
      new Promise<void>(resolve => setTimeout(resolve, ms)));

  const evaluatePolicy =
    deps.evaluatePolicy ?? FailurePolicyEngine.evaluate;

  while (true) {
    if (options.isPortalPaused()) {
      options.mgr.updateCard(options.cardUnitId, {
        status: "skipped_gated",
        error: "Portal paused before detail acquisition",
      });

      return {
        ok: false,
        paused: true,
      };
    }

    const attempt =
      (options.cardUnit.attempts ?? 0) + 1;

    options.cardUnit.attempts = attempt;

    options.mgr.updateCard(options.cardUnitId, {
      attempts: attempt,
      detailAttempted: true,
    });

    const detail = await options.fetchDetail();
    const validation = options.validateDetail(detail);

    if (detail.fetched && validation.isValid) {
      options.mgr.updateCard(options.cardUnitId, {
        usableDetailDocument: true,
        failureClass: undefined,
        failureKind: undefined,
      });

      return {
        ok: true,
        detail,
      };
    }

    const failureClass = normalizeFailureClass(
      detail.failureClass ??
        validation.failureClass ??
        "UNKNOWN_FAILURE"
    );

    const policy = evaluatePolicy(
      failureClass,
      attempt
    );

    // Critical invariant: pause beats retry.
    if (policy.pausePortalQueue) {
      options.triggerPortalPause();

      options.mgr.updateCard(options.cardUnitId, {
        status: "failed",
        failureClass,
        failureKind: "SOURCE_FAILURE",
        error: `Portal paused: ${failureClass}`,
      });

      return {
        ok: false,
        failureClass,
        paused: true,
      };
    }

    if (policy.shouldRetry) {
      await sleep(policy.backoffMs);
      continue;
    }

    const failureKind =
      classifyCardFailure(failureClass);

    options.mgr.updateCard(options.cardUnitId, {
      status: "failed",
      failureClass,
      failureKind,
      error: `Detail acquisition failed: ${failureClass}`,
    });

    return {
      ok: false,
      failureClass,
      paused: false,
    };
  }
}

export function finalizeUnitOutcome(params: {
  cardsCount: number;
  manifestCards: CardUnit[];
  portalPauseTriggered?: boolean;
  pausePortalQueue?: boolean;
  initialStatus?: ProcessOutcome["status"];
}): { status: ProcessOutcome["status"]; warnings: string[] } {
  const warnings: string[] = [];
  let status: ProcessOutcome["status"] = params.initialStatus || "completed";

  const attemptedCards = params.manifestCards.filter(
    (c) => c.detailAttempted === true
  );

  const usableCards = attemptedCards.filter(
    (c) => c.usableDetailDocument === true
  );

  const integrityFailures = attemptedCards.filter(
    (c) => c.failureKind === "INTEGRITY_FAILURE"
  );

  const sourceFailures = attemptedCards.filter(
    (c) => c.failureKind === "SOURCE_FAILURE"
  );

  const nonTerminalAttempted = attemptedCards.filter(
    (c) => c.status === "pending" || c.status === "running"
  );

  const unexplainedAttempts = attemptedCards.filter(
    (c) =>
      !c.usableDetailDocument &&
      !c.failureKind &&
      c.status !== "skipped_gated"
  );

  if (status !== "aborted") {
    if (
      integrityFailures.length > 0 ||
      nonTerminalAttempted.length > 0 ||
      unexplainedAttempts.length > 0
    ) {
      status = "failed";
      warnings.push(
        `Unit failed: integrity=${integrityFailures.length}, nonTerminal=${nonTerminalAttempted.length}, unexplained=${unexplainedAttempts.length}`
      );
    } else if (params.portalPauseTriggered || params.pausePortalQueue) {
      status = "failed";
      warnings.push(`Unit failed due to portal pause condition`);
    } else if (
      attemptedCards.length > 0 &&
      usableCards.length === 0 &&
      sourceFailures.length === attemptedCards.length
    ) {
      status = "failed";
      warnings.push(
        `Unit failed: all ${attemptedCards.length} attempted cards failed with SOURCE_FAILURE`
      );
    } else if (usableCards.length > 0) {
      status = "completed";
    } else {
      status = params.cardsCount === 0 ? "skipped_empty" : "completed";
    }
  }

  return { status, warnings };
}

export async function processUnit(
  mgr: RunController,
  handler: PortalHandler,
  unit: WorkUnit,
  browserContext: any,
  activePage: any,
  seenUrls: Set<string>,
  seenCanonicalIds: Set<string>,
  seenAtsUrls: Set<string>,
  seenHeuristicKeys: Set<string>,
  log: ReturnType<typeof makeLogger>,
  maxCardsPerPage?: number,
  lineageScope?: { tenantId: string; personId: string; searchPlanId?: string | null },
  relevanceCriteria?: { targetRoles?: string[]; customParameters?: Record<string, unknown> },
  pageManager?: PageManager,
  authSession?: PortalAuthSession,
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
    const targetMaxCards = maxCardsPerPage ?? CONFIG.getMaxCardsPerPage(unit.portal);
    const searchUrl = handler.buildSearchUrl({
      ...(unit.variant || {}),
      query: unit.keyword,
      page: unit.page,
      maxCardsPerPage: targetMaxCards,
    });
    let cards: FeedCard[] = [];
    const pm = pageManager;
    
    try {
      cards = await handler.listCards({
        runId: mgr.runId, portal: unit.portal, keyword: unit.keyword, page: unit.page,
        searchUrl, browserContext, variant: unit.variant,
        maxCardsPerPage: maxCardsPerPage ?? CONFIG.getMaxCardsPerPage(unit.portal),
        searchPage: pm?.getPage("search") || activePage,
        detailPage: pm?.getPage("detail"),
        searchMutex: pm?.getMutex("search"),
        detailMutex: pm?.getMutex("detail"),
        pageManager: pm,
        activePage: pm?.getPage("search") || activePage,
        authSession: authSession,
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

    // Adaptive Depth Evaluation: evaluate live source-identity novelty
    const surfaceKey = acquisitionSurfaceKey(unit.variant, unit.portal, unit.keyword);
    let surfaceSeen = mgr.seenSourceIdentitiesBySurface.get(surfaceKey);
    if (!surfaceSeen) {
      surfaceSeen = new Set<string>();
      mgr.seenSourceIdentitiesBySurface.set(surfaceKey, surfaceSeen);
    }

    const discoveredSourceIds: string[] = cards.map((c: any) => sourceIdentityForCard(c)).filter(Boolean);

    const sourceNovelty = evaluateSourceNovelty(discoveredSourceIds, surfaceSeen, 0.25);

    // Record newly discovered IDs into surface history
    for (const id of discoveredSourceIds) {
      surfaceSeen.add(id);
    }

    const maxBudgetPages = mgr.manifest.maxPages || 3;
    if (sourceNovelty.shouldDeepen && unit.page < maxBudgetPages && !mgr.isCancellationRequested()) {
      const nextPage = unit.page + 1;
      const adaptivePageVariant = createAdaptivePageVariant(
        unit.variant || {
          portal: unit.portal,
          query: unit.keyword,
        },
        nextPage
      );
      const enqueued = mgr.enqueueAdaptivePageUnit(adaptivePageVariant);
      if (enqueued) {
        log(`[Adaptive Depth] Source novelty is ${(sourceNovelty.noveltyRatio * 100).toFixed(1)}% (${sourceNovelty.novelCount}/${sourceNovelty.uniqueSourceIdentities} unseen source IDs). Deepening ${surfaceKey} to page ${nextPage}.`, "info");
      }
    } else if (!sourceNovelty.shouldDeepen && unit.page > 0) {
      log(`[Adaptive Depth] Source novelty dropped to ${(sourceNovelty.noveltyRatio * 100).toFixed(1)}% (< 25% threshold). Halting deepening for ${surfaceKey} at page ${unit.page}.`, "info");
      // Prune any pre-enqueued subsequent pages for this surface
      for (const u of mgr.manifest.units) {
        const uKey = acquisitionSurfaceKey(u.variant, u.portal, u.keyword);
        if (uKey === surfaceKey && u.status === "pending" && u.page > unit.page) {
          mgr.updateUnit(u.id, {
            status: "skipped_pruned",
            error: `Pruned by source-identity novelty stopping rule (${(sourceNovelty.noveltyRatio * 100).toFixed(1)}% < 25% threshold)`,
          });
        }
      }
    }

    const cardMeta = cards.map((c) => ({ id: `${unit.id}#${c.cardHash}`, cardHash: c.cardHash }));
    mgr.addCards(unit.id, cardMeta);

    const runSession = activeRunSessions.get(mgr.runId);
    let isDbAvailable = true;
    if (runSession?.capabilities) {
      isDbAvailable = runSession.capabilities.databaseAvailable;
    } else {
      try {
        getDatabaseAdapter();
      } catch {
        isDbAvailable = false;
      }
    }
    const repos = isDbAvailable ? getRepositories() : null;
    /* Keep historical ledger recognition distinct from same-run duplicate
     * suppression. A known listing still proceeds to canonical ingestion so
     * its material source version can be reused or versioned correctly. */
    const historicalLedgerCardIds = new Set<string>();
    let pageCanonicalIngested = 0;
    let integrityFailuresInUnit = 0;
    let portalPauseTriggered = false;
    let attemptedDetailCount = 0;
    let usableDetailAcquired = 0;
    let sourceFailuresInUnit = 0;
    let primaryFailureClass: FailureClass | null = null;

    // Cards for a single unit run in parallel with a bounded pool.
    await pool(cards, CONFIG.detailConcurrency, async (feedCard) => {
      const cardUnitId = `${unit.id}#${feedCard.cardHash}`;
      if (mgr.isCancellationRequested()) {
        mgr.updateCard(cardUnitId, { status: "skipped_pruned", error: "Run cancelled/aborted" });
        return null;
      }
      if (portalPauseTriggered) {
        mgr.updateCard(cardUnitId, { status: "skipped_gated", error: "Portal paused due to anti-bot or access challenge" });
        return null;
      }
      const cardUnit = mgr.manifest.cards.find((c) => c.id === cardUnitId);
      if (!cardUnit || cardUnit.status === "done") return null;

      mgr.updateCard(cardUnitId, { status: "running" });
      mgr.recordActivity(`Reading JD: ${feedCard.title} (${feedCard.company})`);

      const recordLineage = async (
        ledgerId: string,
        sourceJobId: string,
        sourceUrl: string,
        validation: ReturnType<typeof ResponseValidator.validate>,
        canonical?: CanonicalIngestionResult,
        failureClass?: string,
        resolvedUrl?: string,
      ): Promise<void> => {
        // Unauthenticated local runs have no durable scrape_run scope. They are
        // intentionally outside the validation cohort; authenticated runs must
        // retain durable source-to-canonical provenance.
        if (!lineageScope || !repos) return;
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
          resolvedUrl,
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
          query: unit.keyword,
        }, {
          allowMissingCompany: unit.portal === "LinkedIn",
          targetRoles: relevanceCriteria?.targetRoles,
          targetFunctions: Array.isArray(relevanceCriteria?.customParameters?.functions)
            ? relevanceCriteria.customParameters.functions.filter(
                (value): value is string => typeof value === "string",
              )
            : Array.isArray(relevanceCriteria?.customParameters?.function)
              ? relevanceCriteria.customParameters.function.filter(
                  (value): value is string => typeof value === "string",
                )
            : [],
        });

        if (!preQual.pass) {
          mgr.recordTelemetry("hardFiltered");
          mgr.updateCard(cardUnitId, {
            status: "skipped_empty",
            error: `[HardFilter:${preQual.reasonCode}] ${preQual.reason}`,
            failureKind: "EXPECTED_REJECTION",
          });
          return null;
        }

        // 2. Canonical Identity Resolution
        const identity = resolveCanonicalIdentity({
          portal: unit.portal,
          url: feedCard.detailUrl,
          title: feedCard.title,
          companyName: feedCard.company || "Confidential / Unknown",
          rawJobId: feedCard.sourceJobId,
        });

        // Pre-detail duplicate detection is intentionally current-run only.
        // Historical records are handled by the ledger/canonical ingestion path.
        const isInMemoryDuplicate = seenUrls.has(identity.canonicalUrl) || seenCanonicalIds.has(identity.canonicalJobId);
        if (isInMemoryDuplicate) {
          mgr.recordTelemetry("duplicatePreDetail");
          mgr.updateCard(cardUnitId, {
            status: "skipped_empty",
            error: "Duplicate Canonical URL (Current Run, Pre-Detail)",
            failureKind: "EXPECTED_REJECTION",
          });
          outcome.duplicates++;
          return null;
        }

        if (portalPauseTriggered) {
          log(`Skipping card ${cardUnitId} because portal ${unit.portal} queue is paused`, "warn");
          return null;
        }

        attemptedDetailCount++;
        mgr.updateCard(cardUnitId, { detailAttempted: true, usableDetailDocument: false });
        seenUrls.add(identity.canonicalUrl);
        seenCanonicalIds.add(identity.canonicalJobId);

        let priorLedgerItem: any = null;
        let ledgerItem: any = {
          id: `local:${identity.sourcePortal}:${identity.canonicalJobId}`,
          sourceJobId: identity.sourceJobId,
        };

        if (repos) {
          const res = await withPersistenceBoundary("initial ledger discovery", async () => {
            const prior = await repos.acquisition.getLedgerItemByCanonicalId(
              identity.sourcePortal,
              identity.canonicalJobId,
            );
            const item = await repos.acquisition.upsertDiscoveredJob({
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
            return { priorLedgerItem: prior, ledgerItem: item };
          });
          priorLedgerItem = res.priorLedgerItem;
          ledgerItem = res.ledgerItem;
        }
        if (priorLedgerItem) historicalLedgerCardIds.add(cardUnitId);

        const snapshotPath = path.join(SNAPSHOT_DIR, `${feedCard.cardHash}.json`);
        const isHistoricallyNew = !priorLedgerItem && !fs.existsSync(snapshotPath);
        let detailedCard: import("./scraper/types").DetailedCard | null = null;
        let canonicalIngestionResult: CanonicalIngestionResult | undefined;
        let snapshot = readSnapshotIfFresh(feedCard.cardHash, CONFIG.snapshotFreshHours);
        let detail: import("./scraper/types").DetailedCard["detail"] = {
          fetched: false,
          rawHtml: "",
          rawText: "",
          fetchDurationMs: 0,
        };
        let acquisitionRoute: import("./scraper/types").AcquisitionRoute = "DISCOVERY_RICH";
        let enrichmentStatus: import("./scraper/types").EnrichmentStatus = "NOT_APPLICABLE";
        let fallbackRoute: string | undefined = undefined;
        const acquisitionAttempts: AcquisitionAttempt[] = [];

        const detailResult = await executeCardDetailWithPolicy({
          cardUnitId,
          cardUnit,
          mgr,
          fetchDetail: async () => {
            if (snapshot?.detail?.fetched) {
              log(`[Snapshot] Reusing cached detail (${snapshot.detail.rawText?.length || 0} chars) for ${feedCard.cardHash}`);
          detail = snapshot.detail;
          acquisitionRoute = snapshot.acquisitionRoute || "DETAIL_PAGE_BROWSER";
          enrichmentStatus = snapshot.enrichmentStatus || "NOT_APPLICABLE";
          fallbackRoute = snapshot.fallbackRoute;
        } else {
          if (unit.portal === "Naukri") {
            let usedNaukriRichDiscovery = false;
            let usedNaukriAts = false;

            // Naukri Multi-Tier Acquisition Architecture:
            // Tier 1: Direct Rich Ingestion (ONLY when explicitly carrying authoritative full-description provenance)
            if (feedCard.hasAuthoritativeFullDescription === true && feedCard.rawText && feedCard.rawText.length >= 200 && feedCard.rawHtml) {
              usedNaukriRichDiscovery = true;
              log(`[Naukri] Using authoritative discovery payload (${feedCard.rawText.length} chars) for ${feedCard.title} @ ${feedCard.company}`);
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
            if (!usedNaukriRichDiscovery && feedCard.applyRedirectUrl) {
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

              if (atsRes.fetched && atsRes.outcome === "SUCCESS" && atsRes.rawText && atsRes.rawText.length >= 200) {
                log(`[Naukri] ATS enrichment successful (${atsRes.rawText.length} chars, quality=${atsRes.qualityTier || 'VALID'}, method=${atsRes.extractionMethod}) for ${feedCard.title} @ ${feedCard.company}`);
                usedNaukriAts = true;
                acquisitionRoute = "ATS_ENRICHED";
                enrichmentStatus = "ENRICHED_SUCCESS";
                detail = {
                  fetched: true,
                  rawHtml: atsRes.rawHtml,
                  rawText: atsRes.rawText,
                  fetchDurationMs: atsRes.fetchDurationMs,
                  httpStatus: atsRes.httpStatus || 200,
                  finalUrl: feedCard.applyRedirectUrl,
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
                log(`[Naukri] ATS enrichment rejected/failed (${atsRes.fetchError || atsRes.outcome}); preserving attempt and evaluating native detail fallback`);
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

                detail = {
                  fetched: false,
                  fetchError: `ATS enrichment failed: ${atsRes.fetchError || atsRes.outcome}`,
                  rawHtml: feedCard.rawHtml || "",
                  rawText: feedCard.rawText || "",
                  fetchDurationMs: 0,
                  httpStatus: atsRes.httpStatus || 200,
                  failureClass: atsRes.failureClass,
                };
              }
            } 
            // Tier 3: Native Detail Acquisition (invoked when rich discovery was not used and ATS did not yield a usable JD)
            if (!usedNaukriRichDiscovery && !usedNaukriAts && !portalPauseTriggered && outcome.pausePortalQueue !== true) {
              enrichmentStatus = enrichmentStatus === "ENRICHED_FAILED" ? "ENRICHED_FAILED" : "NOT_APPLICABLE";
              const pmDetail = pageManager;
              const runHealth = HealthManager.forRun(mgr.runId);
              const detailCtx: import("./scraper/types").PortalContext = {
                runId: mgr.runId,
                portal: unit.portal,
                keyword: unit.keyword,
                page: unit.page,
                searchUrl,
                browserContext,
                searchPage: pmDetail?.getPage("search") || activePage,
                detailPage: pmDetail?.getPage("detail"),
                searchMutex: pmDetail?.getMutex("search"),
                detailMutex: pmDetail?.getMutex("detail"),
                pageManager: pmDetail,
                logger: log,
                isHttpDisabled: (url: string) => !runHealth.isFastPathAvailable(unit.portal) || mgr.failedHttpUrls.has(url),
                recordHttpFailure: (url: string, reason: string) => runHealth.recordFastPathFailure(unit.portal, reason),
                recordHttpSuccess: (url: string) => runHealth.recordFastPathSuccess(unit.portal),
                recordTelemetry: (event: any) => mgr.recordTelemetry(event),
              };

              log(`[Naukri] ${feedCard.applyRedirectUrl ? "ATS enrichment failed" : "Discovery payload lacks authoritative provenance"} (${feedCard.rawText?.length || 0} chars, authoritative=${Boolean(feedCard.hasAuthoritativeFullDescription)}); invoking portal fetchDetail for ${feedCard.detailUrl}`);
              mgr.journal.append({ type: "detail_extraction_started", cardId: cardUnitId, url: feedCard.detailUrl });
              const portalDetail = await handler.fetchDetail(detailCtx, feedCard.detailUrl).catch((err: any) => ({
                fetched: false,
                fetchError: err.message,
                fetchDurationMs: 0,
                httpStatus: undefined,
                rawHtml: "",
                rawText: ""
              }));
              mgr.journal.append({ type: "detail_extraction_finished", cardId: cardUnitId, durationMs: portalDetail.fetchDurationMs });

              if (portalDetail.fetched && portalDetail.rawText && portalDetail.rawText.length >= 200) {
                log(`[Naukri] Detail fetch successful (${portalDetail.rawText.length} chars) for ${feedCard.title} @ ${feedCard.company}`);
                acquisitionRoute = "DETAIL_PAGE_BROWSER";
                detail = portalDetail;
                acquisitionAttempts.push({
                  method: "PORTAL_DETAIL",
                  url: feedCard.detailUrl,
                  timestamp: new Date().toISOString(),
                  httpStatus: portalDetail.httpStatus || 200,
                  outcome: "SUCCESS",
                  qualityTier: portalDetail.rawText.length >= 500 ? "VALID" : "SPARSE",
                  extractionMethod: "TARGETED_DOM",
                  details: `Extracted ${portalDetail.rawText.length} chars via Naukri detail fetch`
                });
              } else {
                log(`[Naukri] Detail fetch failed for ${feedCard.title} @ ${feedCard.company}; non-authoritative discovery snippet will NOT be admitted as canonical JD`);
                detail = {
                  fetched: false,
                  fetchError: portalDetail.fetchError || `Insufficient detail description length (${portalDetail.rawText?.length || 0} < 200 chars)`,
                  rawHtml: portalDetail.rawHtml || feedCard.rawHtml || "",
                  rawText: portalDetail.rawText || feedCard.rawText || "",
                  fetchDurationMs: portalDetail.fetchDurationMs || 0,
                  httpStatus: portalDetail.httpStatus || 200,
                  failureClass: (portalDetail as any).failureClass || "EXTRACTION_FAILURE",
                };
                acquisitionAttempts.push({
                  method: "PORTAL_DETAIL",
                  url: feedCard.detailUrl,
                  timestamp: new Date().toISOString(),
                  httpStatus: portalDetail.httpStatus || 200,
                  outcome: "EXTRACTION_FAILURE",
                  qualityTier: "NON_JOB",
                  details: `Detail fetch failed: ${detail.fetchError}`
                });
              }
            }
          } else {
          let usedRichDiscovery = false;
          // Invariant (Gate 2): LinkedIn discovery cards are never authoritative full JDs,
          // regardless of length or provisional completeness. They MUST always invoke fetchDetail().
          // Discovery payloads may only bypass fetchDetail() if the portal explicitly provides
          // authoritative full JD provenance (e.g. from an API source with structured full description).
          if (
            unit.portal !== "LinkedIn" &&
            feedCard.hasAuthoritativeFullDescription === true &&
            feedCard.rawText && feedCard.rawText.length >= 400 &&
            feedCard.rawHtml && feedCard.rawHtml.length >= 400
          ) {
            // Check if discovery payload genuinely satisfies standalone response validation
            const provisionalValidation = ResponseValidator.validate({
              html: feedCard.rawText,
              url: feedCard.applyRedirectUrl || feedCard.detailUrl,
              sourcePortal: unit.portal,
              httpStatus: 200,
              extractedTitle: feedCard.title,
              extractedCompany: feedCard.company,
              extractedDescription: feedCard.rawText,
            });

            if (provisionalValidation.isValid && provisionalValidation.quality === "COMPLETE") {
              usedRichDiscovery = true;
              log(`[${unit.portal}] Using verified authoritative rich discovery payload (${feedCard.rawText.length} chars) for ${feedCard.title} @ ${feedCard.company}`);
              detail = {
                fetched: true,
                rawHtml: feedCard.rawHtml,
                rawText: feedCard.rawText,
                fetchDurationMs: 0,
                httpStatus: 200,
              };
              // Rich discovery evidence may avoid a second JD extraction, but
              // it may never bypass Indeed's stable-listing identity boundary.
              if (unit.portal === "Indeed") {
                const pmDetail = pageManager;
                const runHealth = HealthManager.forRun(mgr.runId);
                const identity = await handler.resolveListingIdentity?.({
                  runId: mgr.runId, portal: unit.portal, keyword: unit.keyword, page: unit.page,
                  searchUrl, browserContext,
                  searchPage: pmDetail?.getPage("search") || activePage,
                  detailPage: pmDetail?.getPage("detail"),
                  searchMutex: pmDetail?.getMutex("search"),
                  detailMutex: pmDetail?.getMutex("detail"),
                  pageManager: pmDetail,
                  logger: log,
                  isHttpDisabled: (url: string) => !runHealth.isFastPathAvailable(unit.portal) || mgr.failedHttpUrls.has(url),
                  recordHttpFailure: (url: string, reason: string) => runHealth.recordFastPathFailure(unit.portal, reason),
                  recordTelemetry: (event: any) => mgr.recordTelemetry(event),
                }, feedCard.detailUrl);
                if (!identity || identity.identityResolutionFailure || !identity.finalUrl) {
                  detail = {
                    fetched: false,
                    fetchError: `Indeed identity resolution failed: ${identity?.identityResolutionFailure || "IDENTITY_UNRESOLVED"}`,
                    fetchDurationMs: 0,
                    httpStatus: 200,
                    finalUrl: identity?.finalUrl,
                    identityResolutionFailure: identity?.identityResolutionFailure || "IDENTITY_UNRESOLVED",
                  };
                } else {
                  detail.finalUrl = identity.finalUrl;
                }
              }
              acquisitionAttempts.push({
                method: "DISCOVERY_RICH",
                url: feedCard.detailUrl,
                timestamp: new Date().toISOString(),
                httpStatus: 200,
                outcome: "SUCCESS",
                qualityTier: "VALID",
                extractionMethod: "FALLBACK_CARD",
                details: `Verified rich discovery payload (${feedCard.rawText.length} chars)`
              });
            }
          }

          let usedIndeedAts = false;
          if (!usedRichDiscovery && unit.portal === "Indeed" && feedCard.applyRedirectUrl && !feedCard.applyRedirectUrl.includes("indeed.com")) {
            log(`[Indeed] Attempting ATS enrichment via ${feedCard.applyRedirectUrl}`);
            const atsRes: import("./scraper/utils/http-fetch").HttpFetchResult = await fastFetchDetail(
              feedCard.applyRedirectUrl,
              undefined,
              undefined,
              { "Referer": "https://in.indeed.com/" },
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

            if (atsRes.fetched && atsRes.outcome === "SUCCESS" && atsRes.rawText && atsRes.rawText.length >= 200) {
              log(`[Indeed] ATS enrichment successful (${atsRes.rawText.length} chars) for ${feedCard.title} @ ${feedCard.company}`);
              usedIndeedAts = true;
              acquisitionRoute = "ATS_ENRICHED";
              enrichmentStatus = "ENRICHED_SUCCESS";
              detail = {
                fetched: true,
                rawHtml: atsRes.rawHtml,
                rawText: atsRes.rawText,
                fetchDurationMs: atsRes.fetchDurationMs,
                httpStatus: atsRes.httpStatus || 200,
                finalUrl: feedCard.applyRedirectUrl,
              };
              acquisitionAttempts.push({
                method: "ATS_HTTP",
                url: feedCard.applyRedirectUrl,
                timestamp: new Date().toISOString(),
                httpStatus: atsRes.httpStatus || 200,
                outcome: "SUCCESS",
                qualityTier: atsRes.qualityTier || "VALID",
                extractionMethod: atsRes.extractionMethod,
                details: `Extracted ${atsRes.rawText.length} chars via Indeed ATS ${atsRes.extractionMethod}`
              });
            } else {
              log(`[Indeed] ATS enrichment rejected/failed; falling back to portal fetchDetail`);
              acquisitionAttempts.push({
                method: "ATS_HTTP",
                url: feedCard.applyRedirectUrl,
                timestamp: new Date().toISOString(),
                httpStatus: atsRes.httpStatus,
                outcome: atsRes.outcome || "EXTRACTION_FAILURE",
                qualityTier: "NON_JOB",
                extractionMethod: atsRes.extractionMethod,
                details: atsRes.fetchError || "Failed Indeed ATS extraction"
              });
            }
          }

          if (!usedRichDiscovery && !usedIndeedAts) {
            mgr.journal.append({ type: "detail_extraction_started", cardId: cardUnitId });
            const pmDetail = pageManager;
            const runHealth = HealthManager.forRun(mgr.runId);
            detail = await handler.fetchDetail({
              runId: mgr.runId, portal: unit.portal, keyword: unit.keyword, page: unit.page,
              searchUrl, browserContext,
              searchPage: pmDetail?.getPage("search") || activePage,
              detailPage: pmDetail?.getPage("detail"),
              searchMutex: pmDetail?.getMutex("search"),
              detailMutex: pmDetail?.getMutex("detail"),
              pageManager: pmDetail,
              logger: log,
              isHttpDisabled: (url: string) => !runHealth.isFastPathAvailable(unit.portal) || mgr.failedHttpUrls.has(url),
              recordHttpFailure: (url: string, reason: string) => runHealth.recordFastPathFailure(unit.portal, reason),
              recordHttpSuccess: (url: string) => runHealth.recordFastPathSuccess(unit.portal),
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
        }
        return detail;
      },
          validateDetail: (d) => ResponseValidator.validate({
            html: d.rawText || "",
            url: feedCard.applyRedirectUrl || feedCard.detailUrl,
            sourcePortal: unit.portal,
            httpStatus: d.httpStatus,
            extractedTitle: feedCard.title,
            documentTitle: d.extractedTitle,
            extractedCompany: feedCard.company,
            extractedDescription: d.rawText,
            contentOrigin: d.fetched ? "DETAIL_DOCUMENT" : "DISCOVERY_CARD_FALLBACK",
          }),
          isPortalPaused: () => portalPauseTriggered || outcome.pausePortalQueue === true,
          triggerPortalPause: () => {
            portalPauseTriggered = true;
            outcome.pausePortalQueue = true;
          },
        });

        if (!detailResult.ok) {
          const failureClass = detailResult.failureClass || "UNKNOWN_FAILURE";
          primaryFailureClass = primaryFailureClass || failureClass;
          sourceFailuresInUnit++;

          // Isolate external ATS failure from Naukri portal health/circuit-breaker
          if (
            unit.portal !== "Naukri"
            && !detail.identityResolutionFailure
          ) {
            const runHealth = HealthManager.forRun(mgr.runId);
            runHealth.recordFailure(unit.portal, failureClass);
          }

          const valResult = ResponseValidator.validate({
            html: detail.rawText || "",
            url: feedCard.applyRedirectUrl || feedCard.detailUrl,
            sourcePortal: unit.portal,
            httpStatus: detail.httpStatus,
            extractedTitle: feedCard.title,
            documentTitle: detail.extractedTitle,
            extractedCompany: feedCard.company,
            extractedDescription: detail.rawText,
            contentOrigin: detail.fetched ? "DETAIL_DOCUMENT" : "DISCOVERY_CARD_FALLBACK",
          });

          const rawFailureClass = detail.failureClass || detail.identityResolutionFailure || valResult.failureClass;

          if (repos) {
            await withPersistenceBoundary("validation failure state recording", async () => {
              await repos.acquisition.updateJobState(ledgerItem.id, {
                state: detail.identityResolutionFailure ? "IDENTITY_UNRESOLVED" : "ACQUIRING",
                attemptCount: cardUnit.attempts,
                terminalState: failureClass === "REMOVED_404"
                  ? "PERMANENT_FAILURE"
                  : rawFailureClass === "REDIRECT_HOP_LIMIT"
                    ? "REDIRECT_HOP_LIMIT"
                    : rawFailureClass === "UNSAFE_REDIRECT_DESTINATION"
                      ? "UNSAFE_REDIRECT_DESTINATION"
                      : detail.identityResolutionFailure
                        ? "UNRESOLVED_EXTERNAL_LISTING_IDENTITY"
                        : undefined,
                lastFailureClass: failureClass,
                acquisitionQuality: valResult.quality,
                validationConfidence: valResult.confidence
              });
            });
          }

          // Failed acquisition remains in the ledger and lineage as evidence,
          // but may never create a canonical market record.  A title/card or
          // an error page is not a recoverable substitute for a validated JD.
          if (lineageScope) {
            try {
              await recordLineage(
                ledgerItem.id,
                identity.sourceJobId,
                feedCard.discoveryUrl || feedCard.detailUrl,
                valResult,
                undefined,
                failureClass,
                detail.finalUrl,
              );
            } catch (lineageErr: any) {
              log(`[M10_LINEAGE_WARN] Failed to record validation failure lineage: ${lineageErr.message}`, "warn");
            }
          }

          return null;
        }

        detail = detailResult.detail;
        usableDetailAcquired++;
        const runHealth = HealthManager.forRun(mgr.runId);
        runHealth.recordBrowserSuccess(unit.portal);

        const valResult = ResponseValidator.validate({
          html: detail.rawText || "",
          url: feedCard.applyRedirectUrl || feedCard.detailUrl,
          sourcePortal: unit.portal,
          httpStatus: detail.httpStatus,
          extractedTitle: feedCard.title,
          documentTitle: detail.extractedTitle,
          extractedCompany: feedCard.company,
          extractedDescription: detail.rawText,
          contentOrigin: detail.fetched ? "DETAIL_DOCUMENT" : "DISCOVERY_CARD_FALLBACK",
        });

          // Post-Detail Company Resolution & Lineage Enforcement
          const rawCompany = (detail.extractedCompany || feedCard.company || "").trim();
          const cleanCompany = sanitizeCompanyName(
            rawCompany,
            feedCard.title || "",
            detail.rawText || "",
            feedCard.detailUrl
          );
          const sanitizedCompany = cleanCompany || rawCompany;
          const isConfidentialOrMissing = !sanitizedCompany || /^(confidential|unknown|undisclosed|stealth|private)\b/i.test(sanitizedCompany);

          let effectiveCompany: string;
          let companyId: string;

          if (isConfidentialOrMissing) {
            effectiveCompany = sanitizedCompany || "Confidential Employer";
            // Scoped surrogate company ID per opportunity to maintain entity lineage isolation
            companyId = `confidential:${unit.portal.toLowerCase()}:${feedCard.cardHash || ledgerItem.sourceJobId || ledgerItem.id}`;
          } else {
            effectiveCompany = sanitizedCompany;
            companyId = effectiveCompany.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
          }

          if (!feedCard.title) {
            mgr.updateCard(cardUnitId, { status: "failed", error: "Missing job title after detail extraction" });
            return null;
          }

          feedCard.company = effectiveCompany;

          // Re-derive canonical identity with resolved company
          // Listing identity URL remains the verified feedCard.detailUrl
          const identityUrl = feedCard.detailUrl;
          const verifiedIndeedIdentity = unit.portal === "Indeed" ? parseVerifiedIndeedListingUrl(identityUrl) : undefined;
          if (unit.portal === "Indeed" && !verifiedIndeedIdentity) {
            if (repos) {
              await withPersistenceBoundary("unresolved identity state recording", async () => {
                await repos.acquisition.updateJobState(ledgerItem.id, {
                  state: "IDENTITY_UNRESOLVED",
                  terminalState: "UNRESOLVED_EXTERNAL_LISTING_IDENTITY",
                  lastFailureClass: "IDENTITY_UNRESOLVED",
                });
              });
            }
            if (lineageScope) {
              try {
                await recordLineage(
                  ledgerItem.id,
                  identity.sourceJobId,
                  feedCard.discoveryUrl || feedCard.detailUrl,
                  valResult,
                  undefined,
                  "IDENTITY_UNRESOLVED",
                  detail.finalUrl,
                );
              } catch (lineageErr: any) {
                log(`[M10_LINEAGE_WARN] Failed to record unresolved identity lineage: ${lineageErr.message}`, "warn");
              }
            }
            mgr.updateCard(cardUnitId, { status: "failed", error: "Indeed listing identity could not be verified" });
            return null;
          }

          const resolvedIdentity = resolveCanonicalIdentity({
            portal: unit.portal,
            url: identityUrl,
            title: feedCard.title,
            companyName: effectiveCompany,
            rawJobId: feedCard.sourceJobId,
          });

          // Authoritative Post-Detail Duplicate Resolution Boundary
          // 1. Reconcile canonical JobId ownership
          if (resolvedIdentity.canonicalJobId !== identity.canonicalJobId) {
            seenCanonicalIds.delete(identity.canonicalJobId);
            if (seenCanonicalIds.has(resolvedIdentity.canonicalJobId)) {
              mgr.recordTelemetry("duplicatePostDetail");
              mgr.updateCard(cardUnitId, { status: "skipped_empty", error: "Duplicate Canonical ID (Post-Detail)" });
              outcome.duplicates++;
              return null;
            }
            seenCanonicalIds.add(resolvedIdentity.canonicalJobId);
          }

          // 2. Reconcile canonical URL ownership
          if (resolvedIdentity.canonicalUrl !== identity.canonicalUrl) {
            seenUrls.delete(identity.canonicalUrl);
            if (seenUrls.has(resolvedIdentity.canonicalUrl)) {
              mgr.recordTelemetry("duplicatePostDetail");
              mgr.updateCard(cardUnitId, { status: "skipped_empty", error: "Duplicate Canonical URL (Post-Detail)" });
              outcome.duplicates++;
              return null;
            }
            seenUrls.add(resolvedIdentity.canonicalUrl);
          }

          // 3. Reconcile external ATS redirect URL if present
          const cleanAtsUrl = feedCard.applyRedirectUrl
            ? normalizeUrl(feedCard.applyRedirectUrl)
            : null;

          if (cleanAtsUrl) {
            if (seenAtsUrls.has(cleanAtsUrl)) {
              mgr.recordTelemetry("duplicateAtsUrlObserved");
              // Telemetry only. Do not change card state,
              // do not increment outcome.duplicates,
              // and do not return.
            } else {
              seenAtsUrls.add(cleanAtsUrl);
            }
          }

          // 4. Heuristic duplicate check (Strictly telemetry only - never suppresses admission!)
          const heuristicKey = [feedCard.title, effectiveCompany, feedCard.location]
            .map((s) => (s || "").toLowerCase().trim()).join("|");
          if (seenHeuristicKeys.has(heuristicKey)) {
            mgr.recordTelemetry("heuristicDuplicateSuspect");
          } else {
            seenHeuristicKeys.add(heuristicKey);
          }

          // A sponsored observation can have entered the ledger under a
          // provisional URL identity. Canonical admission is rebased only
          // after a stable portal identity has been verified. The original
          // ledger row remains the lineage anchor for this observation.
          let resolvedLedgerItem: any = null;
          let admissionLedgerItem: any = ledgerItem;
          if (repos) {
            const res = await withPersistenceBoundary("job identity rebind", async () => {
              const resolved = await repos.acquisition.getLedgerItemByCanonicalId(
                resolvedIdentity.sourcePortal,
                resolvedIdentity.canonicalJobId,
              );
              const admission = await repos.acquisition.rebindDiscoveredJobIdentity(ledgerItem.id, {
                canonicalJobId: resolvedIdentity.canonicalJobId,
                sourcePortal: resolvedIdentity.sourcePortal,
                sourceJobId: resolvedIdentity.sourceJobId,
                canonicalUrl: resolvedIdentity.canonicalUrl,
              });
              return { resolvedLedgerItem: resolved, admissionLedgerItem: admission };
            });
            resolvedLedgerItem = res.resolvedLedgerItem;
            admissionLedgerItem = res.admissionLedgerItem;
          }
          if (resolvedLedgerItem) historicalLedgerCardIds.add(cardUnitId);

          detailedCard = {
            ...feedCard,
            canonicalJobId: resolvedIdentity.canonicalJobId,
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
          
          const writtenSnapshotPath = writeSnapshot(detailedCard);
          if (writtenSnapshotPath) {
            mgr.journal.append({ type: "snapshot_written", cardId: cardUnitId, path: writtenSnapshotPath });
          }

          // 5. Record Validated State in Ledger & Merge Opportunity in SQLite
          if (repos) {
            await withPersistenceBoundary("opportunity & company registration", async () => {
              await repos.acquisition.updateJobState(admissionLedgerItem.id, {
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
            });
          }

          // [M10.1] Canonical Acquisition Interceptor: Global Identity, Versioning, Attention Gate & Queue
          const canonicalPersistenceEnabled = runSession?.capabilities
            ? runSession.capabilities.canonicalPersistenceEnabled
            : isDbAvailable;
          if (!canonicalPersistenceEnabled) {
            log(`[LocalOnly] Skipping CanonicalIngestionService for card ${feedCard.cardHash} (canonicalPersistenceEnabled=false)`, "info");
          } else {
            try {
              const canonicalIngest = new CanonicalIngestionService();
              const ingestRes = await canonicalIngest.ingestOpportunity({
                sourcePortal: unit.portal,
                sourceJobId: resolvedIdentity.sourceJobId,
                canonicalUrl: resolvedIdentity.canonicalUrl,
                finalUrl: detail.finalUrl || (unit.portal === "Indeed" ? identityUrl : undefined),
                jobTitle: feedCard.title,
                documentTitle: detail.extractedTitle,
                companyName: feedCard.company,
                location: feedCard.location || "",
                employmentType: (detail as any)?.employmentType || null,
                rawContent: detail.rawText || "",
                contentOrigin: detail.fetched ? "DETAIL_DOCUMENT" : "DISCOVERY_CARD_FALLBACK",
                httpStatus: detail.httpStatus,
                postedAt: feedCard.postedAt,
                postedPrecision: (feedCard as any)?.postedPrecision || null,
                enrichmentDispatch: {
                  detailedCard,
                  pipelineVersion: EXTRACTOR_VERSION,
                  runId: mgr.runId,
                  executionPlanId: unit.id,
                  definitionId: unit.definitionId || "unknown",
                  familyId: "unknown",
                  portal: unit.portal,
                  page: unit.page,
                  catalogVersion: CATALOG_VERSION,
                  plannerVersion: PLANNER_VERSION,
                  ruleVersion: RULE_VERSION,
                  searchQuery: unit.keyword,
                  businessPriority: 10,
                  executionPriority: 0,
                  snapshotPath,
                },
              }, lineageScope ? {
                mode: "SCOPED" as const,
                tenantId: lineageScope.tenantId,
                personId: lineageScope.personId,
                searchPlanId: lineageScope.searchPlanId ?? null,
                runId: mgr.runId,
              } : {
                mode: "GLOBAL_MARKET" as const,
              });
              canonicalIngestionResult = ingestRes;
              detailedCard = bindEvaluationEvidence(detailedCard, {
                canonicalJobId: ingestRes.canonicalJobId,
                opportunityVersion: ingestRes.opportunityVersion,
                contentHash: ingestRes.contentHash,
                sourcePayloadKey: ingestRes.sourcePayloadKey,
                sourceMediaType: ingestRes.sourceMediaType,
              });
              const boundSnapshotPath = writeSnapshot(detailedCard);
              if (boundSnapshotPath) {
                mgr.journal.append({
                  type: "snapshot_evidence_bound",
                  cardId: cardUnitId,
                  canonicalJobId: ingestRes.canonicalJobId,
                  opportunityVersion: ingestRes.opportunityVersion,
                  contentHash: ingestRes.contentHash,
                });
              }
              mgr.recordTelemetry("canonicalIngestSuccess");
              if (ingestRes.isNewOpportunity) {
                pageCanonicalIngested++;
                mgr.recordTelemetry("canonicalOpportunitiesIngested");
              } else {
                mgr.recordTelemetry("canonicalOpportunitiesReused");
              }
              const admissionOutcome = ingestRes.isNewOpportunity ? "NEW_OPPORTUNITY" : "REUSED_OPPORTUNITY";
              log(`[IngestAdmission] unit=${unit.id} portal=${unit.portal} sourceJobId=${resolvedIdentity.sourceJobId} canonicalJobId=${ingestRes.canonicalJobId} outcome=${admissionOutcome} version=${ingestRes.isNewVersion ? "NEW_VERSION" : "REUSED_VERSION"}`, "info");
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
              await withPersistenceBoundary("canonical lineage recording", async () => {
                await recordLineage(
                  ledgerItem.id,
                  resolvedIdentity.sourceJobId,
                  feedCard.discoveryUrl || feedCard.detailUrl,
                  valResult,
                  ingestRes,
                  undefined,
                  detail.finalUrl,
                );
              });
            } catch (err: any) {
              log(`[M10_CANONICAL_INGEST_WARN] Canonical acquisition error for ${feedCard.cardHash}: ${err.message}`, "warn");
              mgr.recordTelemetry("canonicalIngestFailure");
              if (lineageScope) {
                try {
                  await recordLineage(
                    ledgerItem.id,
                    resolvedIdentity.sourceJobId,
                    feedCard.discoveryUrl || feedCard.detailUrl,
                    valResult,
                    undefined,
                    err?.name || "CANONICAL_INGEST_FAILURE",
                    detail.finalUrl,
                  );
                } catch (lineageErr: any) {
                  log(`[M10_LINEAGE_WARN] Failed to record error lineage for ${feedCard.cardHash}: ${lineageErr.message}`, "warn");
                }
              }
              if (err instanceof AcquisitionIntegrityError) {
                throw err;
              }
              throw new AcquisitionIntegrityError(
                `Canonical acquisition failed for ${resolvedIdentity.canonicalJobId}: ${err?.message}`,
                err
              );
            }
          }

        mgr.updateCard(cardUnitId, {
          snapshotPath,
          isNew: canonicalIngestionResult
            ? canonicalIngestionResult.isNewOpportunity
            : isHistoricallyNew,
          status: "done",
        });
      } catch (err: any) {
        log(`card ${cardUnitId} failed: ${err.message}`, "error");

        const isIntegrityFailure =
          err?.failureKind === "INTEGRITY_FAILURE" ||
          err instanceof AcquisitionIntegrityError ||
          err?.name === "AcquisitionIntegrityError" ||
          err?.message?.includes("ENRICHMENT_PAYLOAD_IDENTITY_MISMATCH") ||
          err?.message?.includes("ENRICHMENT_PAYLOAD_NOT_FOUND");

        mgr.updateCard(cardUnitId, {
          status: "failed",
          error: err.message,
          failureKind: isIntegrityFailure ? "INTEGRITY_FAILURE" : "SOURCE_FAILURE",
        });
        mgr.journal.append({ type: "card_failed", cardId: cardUnitId, error: err.message });

        if (isIntegrityFailure) {
          integrityFailuresInUnit++;
          mgr.recordTelemetry("acquisitionIntegrityFailures");
        } else {
          sourceFailuresInUnit++;
        }
      }
      return null;
    });

    let canonicalDuplicates = 0;
    let ledgerKnown = 0;
    let hardFiltered = 0;
    const hardFilterBreakdown: Record<string, number> = {
      TITLE_INTENT_MISMATCH: 0,
      LOCATION_EXCLUSION: 0,
      EXPERIENCE_EXCLUSION: 0,
      SENIORITY_EXCLUSION: 0,
      OTHER: 0,
    };
    let identityFailed = 0;
    let validationFailed = 0;
    let canonicalIngestFailed = 0;
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
          const match = errStr.match(/\[HardFilter:([A-Z_]+)\]/);
          const reasonCode = match ? match[1] : "OTHER";
          hardFilterBreakdown[reasonCode] = (hardFilterBreakdown[reasonCode] || 0) + 1;
        }
      } else if (cu.status === "failed") {
        const errStr = cu.error || "";
        if (errStr.includes("[CanonicalIngestFailed]")) {
          canonicalIngestFailed++;
        } else if (errStr.toLowerCase().includes("identity")) {
          identityFailed++;
        } else {
          validationFailed++;
        }
      } else if (cu.status === "skipped_pruned" || cu.status === "skipped_gated") {
        cancelledOrPruned++;
      } else if (cu.status === "done") {
        if (cu.isNew) {
          novelAccepted++;
          if (cu.snapshotPath && fs.existsSync(cu.snapshotPath)) {
            novelAcquired++;
          }
        } else if (historicalLedgerCardIds.has(cardUnitId)) {
          ledgerKnown++;
        } else {
          canonicalDuplicates++;
        }
      }
    }
    
    const cardsParsed = cards.length;
    const classified = canonicalDuplicates + ledgerKnown + hardFiltered + identityFailed + validationFailed + canonicalIngestFailed + novelAccepted + cancelledOrPruned;
    
    if (classified !== cardsParsed) {
      log(`[AccountingInvariantViolation] cardsParsed=${cardsParsed}, classified=${classified} (Duplicates=${canonicalDuplicates}, Ledger=${ledgerKnown}, HardFiltered=${hardFiltered}, IdentityFailed=${identityFailed}, ValidationFailed=${validationFailed}, CanonicalIngestFailed=${canonicalIngestFailed}, NovelAccepted=${novelAccepted}, CancelledPruned=${cancelledOrPruned})`, "warn");
    }
    if (novelAcquired > novelAccepted) {
      log(`[AccountingInvariantViolation] novelAcquired (${novelAcquired}) > novelAccepted (${novelAccepted})`, "warn");
    }

    const newJobs = novelAccepted;
    const duplicates = canonicalDuplicates;
    const rejected = ledgerKnown + hardFiltered + identityFailed + validationFailed + canonicalIngestFailed;
    const opportunities = novelAccepted;
    
    outcome.detailCount = novelAcquired;
    outcome.opportunities = opportunities;
    outcome.factsCreated = 0; // Enriched downstream

    outcome.newJobs = newJobs;
    outcome.duplicates = duplicates;

    let decision: "CONTINUE" | "STOP" = "CONTINUE";
    let reason = "DiscoveryRateAboveThreshold";
    
    if (unit.definitionId) {
      const minSourceDiscoveryPerPage = 2; // threshold for a source page exposing too few listings
      const maxConsecutiveLowYield = 2; // stop after this many consecutive low-yield pages
      
      // Gate 4: Source discovery yield measures unique valid portal identities exposed by this source work unit
      const uniqueSourceIdentities = new Set<string>();
      for (const card of cards) {
        const identity = sourceIdentityForCard(card);
        if (identity) {
          uniqueSourceIdentities.add(identity);
        }
      }
      const sourceDiscoveryYield = uniqueSourceIdentities.size;
      const currentLowYield = sourceDiscoveryYield < minSourceDiscoveryPerPage;
      // Each acquisition surface has its own yield curve. A freshness pass
      // must not inherit the coverage lane's low-yield streak.
      const yieldKey = acquisitionSurfaceKey(unit.variant, unit.portal, unit.keyword);
      let streak = mgr.lowYieldStreaks.get(yieldKey) || 0;
      
      if (currentLowYield) {
        streak += 1;
        mgr.lowYieldStreaks.set(yieldKey, streak);
      } else {
        mgr.lowYieldStreaks.set(yieldKey, 0); // reset streak
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
          reason = "ExhaustedConsecutiveLowYield";
          log(`Stopping ${unit.definitionId} after ${streak} consecutive low-yield pages`, "info");
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

    if (cardsParsed > 0 && novelAccepted === 0 && reason === "DiscoveryRateAboveThreshold") {
      reason = "NoveltyRateZero";
    }

    const runtimeMs = new Date().getTime() - new Date(mgr.manifest.units.find(u => u.id === unit.id)!.startedAt!).getTime();

    const manifestCards = mgr.manifest.cards.filter(
      (c) => c.parentUnitId === unit.id || c.id.startsWith(`${unit.id}#`)
    );

    const finalized = finalizeUnitOutcome({
      cardsCount: cards.length,
      manifestCards,
      portalPauseTriggered,
      pausePortalQueue: outcome.pausePortalQueue,
      initialStatus: outcome.status,
    });
    outcome.status = finalized.status;
    outcome.warnings.push(...finalized.warnings);

    const pageFailureReason = outcome.status === "failed"
      ? (primaryFailureClass || outcome.warnings[0] || "UnitExecutionFailed")
      : null;

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
        failureReason: pageFailureReason,
        timestamp: new Date().toISOString()
      });

      let unitAcqOutcome: AcquisitionOutcome = "SUCCESS";
      const unitWarning = outcome.warnings.join(" ");
      if (integrityFailuresInUnit > 0) {
        unitAcqOutcome = "INTEGRITY_ERROR";
      } else if (outcome.status === "aborted" || mgr.isCancellationRequested()) {
        unitAcqOutcome = "TRANSPORT_ERROR"; // Excluded from novelty degradation
      } else if (outcome.status === "failed") {
        if (primaryFailureClass === "RATE_LIMIT_429" || primaryFailureClass === "BOT_CHALLENGE_BLOCK" || primaryFailureClass === "CAPTCHA_CHALLENGE" || primaryFailureClass === "LOGIN_REQUIRED" || unitWarning.includes("406") || unitWarning.includes("429") || unitWarning.includes("Cloudflare") || unitWarning.includes("blocked") || unitWarning.includes("Anti-bot") || unitWarning.includes("Circuit breaker")) {
          unitAcqOutcome = "ANTI_BOT";
        } else if (primaryFailureClass === "HTTP_TIMEOUT" || primaryFailureClass === "NAVIGATION_TIMEOUT" || unitWarning.includes("timeout") || unitWarning.includes("ETIMEDOUT")) {
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
      extractionErrors: identityFailed + validationFailed + canonicalIngestFailed + sourceFailuresInUnit,
      qualified: null,
      recommended: null,
      newCompanies: null,
      decision,
      reason
    };

    mgr.updateUnit(unit.id, { decisionRecord });

    const hfBreakdownStr = hardFiltered > 0
      ? ` (Intent: ${hardFilterBreakdown.TITLE_INTENT_MISMATCH || 0}, Loc: ${hardFilterBreakdown.LOCATION_EXCLUSION || 0}, Exp: ${hardFilterBreakdown.EXPERIENCE_EXCLUSION || 0}, Seniority: ${hardFilterBreakdown.SENIORITY_EXCLUSION || 0}, Other: ${hardFilterBreakdown.OTHER || 0})`
      : "";

    log(`\n=== PAGE SUMMARY ===\nPortal: ${unit.portal}\nKeyword: ${unit.keyword}\nPage: ${unit.page}\n\nCards Seen ............ ${cards.length}\nCards Parsed .......... ${cardsParsed}\n  ├── Canonical Duplicates ... ${canonicalDuplicates}\n  ├── Ledger Known ........... ${ledgerKnown}\n  ├── Hard Filtered .......... ${hardFiltered}${hfBreakdownStr}\n  ├── Identity Failures ...... ${identityFailed}\n  ├── Validation Failures .... ${validationFailed}\n  └── Novel Accepted ......... ${novelAccepted} (Acquired: ${novelAcquired})\n      └── Canonical Ingested ... ${pageCanonicalIngested} (Total Run: ${mgr.getTelemetry("canonicalOpportunitiesIngested") || 0})\n\nNovelty Rate .......... ${((novelAccepted / Math.max(1, cardsParsed)) * 100).toFixed(1)}%\nDecision .............. ${decision}\nReason ................ ${reason}\n====================\n`, "info");
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
