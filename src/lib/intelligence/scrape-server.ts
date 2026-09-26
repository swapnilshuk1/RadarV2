import { createServerFn } from "@tanstack/react-start";
import path from "path";
import fs from "fs";
import { ARTIFACTS_DIR } from "../../../scripts/scraper/config";
import { requireAuthUser } from "../auth/guard";
import { getRepositories } from "../../data/sqlite/provider";
import { getDatabaseAdapter } from "../../data/database";

type CandidateScopeRequest = { tenantId?: string; personId?: string };
function requestedCandidateScope(data?: CandidateScopeRequest) {
  if (Boolean(data?.tenantId) !== Boolean(data?.personId)) throw new Error("CANDIDATE_SCOPE_INCOMPLETE");
  return data;
}

// Web handlers only create durable work. Worker processes own execution and
// notification; no server-global timers or in-memory run ownership are valid.

export interface CapturedEnrichmentRun {
  runId: string;
  runStatus: string;
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

/** Captures are shown separately from the shortlist until their enrichment produces an evaluation. */
export const getCapturedEnrichmentRunsFn = createServerFn({ method: "GET" })
  .validator((data?: CandidateScopeRequest) => data)
  .handler(async ({ data }): Promise<CapturedEnrichmentRun[]> => {
    const user = await requireAuthUser();
    const { resolveServingScope } = await import("../security/scope-resolver");
    const requested = requestedCandidateScope(data);
    const { scope } = await resolveServingScope(user.id, requested?.tenantId, undefined, requested?.personId);
    const db = getDatabaseAdapter();
    const rows = await db.many<any>(
      `SELECT r.id AS run_id, r.status AS run_status,
              COUNT(e.id) AS total,
              SUM(CASE WHEN e.status IN ('PENDING', 'RETRY') THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN e.status IN ('LEASED', 'RUNNING') THEN 1 ELSE 0 END) AS processing,
              SUM(CASE WHEN e.status = 'COMPLETE' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN e.status = 'FAILED' THEN 1 ELSE 0 END) AS failed
       FROM scrape_runs r
       JOIN scrape_run_enrichment_requirements req ON req.run_id = r.id
       JOIN enrichment_jobs e ON e.id = req.enrichment_job_id
       WHERE r.tenant_id = ? AND r.person_id = ?
       GROUP BY r.id, r.status
       HAVING SUM(CASE WHEN e.status IN ('PENDING', 'RETRY', 'LEASED', 'RUNNING', 'FAILED') THEN 1 ELSE 0 END) > 0
       ORDER BY r.created_at DESC`,
      [scope.tenantId, scope.personId],
    );
    return rows.map((row) => ({
      runId: row.run_id,
      runStatus: row.run_status,
      total: Number(row.total || 0),
      pending: Number(row.pending || 0),
      processing: Number(row.processing || 0),
      completed: Number(row.completed || 0),
      failed: Number(row.failed || 0),
    }));
  });

/** Queues scoped enrichment; an explicit worker process performs the work. */
export const startCapturedEnrichmentFn = createServerFn({ method: "POST" })
  .validator((data: { runId: string } & CandidateScopeRequest) => data)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const { resolveServingScope } = await import("../security/scope-resolver");
    const requested = requestedCandidateScope(data);
    const { scope } = await resolveServingScope(user.id, requested?.tenantId, undefined, requested?.personId, "write:person");
    const run = await getRepositories().scrapeRuns.getRun(scope, data.runId);
    if (!run) {
      const { TenantIsolationError } = await import("../security/auth");
      throw new TenantIsolationError(`Scrape run '${data.runId}' not found or unauthorized for current tenant/person.`);
    }

    const { EnrichmentQueue } = await import("../../../scripts/scraper/persist/queue");
    const queue = new EnrichmentQueue();
    let stats = await queue.getRunStats(data.runId);
    // A deliberate retry from the shortlist is scoped to this authorized run.
    // It is the recovery path for a repaired worker or transient fatal state;
    // no unrelated queue item is reset.
    if (stats.pending === 0 && stats.processing === 0 && stats.failed > 0) {
      await queue.retryFailedForRun(data.runId);
      stats = await queue.getRunStats(data.runId);
    }
    if (stats.pending === 0 && stats.processing === 0) {
      return { started: false, reason: "NO_PENDING_CAPTURED_JOBS" };
    }

    return { started: false, queued: true, pending: stats.pending, processing: stats.processing };
  });

/**
 * Read-only execution preview for the shortlist. It deliberately resolves and
 * compiles the same active plan as triggerScrapeFn so the interface cannot
 * display a reconstructed or stale interpretation of the next search.
 */
