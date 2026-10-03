import { IntelligenceShadowWorker } from "../src/admin/intelligence-shadow-worker";
import { getDatabaseAdapter } from "../src/data/database";
import { BenchWorker } from "../src/admin/bench-worker";
import { startWorkerHeartbeat } from "../src/lib/health/worker-heartbeat";
const db = getDatabaseAdapter();
if (!(await db.one("SELECT name FROM sqlite_master WHERE name='admin_bench_runs'")))
  throw new Error("Apply migration 077 before starting the bench worker");
const heartbeat = await startWorkerHeartbeat("admin-bench");
const worker = new BenchWorker(db);
const taxonomyWorker = new IntelligenceShadowWorker(db);
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
do {
  const result = (await worker.pollOnce()) ?? (await taxonomyWorker.pollOnce());
  if (result) console.log(`[ADMIN_BENCH] ${result.id} ${result.status}`);
  if (process.argv.includes("--once")) break;
  if (!result) await new Promise((resolve) => setTimeout(resolve, 5000));
} while (!stopping);
heartbeat.stop();
await db.close?.();
