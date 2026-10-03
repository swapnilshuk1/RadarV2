/**
 * Durable Pursuit preparation worker. Serving routes only enqueue; deploy this
 * process wherever queued Pursuit preparation should be consumed.
 *   bun scripts/run-pursuit-preparation-worker.ts [--once] [--concurrency=N]
 */
import { getDatabaseAdapter } from "../src/data/database";
import { jobConcurrency } from "../src/admin/operations-runtime";
import { loadMantleCredentials } from "../src/lib/model/bedrock-credentials";
import { runtimeLog } from "../src/lib/intelligence/runtime-log";
import { PursuitPreparationWorker } from "../src/pursuit/preparation";
import { startWorkerHeartbeat } from "../src/lib/health/worker-heartbeat";

const db = getDatabaseAdapter();
if (
  !(await db.one(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='pursuit_preparation_jobs'",
  ))
)
  throw new Error("Apply migration 067 before starting the pursuit preparation worker");

try {
  loadMantleCredentials();
} catch {
  runtimeLog("warn", "pursuit_preparation_model_unavailable", { fallback: "deterministic" });
}

const arg = process.argv.find((v) => v.startsWith("--concurrency="));
const concurrency = Number(arg?.slice(14) || process.env.RADAR_PURSUIT_JOB_CONCURRENCY || "2");
if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8)
  throw new Error("PURSUIT_JOB_CONCURRENCY_INVALID");

// Register in the operational health registry so a silently dead pursuit
// worker is visible the same way every other RADAR worker is.
const heartbeat = process.argv.includes("--once")
  ? null
  : await startWorkerHeartbeat("pursuit-preparation");

const workers = Array.from(
  { length: 8 },
  (_, i) => new PursuitPreparationWorker(`pursuit-prep-${process.pid}-${i}`),
);
let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

let idle = 0;
do {
  const activeConcurrency = await jobConcurrency(getDatabaseAdapter(), "pursuit", concurrency);
  const results = await Promise.all(workers.slice(0, activeConcurrency).map((w) => w.pollOnce()));
  for (const r of results) if (r) runtimeLog("info", "pursuit_preparation_processed", r);
  if (process.argv.includes("--once")) break;
  if (results.some(Boolean)) idle = 0;
  else if (!stopping) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(3000 * 2 ** idle, 30_000)));
    idle = Math.min(idle + 1, 4);
  }
} while (!stopping);

heartbeat?.stop();