export const getScrapePlanPreviewFn = createServerFn({ method: "GET" })
  .validator((data?: CandidateScopeRequest) => data)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    try {
      const { resolveScraperAuthContext } = await import("../security/scope-resolver");
      const requested = requestedCandidateScope(data);
      const { scope, activeContext } = await resolveScraperAuthContext(user.id, requested?.tenantId, undefined, requested?.personId);
      const { ScraperPlanResolver } = await import("./ScraperPlanResolver");
      const resolvedPlan = await ScraperPlanResolver.resolveActivePlan(scope, activeContext);
      const { compileCoverageVariants } = await import("../../../scripts/scraper/run/acquisition-variants");
      const variants = compileCoverageVariants(resolvedPlan, ["LinkedIn", "Naukri", "Indeed"]);

      const firstVariant = variants[0];
      return {
        status: "ready" as const,
        searchPlanId: resolvedPlan.searchPlanId,
        snapshotId: resolvedPlan.snapshotId ?? null,
        title: resolvedPlan.title,
        keywords: resolvedPlan.queries,
        portals: ["LinkedIn", "Naukri", "Indeed"] as const,
        location: firstVariant?.location ?? null,
        postedWithinDays: firstVariant?.postedWithinDays ?? null,
        sort: firstVariant?.sort ?? null,
        executionSurfaceCount: variants.length,
      };
    } catch (error: unknown) {
      // A broken active plan must be observable from the interface, but it must
      // not make the shortlist unavailable. triggerScrapeFn remains fail-closed.
      return {
        status: "unavailable" as const,
        error: error instanceof Error ? error.message : "Unable to resolve the active search plan.",
      };
    }
  });

export const triggerScrapeFn = createServerFn({ method: "POST" })
  .validator((data?: CandidateScopeRequest) => data)
  .handler(async ({ data }) => {
    // 1. Enforce Authentication
    const user = await requireAuthUser();

    try {
      console.log("[Server] triggerScrapeFn: resolving verified scraper auth scope…");
      const { resolveScraperAuthContext } = await import("../security/scope-resolver");
      const requested = requestedCandidateScope(data);
      const { scope, activeContext } = await resolveScraperAuthContext(user.id, requested?.tenantId, undefined, requested?.personId, "write:person");
      const { ScraperPlanResolver } = await import("./ScraperPlanResolver");
      const resolvedPlan = await ScraperPlanResolver.resolveActivePlan(scope, activeContext);
      const repos = getRepositories();

      // Per-tenant/person concurrency check in Turso Cloud
      const existingActive = await repos.scrapeRuns.getActiveRun(scope);
      if (existingActive) {
        console.warn(`[Server] triggerScrapeFn rejected: Active run ${existingActive.id} already exists for tenant ${scope.tenantId}, person ${scope.personId}`);
        return {
          success: false,
          error: `A scraping run is already in progress (${existingActive.id}). Concurrent execution for your account is rejected.`,
          runId: existingActive.id,
          alreadyRunning: true
        };
      }

      const run = await repos.scrapeRuns.createRun(scope, {
        searchPlanId: activeContext?.searchPlanId ?? resolvedPlan.searchPlanId,
        portalTargets: ["LinkedIn", "Naukri", "Indeed"],
        initialStatus: "queued",
        config: { worker: "scrape", searchPlanId: resolvedPlan.searchPlanId, contextFingerprint: resolvedPlan.contextFingerprint },
      });
      return { success: true, runId: run.id, queued: true };
    } catch (error: any) {
      console.error("[Server] triggerScrapeFn failed:", error);
      return { success: false, error: error?.message ?? String(error) };
    }
  });

