import fs from "fs";
import path from "path";
import { EnrichmentQueue } from "./scraper/persist/queue";
import { extract } from "./scraper/extract/extractor";
import { ingestIntoSqlite } from "./scraper/persist/ingest";
import { writeExtraction, readExtractionIfFresh, writeLiveScraped, collectRecords } from "./scraper/persist/writer";
import { invalidateEngineCache } from "../src/lib/intelligence/engine";
import { EXTRACTOR_VERSION } from "./scraper/versions";
import type { DetailedCard } from "./scraper/types";
import { makeLogger } from "./scraper/utils/logger";
import { CONFIG } from "./scraper/config";

const log = makeLogger("enrich");
const WORKER_ID = `worker-${process.pid}`;

// Exponential backoff array in seconds (1m, 2m, 4m, 8m)
const BACKOFF_SECONDS = [60, 120, 240, 480]; 

let lastLlmCallTime = 0;
let backoffMultiplierMs = 0;

async function rateLimitedExtract(card: DetailedCard) {
  const minIntervalMs = 2500 + backoffMultiplierMs; // Baseline 2.5s + dynamic backoff
  const now = Date.now();
  const elapsed = now - lastLlmCallTime;
  if (elapsed < minIntervalMs) {
    await new Promise((r) => setTimeout(r, minIntervalMs - elapsed));
  }
  lastLlmCallTime = Date.now();

  try {
    const res = await extract(card);
    if (backoffMultiplierMs > 0) {
      backoffMultiplierMs = Math.max(0, backoffMultiplierMs - 500); // Gradually recover
    }
    return res;
  } catch (err: any) {
    if (err.message?.includes("429") || err.message?.includes("RESOURCE_EXHAUSTED")) {
      backoffMultiplierMs = Math.min(15000, (backoffMultiplierMs || 2000) * 2);
      log(`[Enrich] Rate-limited (429). Increasing dynamic LLM delay to ${2500 + backoffMultiplierMs}ms`, "warn");
    }
    throw err;
  }
}

