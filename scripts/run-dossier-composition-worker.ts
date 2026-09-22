import { getDatabaseAdapter } from "../src/data/database";
import { loadMantleCredentials } from "../src/lib/model/bedrock-credentials";
import { DossierCompositionWorker } from "../src/lib/intelligence/staged/DossierCompositionWorker";

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
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

do {
  const results = await Promise.all(workers.map((worker) => worker.pollOnce()));
  for (const result of results) if (result) console.log(JSON.stringify(result));
  if (process.argv.includes("--once")) break;
  if (!stopping && results.every((result) => result === null)) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
} while (!stopping);