export const getRunEventsFn = createServerFn({ method: "GET" })
  .validator((d: { runId: string; afterIndex: number } & CandidateScopeRequest) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const { runId, afterIndex } = data;
    const { resolveServingScope } = await import("../security/scope-resolver");
    const requested = requestedCandidateScope(data);
    const { scope } = await resolveServingScope(user.id, requested?.tenantId, undefined, requested?.personId);
    const scopedRun = await getRepositories().scrapeRuns.getRun(scope, runId);
    if (!scopedRun) {
      const { TenantIsolationError } = await import("../security/auth");
      throw new TenantIsolationError(`Scrape run '${runId}' not found or unauthorized for current tenant/person.`);
    }
    const { Journal } = await import("../../../scripts/scraper/run/journal");
    
    const runDir = path.join(ARTIFACTS_DIR, "runs", runId);
    const journalPath = path.join(runDir, "journal.ndjson");
    const manifestPath = path.join(runDir, "manifest.json");
    
    const { events, nextIndex } = Journal.readIncremental(journalPath, afterIndex);
    
    let manifest: any = null;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch {}

    const summary = {
      portalsCompleted: 0,
      cardsFound: 0,
      extracted: 0
    };
    
    const allEvents = Journal.replay(journalPath);
    for (const e of allEvents) {
      if (e.type === "unit_done" || e.type === "unit_empty" || e.type === "unit_failed") summary.portalsCompleted++;
      if (e.type === "snapshot_written") summary.cardsFound++;
      if (e.type === "extraction_written") summary.extracted++;
    }

    // Load active enrichment stats from canonical Turso operational queue
    let enrichmentStats: any = null;
    let isEnriching = false;
    try {
      const { EnrichmentQueue } = await import("../../../scripts/scraper/persist/queue");
      const queue = new EnrichmentQueue();
      enrichmentStats = await queue.getRunStats(runId);
      if (enrichmentStats && enrichmentStats.total > 0 && (enrichmentStats.pending + enrichmentStats.processing > 0)) {
        isEnriching = true;
      }
    } catch (err: any) {
      console.error("[Server] Failed to load enrichment stats:", err.message);
    }

    const completed = (manifest?.status === "completed" || manifest?.status === "failed" || manifest?.status === "aborted") && !isEnriching;
    const status = isEnriching ? "enriching" : (manifest?.status || "running");

    return {
      runId,
      completed,
      status,
      portalHealth: manifest?.portalHealth || {},
      events: events as any[],
      nextIndex,
      summary,
      enrichmentStats
    };
  });

export function buildCanonicalRunData(runId: string, enrichmentCompleted?: number) {
  const runDir = path.join(ARTIFACTS_DIR, "runs", runId);
  const manifestPath = path.join(runDir, "manifest.json");

  if (!fs.existsSync(manifestPath)) return null;

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const opportunitiesFound = manifest.opportunitiesFound ?? manifest.cards?.length ?? 0;

    let evaluatedCount = manifest.evaluatedCount ?? 0;
    if (enrichmentCompleted !== undefined) {
      evaluatedCount = Math.max(evaluatedCount, enrichmentCompleted);
    }

    const remainingCount = Math.max(0, opportunitiesFound - evaluatedCount);

    const ACTIVE_STATES = ["queued", "initializing", "waiting_for_confirmation", "running", "enriching", "stopping", "completing"];
    const isActive = ACTIVE_STATES.includes(manifest.status);

    const sources = manifest.sources || {
      LinkedIn: "pending",
      Naukri: "pending",
      Indeed: "pending"
    };

    let stage = manifest.stage;
    if (!stage) {
      if (manifest.status === "completed") stage = "complete";
      else if (manifest.status === "stopped" || manifest.status === "aborted") stage = "stopped";
      else if (manifest.status === "failed") stage = "failed";
      else if (manifest.status === "enriching") stage = "evaluate";
      else stage = "discover";
    }

    return {
      runId,
      status: manifest.status,
      isActive,
      stage,
      opportunitiesFound,
      evaluatedCount,
      remainingCount,
      sources,
      startedAt: manifest.startedAt,
      updatedAt: manifest.updatedAt,
      finishedAt: manifest.finishedAt,
      portalHealth: manifest.portalHealth || {},
      recentActivities: manifest.recentActivities || []
    };
  } catch (err: any) {
    console.error(`[Server] Failed to read manifest for run ${runId}:`, err.message);
    return null;
  }
}

export function getActiveScrapeState() {
  try {
    const latestPath = path.join(ARTIFACTS_DIR, "runs", "latest.json");
    if (!fs.existsSync(latestPath)) return null;
    const latest = JSON.parse(fs.readFileSync(latestPath, "utf-8"));
    if (!latest?.runId) return null;

    const runData = buildCanonicalRunData(latest.runId);
    if (runData && runData.isActive) {
      return runData;
    }
    return null; // Active-only per Directive #2
  } catch {
    return null;
  }
}

export function getRunProgressState(runId: string) {
  return buildCanonicalRunData(runId);
}