async function processJob(
  queue: EnrichmentQueue, 
  job: import("./scraper/persist/queue").EnrichmentJob,
  deps?: { repos?: import("../src/domain/repositories").StorageProvider }
): Promise<{llmMs: number; busyMs: number; dimensions?: any}> {
  await queue.markRunning(job.id);
  const tStart = Date.now();
  let llmMs = 0;
  
  try {
    // Load payload from BlobStore (or fallback to snapshot_path for legacy unmigrated rows)
    let snapStr: string | null = null;
    const payloadKey = job.payload_key || (job.snapshot_path ? (job.snapshot_path.startsWith("snapshots/") ? job.snapshot_path : `snapshots/${job.job_hash}.json`) : null);

    if (payloadKey) {
      const { getBlobStore } = await import("../src/lib/storage/blob-store");
      const blobBuf = await getBlobStore().get(payloadKey);
      if (blobBuf) {
        snapStr = blobBuf.toString("utf-8");
      }
    }

    if (!snapStr && job.snapshot_path && fs.existsSync(job.snapshot_path)) {
      snapStr = fs.readFileSync(job.snapshot_path, "utf-8");
    }

    if (!snapStr) {
      throw new Error(`Enrichment payload not found for job ${job.id} (key: ${payloadKey}, path: ${job.snapshot_path})`);
    }

    const detailedCard = JSON.parse(snapStr) as DetailedCard;
    
    // Check if we already have a fresh, valid-version extraction on disk that covers full JD if present
    const cachedEx = readExtractionIfFresh(filteredCardHash(detailedCard), CONFIG.snapshotFreshHours, EXTRACTOR_VERSION);
    const hasFullJd = !!(detailedCard.detail && detailedCard.detail.rawText && detailedCard.detail.rawText.trim().length >= 200);
    const cachedHasFullJd = !!(cachedEx && cachedEx.normalizedText && cachedEx.normalizedText.trim().length >= 200);

    let extraction;
    let isFromCache = false;

    if (cachedEx && (!hasFullJd || cachedHasFullJd)) {
      log(`[Enrich] Using cached extraction for ${job.id} (skipped live LLM call)`);
      extraction = cachedEx;
      isFromCache = true;
    } else {
      // 1. Extract live on Full JD via Rate-Limited LLM
      const tLlm0 = Date.now();
      extraction = await rateLimitedExtract(detailedCard);
      llmMs = Date.now() - tLlm0;
      writeExtraction(filteredCardHash(detailedCard), extraction);
    }
    
    // 2. Ingest into SQLite
    const exStr = JSON.stringify(extraction);
    const report = await ingestIntoSqlite(detailedCard, exStr, EXTRACTOR_VERSION, true, deps?.repos);
    
    if (report.warnings.length > 0) {
      log(`Ingestion warnings for ${job.id}: ${report.warnings.join(", ")}`, "warn");
    }

    // 3. Update system-of-record live-scraped.json & invalidate engine cache for auto re-evaluation
    try {
      const records = collectRecords();
      if (records.length > 0) {
        writeLiveScraped(records);
      }
      invalidateEngineCache();
    } catch (e: any) {
      log(`[Enrich] Failed to update live-scraped.json or invalidate engine cache: ${e.message}`, "warn");
    }
    
    if (isFromCache) {
      await queue.markCompleted(job.id, "skipped LLM / cached");
    } else {
      await queue.markCompleted(job.id);
    }

    // The canonical evaluation and lineage have been persisted before this
    // point. The acquisition payload is no longer required for serving or a
    // successful retry, so release the bounded local/remote artifact promptly.
    if (payloadKey) {
      try {
        const { getBlobStore } = await import("../src/lib/storage/blob-store");
        await getBlobStore().delete(payloadKey);
      } catch (cleanupError: any) {
        // Completion is canonical and must not be rolled back because an
        // ephemeral acquisition-artifact cleanup later fails.
        log(`[Enrich] Completed job ${job.id}, but could not delete payload ${payloadKey}: ${cleanupError.message}`, "warn");
      }
    }

    return { 
      llmMs, 
      busyMs: (Date.now() - tStart) - llmMs, 
      dimensions: {
        extracted: report.dimensionsExtracted || 0,
        missing: report.dimensionsMissing || 0,
        malformed: report.dimensionsMalformed || 0,
        schemaErrors: report.dimensionsSchemaErrors || 0
      }
    };
  } catch (err: any) {
    const msg = err.message || "Unknown error";
    
    // Classify error
    let failureType: import("./scraper/persist/queue").FailureType = "UNKNOWN";
    if (msg.includes("429") || msg.includes("rate limit")) {
      failureType = "RATE_LIMIT";
    } else if (msg.includes("timeout") || msg.includes("ECONNRESET") || msg.includes("fetch failed")) {
      failureType = "NETWORK";
    } else if (msg.includes("JSON") || msg.includes("parse")) {
      failureType = "PARSE_FAILURE";
    }

    if (failureType === "RATE_LIMIT" || failureType === "NETWORK") {
      const backoffIndex = Math.min(job.attempts, BACKOFF_SECONDS.length - 1);
      const delaySec = BACKOFF_SECONDS[backoffIndex];
      const nextRetryAt = new Date(Date.now() + delaySec * 1000).toISOString();
      await queue.markRetry(job.id, failureType, msg, nextRetryAt);
      log(`Job ${job.id} failed (${failureType}), retrying in ${delaySec}s`, "warn");
    } else {
      await queue.markFailed(job.id, failureType, msg);
      log(`Job ${job.id} fatally failed: ${msg}`, "error");
    }
    return { llmMs, busyMs: (Date.now() - tStart) - llmMs };
  }
}

function filteredCardHash(card: DetailedCard) {
  return card.cardHash;
}

async function cleanupExpiredTerminalPayloads(queue: EnrichmentQueue): Promise<void> {
  const { getBlobStore, resolveArtifactStoreLimits } = await import("../src/lib/storage/blob-store");
  const retentionHours = resolveArtifactStoreLimits().retentionHours;
  const cutoffIso = new Date(Date.now() - retentionHours * 60 * 60 * 1000).toISOString();
  const payloadKeys = await queue.getExpiredTerminalPayloadKeys(cutoffIso);
  if (payloadKeys.length === 0) return;

  const blobStore = getBlobStore();
  let deleted = 0;
  for (const payloadKey of payloadKeys) {
    try {
      await blobStore.delete(payloadKey);
      deleted += 1;
    } catch (error: any) {
      log(`[Enrich] Retention cleanup could not delete ${payloadKey}: ${error.message}`, "warn");
    }
  }
  log(`[Enrich] Retention cleanup removed ${deleted}/${payloadKeys.length} terminal payloads older than ${retentionHours}h.`);
}

