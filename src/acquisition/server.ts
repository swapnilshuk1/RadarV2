import { createServerFn } from "@tanstack/react-start";
import { requireAuthUser } from "@/lib/auth/guard";
import { getRepositories } from "@/data/sqlite/provider";
import { getDatabaseAdapter } from "@/data/database";

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
    const { resolveServingScope } = await import("@/lib/security/scope-resolver");
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
    const { resolveServingScope } = await import("@/lib/security/scope-resolver");
    const requested = requestedCandidateScope(data);
    const { scope } = await resolveServingScope(user.id, requested?.tenantId, undefined, requested?.personId, "write:person");
    const run = await getRepositories().scrapeRuns.getRun(scope, data.runId);
    if (!run) {
      const { TenantIsolationError } = await import("@/lib/security/auth");
      throw new TenantIsolationError(`Scrape run '${data.runId}' not found or unauthorized for current tenant/person.`);
    }

    const { EnrichmentQueue } = await import("../../scripts/scraper/persist/queue");
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
      const { resolveScraperAuthContext } = await import("@/lib/security/scope-resolver");
      const requested = requestedCandidateScope(data);
      const { scope, activeContext } = await resolveScraperAuthContext(user.id, requested?.tenantId, undefined, requested?.personId);
      const { ScraperPlanResolver } = await import("@/acquisition/plan-resolver");
      const resolvedPlan = await ScraperPlanResolver.resolveActivePlan(scope, activeContext);
      const { compileCoverageVariants } = await import("../../scripts/scraper/run/acquisition-variants");
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
      const { resolveScraperAuthContext } = await import("@/lib/security/scope-resolver");
      const requested = requestedCandidateScope(data);
      const { scope, activeContext } = await resolveScraperAuthContext(user.id, requested?.tenantId, undefined, requested?.personId, "write:person");
      const { ScraperPlanResolver } = await import("@/acquisition/plan-resolver");
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
    const { resolveServingScope } = await import("@/lib/security/scope-resolver");
    const requested = requestedCandidateScope(data);
    const { scope } = await resolveServingScope(user.id, requested?.tenantId, undefined, requested?.personId);
    const scopedRun = await getRepositories().scrapeRuns.getRun(scope, runId);
    if (!scopedRun) {
      const { TenantIsolationError } = await import("@/lib/security/auth");
      throw new TenantIsolationError(`Scrape run '${runId}' not found or unauthorized for current tenant/person.`);
    }
    const { readLocalRunEvents } = await import("./local-artifacts.server");
    const { events, nextIndex, manifest, summary } = readLocalRunEvents(runId, afterIndex);

    // Load active enrichment stats from canonical Turso operational queue
    let enrichmentStats: any = null;
    let isEnriching = false;
    try {
      const { EnrichmentQueue } = await import("../../scripts/scraper/persist/queue");
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

async function canonicalProgress(run: import("@/data/sqlite/repositories/SqliteScrapeRunStore").ScrapeRun) {
  const { buildCanonicalRunData } = await import("./local-artifacts.server");
  const disk = buildCanonicalRunData(run.id);
  const db = getDatabaseAdapter();
  const { EnrichmentQueue } = await import("../../scripts/scraper/persist/queue");
  const enrichment = await new EnrichmentQueue().getRunStats(run.id);
  const activeContext = run.searchPlanId
    ? await db.one<{ context_fingerprint: string }>(
        `SELECT context_fingerprint FROM active_evaluation_contexts
         WHERE tenant_id=? AND person_id=? AND search_plan_id=?`,
        [run.tenantId, run.personId, run.searchPlanId],
      )
    : null;
  const evaluation = activeContext
    ? await db.one<{total: number; completed: number; failed: number}>(
        `SELECT COUNT(*) AS total,
          SUM(CASE WHEN er.status='SATISFIED' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN er.status='FAILED' THEN 1 ELSE 0 END) AS failed
         FROM scrape_run_evaluation_requirements r
         JOIN evaluation_requirements er ON er.id=r.evaluation_requirement_id
         WHERE r.run_id=? AND er.tenant_id=? AND er.person_id=? AND er.search_plan_id=?
           AND er.evaluation_context_fingerprint=?`,
        [run.id, run.tenantId, run.personId, run.searchPlanId, activeContext.context_fingerprint],
      )
    : { total: 0, completed: 0, failed: 0 };
  const active = ["queued", "initializing", "waiting_for_confirmation", "running", "stopping", "enriching", "completing"].includes(run.status);
  return {
    runId: run.id, tenantId: run.tenantId, personId: run.personId,
    status: run.status, isActive: active,
    stage: run.status === "completed" ? "complete" : run.status === "aborted" ? "stopped" : run.status,
    opportunitiesFound: Math.max(run.totalDiscovered, disk?.opportunitiesFound || 0),
    enrichedCount: enrichment.completed,
    evaluatedCount: Number(evaluation?.completed || 0),
    remainingCount: Math.max(0, Number(evaluation?.total || 0) - Number(evaluation?.completed || 0) - Number(evaluation?.failed || 0)),
    sources: disk?.sources || Object.fromEntries(run.portalTargets.map(portal => [portal, "pending"])),
    portalHealth: disk?.portalHealth || {}, recentActivities: disk?.recentActivities || [],
    errorMessage: run.errorMessage,
    startedAt: run.startedAt || run.createdAt, updatedAt: run.updatedAt, finishedAt: run.finishedAt || undefined,
  };
}

export const getActiveScrapeFn = createServerFn({ method: "GET" })
  .validator((data?: CandidateScopeRequest) => data)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const { resolveServingScope } = await import("@/lib/security/scope-resolver");
    const requested = requestedCandidateScope(data);
    const { scope } = await resolveServingScope(user.id, requested?.tenantId, undefined, requested?.personId);
    const run = await getRepositories().scrapeRuns.getActiveRun(scope);
    return run ? canonicalProgress(run) : null;
  });

