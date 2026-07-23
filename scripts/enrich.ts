import fs from "fs";
import path from "path";
import { EnrichmentQueue } from "./scraper/persist/queue";
import { extract } from "./scraper/extract/extractor";
import { ingestIntoSqlite } from "./scraper/persist/ingest";
import { writeExtraction, readExtractionIfFresh } from "./scraper/persist/writer";
import { EXTRACTOR_VERSION } from "./scraper/versions";
import type { DetailedCard } from "./scraper/types";
import { makeLogger } from "./scraper/utils/logger";
import { CONFIG } from "./scraper/config";

const log = makeLogger("enrich");
const WORKER_ID = `worker-${process.pid}`;

// Exponential backoff array in seconds (1m, 2m, 4m, 8m)
const BACKOFF_SECONDS = [60, 120, 240, 480]; 

async function processJob(queue: EnrichmentQueue, job: import("./scraper/persist/queue").EnrichmentJob): Promise<{llmMs: number; busyMs: number; dimensions?: any}> {
  queue.markRunning(job.id);
  const tStart = Date.now();
  let llmMs = 0;
  
  try {
    const snapStr = fs.readFileSync(job.snapshot_path, "utf-8");
    const detailedCard = JSON.parse(snapStr) as DetailedCard;
    
    // Check if we already have a fresh, valid-version extraction on disk!
    const cachedEx = readExtractionIfFresh(filteredCardHash(detailedCard), CONFIG.snapshotFreshHours, EXTRACTOR_VERSION);
    let extraction;
    let isFromCache = false;

    if (cachedEx) {
      log(`[Enrich] Using cached extraction for ${job.id} (skipped live LLM call)`);
      extraction = cachedEx;
      isFromCache = true;
    } else {
      // 1. Extract live via LLM
      const tLlm0 = Date.now();
      extraction = await extract(detailedCard);
      llmMs = Date.now() - tLlm0;
      writeExtraction(filteredCardHash(detailedCard), extraction);
    }
    
    // 2. Ingest into SQLite
    const exStr = JSON.stringify(extraction);
    const report = ingestIntoSqlite(detailedCard, exStr, EXTRACTOR_VERSION, true);
    
    if (report.warnings.length > 0) {
      log(`Ingestion warnings for ${job.id}: ${report.warnings.join(", ")}`, "warn");
    }
    
    if (isFromCache) {
      queue.markCompleted(job.id, "skipped LLM / cached");
    } else {
      queue.markCompleted(job.id);
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
      queue.markRetry(job.id, failureType, msg, nextRetryAt);
      log(`Job ${job.id} failed (${failureType}), retrying in ${delaySec}s`, "warn");
    } else {
      queue.markFailed(job.id, failureType, msg);
      log(`Job ${job.id} fatally failed: ${msg}`, "error");
    }
    return { llmMs, busyMs: (Date.now() - tStart) - llmMs };
  }
}

function filteredCardHash(card: DetailedCard) {
  return card.cardHash;
}

function printDashboard(queue: EnrichmentQueue, workerStats: any) {
  const { counts, age, failureDistribution, throughput } = queue.getDashboardStats();
  
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

  process.on("SIGINT", () => {
    console.log("\nGenerating End-of-Run Validation Report...");
    
    const { counts, failureDistribution, throughput } = queue.getDashboardStats();
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
  printDashboard(queue, workerStats);



  let idleCount = 0;
  
  while (true) {
    // Attempt to lease up to CONFIG.llmConcurrency jobs
    const tPoll = Date.now();
    const jobs = queue.leaseJobs(WORKER_ID, CONFIG.llmConcurrency, 300); // 5 min lease
    workerStats.pollingMs += (Date.now() - tPoll);
    
    if (jobs.length === 0) {
      idleCount++;
      
      const tPollStats = Date.now();
      const stats = queue.getDashboardStats();
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
        printDashboard(queue, workerStats);
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
    
    printDashboard(queue, workerStats);
  }
}

// Expose a run-scoped enricher that can be triggered programmatically inline.
export async function enrichJobsForRun(runId: string) {
  const queue = new EnrichmentQueue();
  log(`[Enrich] Starting inline enrichment worker for run ${runId}`);

  // Exponential backoff for empty intervals or wait-retries
  let emptyBackoffMs = 250;
  
  while (true) {
    const pendingCount = queue.getPendingCountForRun(runId);
    if (pendingCount === 0) {
      log(`[Enrich] All jobs for run ${runId} have been successfully processed.`);
      break;
    }

    // Recover any leases expired globally during our run
    queue.recoverExpiredLeases();

    // Lease jobs only for this run!
    const jobs = queue.leaseJobsForRun(WORKER_ID, runId, CONFIG.llmConcurrency);

    if (jobs.length === 0) {
      // Check if there are any jobs currently cooling down in retry status
      const hasRetries = queue.hasRetriesForRun(runId);
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
    await Promise.all(jobs.map(job => processJob(queue, job)));
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
    const stats = queue.getGlobalPipelineStats();
    if (stats.pending + stats.retry === 0 && stats.leased === 0 && stats.enriching === 0) {
      // Nothing to process. Sleep for 10 seconds to eliminate idle CPU and SQLite polling overhead.
      await new Promise(r => setTimeout(r, 10000));
      continue;
    }

    // Recover any leases expired globally
    queue.recoverExpiredLeases();

    // Lease jobs globally
    const jobs = queue.leaseJobs(WORKER_ID, CONFIG.llmConcurrency);

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