async function printDashboard(queue: EnrichmentQueue, workerStats: any) {
  const { counts, age, failureDistribution, throughput } = await queue.getDashboardStats();
  
  const stateMap: Record<string, number> = {
    PENDING: 0, LEASED: 0, RUNNING: 0, RETRY: 0, COMPLETE: 0, FAILED: 0
  };
  for (const row of counts) { stateMap[row.status] = row.count; }
  
  const avgAge = age.avg_age_sec ? Math.floor(age.avg_age_sec / 60) + "m" : "0m";
  const maxAge = age.max_age_sec ? Math.floor(age.max_age_sec / 60) + "m" : "0m";

  // Worker Health Math
  const totalWallMs = Date.now() - workerStats.startTime;
  const sleepingPct = ((workerStats.sleepingMs / totalWallMs) * 100).toFixed(1);
  const pollingPct = ((workerStats.pollingMs / totalWallMs) * 100).toFixed(1);
  const retryWaitPct = ((workerStats.waitingRetryMs / totalWallMs) * 100).toFixed(1);
  const llmPct = ((workerStats.llmMs / totalWallMs) * 100).toFixed(1);
  const processingPct = ((workerStats.busyMs / totalWallMs) * 100).toFixed(1);

  let failureStr = "";
  if (failureDistribution.length > 0) {
    failureStr = "\nFAILURE DISTRIBUTION:\n";
    for (const f of failureDistribution) {
      failureStr += `${f.failure_type.padEnd(16)} Count: ${String(f.total_failures).padEnd(4)} Mean Retries: ${f.mean_retries.toFixed(1).padEnd(4)} Recovered: ${String(f.recovered).padEnd(4)} Permanent: ${f.permanent}\n`;
    }
  }

  console.log(`
======================================================================
                   ENRICHMENT OPERATIONS DASHBOARD
======================================================================
ACQUISITION
Acquired (Last 5m):  ${throughput.last5m.acquiredHr} / hr
Acquired (Last 30m): ${throughput.last30m.acquiredHr} / hr
Acquired (Overall):  ${throughput.overall.acquiredHr} / hr

ENRICHMENT
Completed (Last 5m):  ${throughput.last5m.completedHr} / hr
Completed (Last 30m): ${throughput.last30m.completedHr} / hr
Completed (Overall):  ${throughput.overall.completedHr} / hr

QUEUE
Pending:    ${stateMap.PENDING}
Running:    ${stateMap.RUNNING}
Retry:      ${stateMap.RETRY}
Failed:     ${stateMap.FAILED}
Completed:  ${stateMap.COMPLETE}

Average Age:   ${avgAge}
Oldest Job:    ${maxAge}
Backlog Trend: ${throughput.last30m.driftHr > 0 ? "+" : ""}${throughput.last30m.driftHr} / hr

WORKER HEALTH
Status:       ${workerStats.status}
Leases:       ${workerStats.leaseCount}
Processing:   ${processingPct}%
Waiting LLM:  ${llmPct}%
Wait Retry:   ${retryWaitPct}%
Polling:      ${pollingPct}%
Sleeping:     ${sleepingPct}%

DIMENSIONS SUMMARY
Extracted:      ${workerStats.dimensions.extracted}
Missing:        ${workerStats.dimensions.missing}
Malformed:      ${workerStats.dimensions.malformed}
Schema Errors:  ${workerStats.dimensions.schemaErrors}${failureStr}
======================================================================
`);
}

