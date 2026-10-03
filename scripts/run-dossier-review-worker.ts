import { createJobModel } from "../src/admin/model-gateway";
import { getDatabaseAdapter } from "../src/data/database";
import { createDossierWriterModel } from "../src/lib/model/dossier-writer-model";
import { createFactualReviewModel } from "../src/lib/model/factual-review-model";
import { DossierReviewWorker } from "../src/dossier/runtime/review-worker";
import { createSqliteModelInvocationSink } from "../src/lib/model/model-invocation";
import { runtimeLog } from "../src/lib/intelligence/runtime-log";
import { startWorkerHeartbeat } from "../src/lib/health/worker-heartbeat";
import { jobConcurrency } from "../src/admin/operations-runtime";

const BASE_IDLE_POLL_MS = 5_000;
const MAX_IDLE_POLL_MS = 30_000;

const db = getDatabaseAdapter();
if (
  !(await db.one(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='dossier_review_jobs'",
  ))
)
  throw new Error("Apply migration 052 before starting the review worker");
const workers = Array.from(
  { length: 8 },
  () =>
    new DossierReviewWorker(
      db,
      (context) =>
        createJobModel(
          db,
          context,
          () =>
            createDossierWriterModel({
              invocationSink: createSqliteModelInvocationSink(db, context),
            }),
          createSqliteModelInvocationSink(db, context),
        ),
      (context) =>
        createJobModel(
          db,
          context,
          () =>
            createFactualReviewModel({
              invocationSink: createSqliteModelInvocationSink(db, context),
            }),
          createSqliteModelInvocationSink(db, context),
        ),
    ),
);
await startWorkerHeartbeat("dossier-review");
let stopping = false;
let idlePolls = 0;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
do {
  let processed = false;
  try {
    const activeConcurrency = await jobConcurrency(db, "factual_review", 1);
    const results = await Promise.all(
      workers.slice(0, activeConcurrency).map((worker) => worker.pollOnce()),
    );
    for (const result of results)
      if (result) {
        processed = true;
        idlePolls = 0;
        runtimeLog("info", "dossier_review_processed", { status: result.status });
        // The transition itself is the authoritative time to surface attention.
        if (result.status === "needs_attention")
          runtimeLog("warn", "dossier_review_needs_attention", { status: result.status });
      }
    if (process.argv.includes("--once")) break;
  } catch {
    runtimeLog("error", "dossier_review_poll_error");
    if (process.argv.includes("--once")) {
      process.exitCode = 1;
      break;
    }
  }
  if (processed) {
    idlePolls = 0;
  } else if (!stopping) {
    const idleDelayMs = Math.min(BASE_IDLE_POLL_MS * 2 ** idlePolls, MAX_IDLE_POLL_MS);
    idlePolls = Math.min(idlePolls + 1, 4);
    await new Promise((resolve) => setTimeout(resolve, idleDelayMs));
  }
} while (!stopping);
