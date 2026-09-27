import { getDatabaseAdapter } from "../src/data/database";
import { loadMantleCredentials } from "../src/lib/model/bedrock-credentials";
import { createBedrockGlmResearchModel } from "../src/lib/model/bedrock-glm-research-model";
import { createFactualReviewModel } from "../src/lib/model/factual-review-model";
import { DossierReviewWorker } from "../src/lib/intelligence/staged/DossierReviewWorker";
import { createSqliteModelInvocationSink } from "../src/lib/model/model-invocation";
import { runtimeLog } from "../src/lib/intelligence/runtime-log";

const REVIEW_HEALTH_INTERVAL_MS = 5 * 60_000;
const BASE_IDLE_POLL_MS = 5_000;
const MAX_IDLE_POLL_MS = 30_000;

const db = getDatabaseAdapter();
if (!await db.one("SELECT name FROM sqlite_master WHERE type='table' AND name='dossier_review_jobs'")) throw new Error('Apply migration 052 before starting the review worker');
loadMantleCredentials();
const worker = new DossierReviewWorker(
  db,
  (context) =>
    createBedrockGlmResearchModel({
      invocationSink: createSqliteModelInvocationSink(db, context),
    }),
  (context) =>
    createFactualReviewModel({
      invocationSink: createSqliteModelInvocationSink(db, context),
    }),
);
let stopping = false;
let lastHealthCheckAt = 0;
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
    const result = await worker.pollOnce();
    if (result) {
      processed = true;
      idlePolls = 0;
      runtimeLog("info", "dossier_review_processed", { status: result.status });
      // The transition itself is the authoritative time to surface attention.
      if (result.status === "needs_attention") runtimeLog("warn", "dossier_review_needs_attention", { status: result.status });
    }
    if (process.argv.includes("--once")) break;
    const now = Date.now();
    if (now - lastHealthCheckAt >= REVIEW_HEALTH_INTERVAL_MS) {
      lastHealthCheckAt = now;
      const health = await db.one<{ pending: number; attention: number; oldest: number | null }>(
        `SELECT SUM(CASE WHEN status IN ('pending','retry','processing') THEN 1 ELSE 0 END) pending,SUM(CASE WHEN status='needs_attention' THEN 1 ELSE 0 END) attention,MIN(CASE WHEN status IN ('pending','retry','processing') THEN created_at END) oldest FROM dossier_review_jobs`,
      );
      if ((health?.attention ?? 0) > 0 || (health?.oldest && now - health.oldest > 3600_000))
        runtimeLog("warn", "dossier_review_queue_attention", { pending: health?.pending ?? 0, attention: health?.attention ?? 0 });
    }
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