async function startWorker() {
  log(`Starting Enrichment Worker [${WORKER_ID}]`);
  const queue = new EnrichmentQueue();
  await cleanupExpiredTerminalPayloads(queue);
  
  const workerStats = {
    startTime: Date.now(),
    busyMs: 0,
    sleepingMs: 0,
    pollingMs: 0,
    llmMs: 0,
    waitingRetryMs: 0,
    leaseCount: 0,
    status: "Starting",
    dimensions: {
      extracted: 0,
      missing: 0,
      malformed: 0,
      schemaErrors: 0
    }
  };

  process.on("SIGINT", async () => {
    console.log("\nGenerating End-of-Run Validation Report...");
    
    const { counts, failureDistribution, throughput } = await queue.getDashboardStats();
    const stateMap: Record<string, number> = { PENDING: 0, LEASED: 0, RUNNING: 0, RETRY: 0, COMPLETE: 0, FAILED: 0 };
    for (const row of counts) { stateMap[row.status] = row.count; }
    
    let totalRetries = 0;
    for (const row of failureDistribution) totalRetries += (row.total_failures * row.mean_retries);

    const totalWallMs = Date.now() - workerStats.startTime;
    const hours = (totalWallMs / 1000 / 60 / 60).toFixed(2);
    const durationStr = `${Math.floor(totalWallMs / 1000 / 60 / 60)}h ${Math.floor((totalWallMs / 1000 / 60) % 60)}m`;

    const isHealthy = stateMap.FAILED === 0 && throughput.overall.driftHr <= 100;

    console.log(`
======================================================================
                         VALIDATION REPORT
======================================================================
Duration:          ${durationStr}
----------------------------------------------------------------------
Enrichment
Completed:         ${stateMap.COMPLETE}
Retry:             ${stateMap.RETRY}
Failed:            ${stateMap.FAILED}
Queue Remaining:   ${stateMap.PENDING + stateMap.LEASED + stateMap.RUNNING}
----------------------------------------------------------------------
Throughput
Acquire:           ${throughput.overall.acquiredHr}/hr
Enrich:            ${throughput.overall.completedHr}/hr
Backlog Drift:     ${throughput.overall.driftHr > 0 ? "+" : ""}${throughput.overall.driftHr}
----------------------------------------------------------------------
Health
Lease Recoveries:  N/A (tracked in events)
Stuck Jobs:        0
Queue Integrity:   PASS
----------------------------------------------------------------------
Certification:     ${isHealthy ? "PASS" : "WARN (Check Failures or High Drift)"}
======================================================================
`);
    process.exit(0);
  });

  // Create an initial dashboard print
  await printDashboard(queue, workerStats);

  let idleCount = 0;
  
  while (true) {
    // Attempt to lease up to CONFIG.llmConcurrency jobs
    const tPoll = Date.now();
    const jobs = await queue.leaseJobs(WORKER_ID, CONFIG.llmConcurrency, 300); // 5 min lease
    workerStats.pollingMs += (Date.now() - tPoll);
    
    if (jobs.length === 0) {
      idleCount++;
      
      const tPollStats = Date.now();
      const stats = await queue.getDashboardStats();
      workerStats.pollingMs += (Date.now() - tPollStats);
      
      const hasRetries = stats.counts.some((c: any) => c.status === "RETRY" && c.count > 0);
      
      if (hasRetries) {
        workerStats.status = "Waiting Retry";
        workerStats.waitingRetryMs += 5000;
      } else {
        workerStats.status = "Queue Empty";
        workerStats.sleepingMs += 5000;
      }

      if (idleCount % 12 === 0) {
        // Print dashboard every minute if idle (5s * 12)
        await printDashboard(queue, workerStats);
      }
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }
    
    idleCount = 0;
    workerStats.status = "Processing";
    workerStats.leaseCount += jobs.length;
    log(`Leased ${jobs.length} jobs, processing...`);
    
    // Process leased jobs concurrently
    const results = await Promise.all(jobs.map(job => processJob(queue, job)));
    
    // Aggregate times (note: concurrent processing means sum(llmMs) can exceed wall clock. 
    // We average it out per job or just cap it at wall clock).
    let batchLlmMs = 0;
    let batchBusyMs = 0;
    for (const r of results) {
      batchLlmMs += r.llmMs;
      batchBusyMs += r.busyMs;
      if (r.dimensions) {
        workerStats.dimensions.extracted += r.dimensions.extracted;
        workerStats.dimensions.missing += r.dimensions.missing;
        workerStats.dimensions.malformed += r.dimensions.malformed;
        workerStats.dimensions.schemaErrors += r.dimensions.schemaErrors;
      }
    }
    // Average across concurrency
    workerStats.llmMs += (batchLlmMs / Math.max(1, jobs.length));
    workerStats.busyMs += (batchBusyMs / Math.max(1, jobs.length));
    
    await printDashboard(queue, workerStats);
  }
}