export const getLatestRunFn = createServerFn({ method: "GET" })
  .validator((data?: CandidateScopeRequest) => data)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const { resolveServingScope } = await import("@/lib/security/scope-resolver");
    const requested = requestedCandidateScope(data);
    const { scope } = await resolveServingScope(user.id, requested?.tenantId, undefined, requested?.personId);
    const repos = getRepositories();

    // 1. Query Turso Cloud for the caller's scoped latest run
    const latestDbRun = await repos.scrapeRuns.getLatestRun(scope);
    if (!latestDbRun) return null;

    return canonicalProgress(latestDbRun);
  });

export const getRunProgressFn = createServerFn({ method: "GET" })
  .validator((d: { runId: string } & CandidateScopeRequest) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const { resolveServingScope } = await import("@/lib/security/scope-resolver");
    const requested = requestedCandidateScope(data);
    const { scope } = await resolveServingScope(user.id, requested?.tenantId, undefined, requested?.personId);
    const repos = getRepositories();

    const dbRun = await repos.scrapeRuns.getRun(scope, data.runId);
    if (!dbRun) {
      const { TenantIsolationError } = await import("@/lib/security/auth");
      throw new TenantIsolationError(`Scrape run '${data.runId}' not found or unauthorized for current tenant/person.`);
    }

    return canonicalProgress(dbRun);
  });

export const confirmScrapeFn = createServerFn({ method: "POST" })
  .validator((d: { runId: string } & CandidateScopeRequest) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const { resolveServingScope } = await import("@/lib/security/scope-resolver");
    const requested = requestedCandidateScope(data);
    const { scope } = await resolveServingScope(user.id, requested?.tenantId, undefined, requested?.personId, "write:person");
    const repos = getRepositories();

    const dbRun = await repos.scrapeRuns.getRun(scope, data.runId);
    if (!dbRun) {
      const { TenantIsolationError } = await import("@/lib/security/auth");
      throw new TenantIsolationError(`Cannot confirm run '${data.runId}': unauthorized or not found.`);
    }

    await repos.scrapeRuns.updateRunStatus(scope, data.runId, "running");

    const { confirmLocalScrapeState } = await import("./local-artifacts.server");
    return confirmLocalScrapeState(data.runId);
  });

export const abortScrapeFn = createServerFn({ method: "POST" })
  .validator((d: { runId: string } & CandidateScopeRequest) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const { resolveServingScope } = await import("@/lib/security/scope-resolver");
    const requested = requestedCandidateScope(data);
    const { scope } = await resolveServingScope(user.id, requested?.tenantId, undefined, requested?.personId, "write:person");
    const repos = getRepositories();

    const dbRun = await repos.scrapeRuns.getRun(scope, data.runId);
    if (!dbRun) {
      const { TenantIsolationError } = await import("@/lib/security/auth");
      throw new TenantIsolationError(`Cannot abort run '${data.runId}': unauthorized or not found.`);
    }

    // Repeating Stop explicitly cancels an interrupted stopping run. Queued work
    // has no browser to wait for. Terminal state fences any late worker writes.
    const cancel = dbRun.status === "queued" || dbRun.status === "stopping";
    const changed = await repos.scrapeRuns.updateRunStatus(scope, data.runId, cancel ? "aborted" : "stopping");
    if (!changed) return { success: true, status: dbRun.status };
    const { abortScrapeState } = await import("./local-artifacts.server");
    return abortScrapeState(data.runId, cancel);
  });

export const getLiveScrapedFn = createServerFn({ method: "GET" })
  .validator((data?: CandidateScopeRequest) => data)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const requested = requestedCandidateScope(data);
    await import("@/lib/security/scope-resolver").then(({ resolveServingScope }) => resolveServingScope(user.id, requested?.tenantId, undefined, requested?.personId));
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
      const { calculateCorpusHealth } = await import("../../scripts/corpus/health");
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
      const { EnrichmentQueue } = await import("../../scripts/scraper/persist/queue");
      const queue = new EnrichmentQueue();
      const stats = await queue.getGlobalPipelineStats();
      
      // Compute actual database evaluation metrics via canonical serving
      const { OpportunityService } = await import("@/opportunity/service");
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