export async function abortScrapeState(runId: string, force = false) {
  const manifestPath = path.join(ARTIFACTS_DIR, "runs", runId, "manifest.json");
  try {
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      manifest.status = force ? "aborted" : "stopping";
      manifest.updatedAt = new Date().toISOString();
      if (force) manifest.finishedAt = manifest.updatedAt;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
      console.log(`[Server] Abort requested for run ${runId}. Manifest status set to '${manifest.status}'.`);
    }
    // A web instance never owns a scraper process. The durable status above is
    // the stop command observed by the dedicated worker between work units.
    return { success: true, status: force ? "aborted" : "stopping" };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export const getActiveScrapeFn = createServerFn({ method: "GET" })
  .validator((data?: CandidateScopeRequest) => data)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const { resolveServingScope } = await import("../security/scope-resolver");
    const requested = requestedCandidateScope(data);
    const { scope } = await resolveServingScope(user.id, requested?.tenantId, undefined, requested?.personId);
    return getRepositories().scrapeRuns.getLatestRun(scope);
  });

export const getLatestRunFn = createServerFn({ method: "GET" })
  .validator((data?: CandidateScopeRequest) => data)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const { resolveServingScope } = await import("../security/scope-resolver");
    const requested = requestedCandidateScope(data);
    const { scope } = await resolveServingScope(user.id, requested?.tenantId, undefined, requested?.personId);
    const repos = getRepositories();

    // 1. Query Turso Cloud for the caller's scoped latest run
    const latestDbRun = await repos.scrapeRuns.getLatestRun(scope);
    if (!latestDbRun) return null;

    // 2. Hydrate canonical run data (fall back to disk manifest if available for local activity details)
    const diskData = buildCanonicalRunData(latestDbRun.id);
    if (diskData) {
      return {
        ...diskData,
        status: latestDbRun.status,
        opportunitiesFound: Math.max(diskData.opportunitiesFound || 0, latestDbRun.totalDiscovered),
      };
    }

    return {
      runId: latestDbRun.id,
      status: latestDbRun.status,
      isActive: ["queued", "initializing", "running", "waiting_for_confirmation"].includes(latestDbRun.status),
      stage: latestDbRun.status === "completed" ? "complete" : latestDbRun.status,
      opportunitiesFound: latestDbRun.totalDiscovered,
      evaluatedCount: latestDbRun.totalEnqueued,
      remainingCount: 0,
      sources: {},
      startedAt: latestDbRun.startedAt || latestDbRun.createdAt,
      updatedAt: latestDbRun.updatedAt,
      finishedAt: latestDbRun.finishedAt || undefined,
      portalHealth: {},
      recentActivities: [],
    };
  });

export const getRunProgressFn = createServerFn({ method: "GET" })
  .validator((d: { runId: string } & CandidateScopeRequest) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const { resolveServingScope } = await import("../security/scope-resolver");
    const requested = requestedCandidateScope(data);
    const { scope } = await resolveServingScope(user.id, requested?.tenantId, undefined, requested?.personId);
    const repos = getRepositories();

    const dbRun = await repos.scrapeRuns.getRun(scope, data.runId);
    if (!dbRun) {
      const { TenantIsolationError } = await import("../security/auth");
      throw new TenantIsolationError(`Scrape run '${data.runId}' not found or unauthorized for current tenant/person.`);
    }

    const diskData = getRunProgressState(data.runId);
    if (diskData) {
      return {
        ...diskData,
        status: dbRun.status,
      };
    }

    return {
      runId: dbRun.id,
      status: dbRun.status,
      isActive: ["queued", "initializing", "running", "waiting_for_confirmation"].includes(dbRun.status),
      stage: dbRun.status === "completed" ? "complete" : dbRun.status,
      opportunitiesFound: dbRun.totalDiscovered,
      evaluatedCount: dbRun.totalEnqueued,
      remainingCount: 0,
      sources: {},
      startedAt: dbRun.startedAt || dbRun.createdAt,
      updatedAt: dbRun.updatedAt,
      finishedAt: dbRun.finishedAt || undefined,
      portalHealth: {},
      recentActivities: [],
    };
  });