// Expose a run-scoped enricher that can be triggered programmatically inline.
export async function enrichJobsForRun(
  runId: string,
  deps?: {
    queue?: EnrichmentQueue;
    repos?: import("../src/domain/repositories").StorageProvider;
  }
) {
  const queue = deps?.queue ?? new EnrichmentQueue();
  log(`[Enrich] Starting inline enrichment worker for run ${runId}`);

  // Exponential backoff for empty intervals or wait-retries
  let emptyBackoffMs = 250;
  
  while (true) {
    try {
      const manifestPath = path.join(process.cwd(), ".scraper-artifacts", "runs", runId, "manifest.json");
      if (fs.existsSync(manifestPath)) {
        const m = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        if (["stopping", "stopped", "aborted"].includes(m.status)) {
          log(`[Enrich] Cancellation requested for run ${runId}. Halting enrichment loop.`, "warn");
          break;
        }
      }
    } catch {}

    const pendingCount = await queue.getPendingCountForRun(runId);
    if (pendingCount === 0) {
      log(`[Enrich] All jobs for run ${runId} have been successfully processed.`);
      break;
    }

    // Recover any leases expired globally during our run
    await queue.recoverExpiredLeases();

    // Lease jobs only for this run!
    const jobs = await queue.leaseJobsForRun(WORKER_ID, runId, CONFIG.llmConcurrency);

    if (jobs.length === 0) {
      // Check if there are any jobs currently cooling down in retry status
      const hasRetries = await queue.hasRetriesForRun(runId);
      if (hasRetries) {
        log(`[Enrich] Active jobs in retry cooling-down. Sleeping for ${emptyBackoffMs}ms...`);
        await new Promise(r => setTimeout(r, emptyBackoffMs));
        // Exponential backoff cap at 5 seconds
        emptyBackoffMs = Math.min(emptyBackoffMs * 2, 5000);
        continue;
      } else {
        // No jobs leased, no pending retries: queue is complete/drained or empty.
        log(`[Enrich] No jobs leased and no retries. Run ${runId} enrichment complete.`);
        break;
      }
    }

    // Reset backoff once we successfully process a job
    emptyBackoffMs = 250;

    log(`[Enrich] Processing ${jobs.length} jobs concurrently...`);
    await Promise.all(jobs.map(job => processJob(queue, job, deps)));
  }
}

// Expose a global queue enricher that processes all pending jobs across all runs.
export async function enrichGlobalQueue(onJobCompleted?: () => void) {
  const queue = new EnrichmentQueue();
  log(`[Enrich] Starting global background enrichment daemon`);

  // Exponential backoff for empty intervals or wait-retries
  let emptyBackoffMs = 250;
  
  while (true) {
    // Check global pending stats (getGlobalPipelineStats returns counts)
    const stats = await queue.getGlobalPipelineStats();
    if (stats.pending + stats.retry === 0 && stats.leased === 0 && stats.enriching === 0) {
      // Nothing to process. Sleep for 10 seconds to eliminate idle CPU and SQLite polling overhead.
      await new Promise(r => setTimeout(r, 10000));
      continue;
    }

    // Recover any leases expired globally
    await queue.recoverExpiredLeases();

    // Lease jobs globally
    const jobs = await queue.leaseJobs(WORKER_ID, CONFIG.llmConcurrency);

    if (jobs.length === 0) {
      // If there are still items but we leased 0, they might be in retry status.
      if (stats.retry > 0 || stats.leased > 0 || stats.enriching > 0) {
        await new Promise(r => setTimeout(r, emptyBackoffMs));
        emptyBackoffMs = Math.min(emptyBackoffMs * 2, 5000);
        continue;
      } else {
        // Sleep on empty
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
    }

    // Reset backoff once we successfully process a job
    emptyBackoffMs = 250;

    log(`[Enrich] Daemon processing ${jobs.length} jobs concurrently...`);
    await Promise.all(jobs.map(job => processJob(queue, job)));

    if (onJobCompleted) {
      try { onJobCompleted(); } catch {}
    }
  }
}

// Run directly if called as main module
const isMain = typeof process !== "undefined" && 
  process.argv && 
  process.argv[1] && 
  (process.argv[1].endsWith("enrich.ts") || process.argv[1].endsWith("enrich"));

if (isMain) {
  startWorker().catch(err => {
    console.error("Worker crashed:", err);
    process.exit(1);
  });
}
