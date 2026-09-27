import { getDatabaseAdapter } from "../src/data/database";
import { loadMantleCredentials } from "../src/lib/model/bedrock-credentials";
import { DossierCompositionWorker } from "../src/lib/intelligence/staged/DossierCompositionWorker";
import { runtimeLog } from "../src/lib/intelligence/runtime-log";

const db = getDatabaseAdapter();
if (
  !(await db.one(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='dossier_composition_jobs'",
  ))
)
  throw new Error("Apply migration 053 before starting the dossier composition worker");

loadMantleCredentials();

const arg = process.argv.find((value) => value.startsWith("--concurrency="));
const concurrency = Number(
  arg?.slice("--concurrency=".length) ||
    process.env.RADAR_DOSSIER_JOB_CONCURRENCY ||
    "2",
);
if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8)
  throw new Error("DOSSIER_JOB_CONCURRENCY_INVALID");

const workers = Array.from({ length: concurrency }, () => new DossierCompositionWorker(db));
const BASE_IDLE_POLL_MS = 3_000;
const MAX_IDLE_POLL_MS = 30_000;
let stopping = false;
let idlePolls = 0;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

do {
  const results = await Promise.all(workers.map((worker) => worker.pollOnce()));
  for (const result of results) if (result) runtimeLog("info", "dossier_composition_processed", { status: result.status });
  if (process.argv.includes("--once")) break;
  if (results.some((result) => result !== null)) {
    idlePolls = 0;
  } else if (!stopping) {
    const idleDelayMs = Math.min(BASE_IDLE_POLL_MS * 2 ** idlePolls, MAX_IDLE_POLL_MS);
    idlePolls = Math.min(idlePolls + 1, 4);
    await new Promise((resolve) => setTimeout(resolve, idleDelayMs));
  }
} while (!stopping);