export const confirmScrapeFn = createServerFn({ method: "POST" })
  .validator((d: { runId: string } & CandidateScopeRequest) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const { resolveServingScope } = await import("../security/scope-resolver");
    const requested = requestedCandidateScope(data);
    const { scope } = await resolveServingScope(user.id, requested?.tenantId, undefined, requested?.personId, "write:person");
    const repos = getRepositories();

    const dbRun = await repos.scrapeRuns.getRun(scope, data.runId);
    if (!dbRun) {
      const { TenantIsolationError } = await import("../security/auth");
      throw new TenantIsolationError(`Cannot confirm run '${data.runId}': unauthorized or not found.`);
    }

    await repos.scrapeRuns.updateRunStatus(scope, data.runId, "running");

    const manifestPath = path.join(ARTIFACTS_DIR, "runs", data.runId, "manifest.json");
    try {
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        if (manifest.status === "waiting_for_confirmation") {
          manifest.status = "running";
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
        }
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

export const abortScrapeFn = createServerFn({ method: "POST" })
  .validator((d: { runId: string } & CandidateScopeRequest) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const { resolveServingScope } = await import("../security/scope-resolver");
    const requested = requestedCandidateScope(data);
    const { scope } = await resolveServingScope(user.id, requested?.tenantId, undefined, requested?.personId, "write:person");
    const repos = getRepositories();

    const dbRun = await repos.scrapeRuns.getRun(scope, data.runId);
    if (!dbRun) {
      const { TenantIsolationError } = await import("../security/auth");
      throw new TenantIsolationError(`Cannot abort run '${data.runId}': unauthorized or not found.`);
    }

    await repos.scrapeRuns.updateRunStatus(scope, data.runId, "stopping");
    const result = abortScrapeState(data.runId);
    return result;
  });

export const getLiveScrapedFn = createServerFn({ method: "GET" })
  .validator((data?: CandidateScopeRequest) => data)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const requested = requestedCandidateScope(data);
    await import("../security/scope-resolver").then(({ resolveServingScope }) => resolveServingScope(user.id, requested?.tenantId, undefined, requested?.personId));
    // Process-local scrape artifacts have no canonical person/tenant ownership.
    // They are deliberately no longer a production serving authority.
    return [];
  });

export interface CorpusJobState {
  status: "idle" | "running" | "completed" | "failed";
  stage: "IDLE" | "INGESTING" | "NORMALIZING" | "ENRICHING" | "PUBLISHING" | "COMPLETE" | "FAILED";
  logs: string[];
  processedCount: number;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

async function getCorpusJob(): Promise<CorpusJobState> {
  const row = await getDatabaseAdapter().one<any>("SELECT * FROM corpus_regeneration_jobs WHERE id='corpus-regeneration'");
  if (!row) return { status: "idle", stage: "IDLE", logs: [], processedCount: 0 };
  return { status: row.status === "processing" ? "running" : row.status, stage: row.stage, logs: JSON.parse(row.logs_json || "[]"), processedCount: row.processed_count, error: row.error || undefined, startedAt: row.started_at || undefined, completedAt: row.completed_at || undefined };
}

export const triggerCorpusRegenerationFn = createServerFn({ method: "POST" })
  .handler(async () => {
    await requireAuthUser({ requireAdmin: true });
    const db = getDatabaseAdapter();
    await db.execute(`INSERT INTO corpus_regeneration_jobs(id,status,stage,logs_json,processed_count)
      VALUES('corpus-regeneration','queued','INGESTING','[]',0)
      ON CONFLICT(id) DO UPDATE SET status='queued',stage='INGESTING',logs_json='[]',processed_count=0,error=NULL,locked_by=NULL,lease_token=NULL,started_at=NULL,completed_at=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE corpus_regeneration_jobs.status IN ('completed','failed')`);
    const job = await getCorpusJob();
    return { success: true, running: job.status === "running" || job.status === "idle", queued: job.status === "idle", message: job.status === "running" ? "Corpus regeneration already in progress." : "Corpus regeneration queued." };
  });

export const getCorpusRegenerationStatusFn = createServerFn({ method: "GET" })
  .handler(async () => {
    await requireAuthUser({ requireAdmin: true });
    return getCorpusJob();
  });

export const getCorpusHealthFn = createServerFn({ method: "GET" })
  .handler(async () => {
    await requireAuthUser({ requireAdmin: true });
    try {
      const { calculateCorpusHealth } = await import("../../../scripts/corpus/health");
      return calculateCorpusHealth();
    } catch (err: any) {
      console.error("[Server] getCorpusHealthFn failed:", err.message);
      return null;
    }
  });

export const getPipelineStatsFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await requireAuthUser();
    try {
      const { EnrichmentQueue } = await import("../../../scripts/scraper/persist/queue");
      const queue = new EnrichmentQueue();
      const stats = await queue.getGlobalPipelineStats();
      
      // Compute actual database evaluation metrics via canonical serving
      const { OpportunityService } = await import("./opportunity-service");
      const metrics = await OpportunityService.getMetricsForUser(user.id);

      return {
        ...stats,
        discovered: metrics.totalScreened,
        filtered: metrics.effectiveBreakdown.pass + metrics.effectiveBreakdown.none,
        shortlisted: metrics.effectiveBreakdown.pursue + metrics.effectiveBreakdown.consider,
        totalDecisions: metrics.totalDecisions,
      };
    } catch (err: any) {
      console.error("[Server] getPipelineStatsFn failed:", err.message);
      return null;
    }
  });
