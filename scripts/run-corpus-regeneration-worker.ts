import crypto from "node:crypto";
import { getDatabaseAdapter } from "../src/data/database";
import type { DatabaseAdapter } from "../src/data/database";
import { runCorpusPipeline } from "./corpus/pipeline";
import { startWorkerHeartbeat } from "../src/lib/health/worker-heartbeat";

let stopping = false;
process.once("SIGTERM", () => { stopping = true; });
process.once("SIGINT", () => { stopping = true; });

export async function processNextCorpusRegenerationJob(
  workerId: string,
  pipeline: typeof runCorpusPipeline = runCorpusPipeline,
  adapter: DatabaseAdapter = getDatabaseAdapter(),
): Promise<boolean> {
  const db = adapter;
  const token = crypto.randomUUID();
  const claim = await db.execute("UPDATE corpus_regeneration_jobs SET status='processing',stage='INGESTING',locked_by=?,lease_token=?,started_at=COALESCE(started_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id='corpus-regeneration' AND status='queued'", [workerId, token]);
  if (claim.rowsAffected !== 1) return false;
  const append = async (message: string, stage: string) => {
    const row = await db.one<{logs_json:string}>("SELECT logs_json FROM corpus_regeneration_jobs WHERE id='corpus-regeneration' AND lease_token=?", [token]);
    const logs = [...JSON.parse(row?.logs_json || "[]"), `[${new Date().toISOString()}] ${message}`].slice(-200);
    await db.execute("UPDATE corpus_regeneration_jobs SET stage=?,logs_json=?,updated_at=CURRENT_TIMESTAMP WHERE id='corpus-regeneration' AND lease_token=? AND status='processing'", [stage, JSON.stringify(logs), token]);
  };
  try {
    const result = await pipeline(append);
    const status = result.success ? "completed" : "failed";
    const terminal = await db.execute("UPDATE corpus_regeneration_jobs SET status=?,stage=?,processed_count=?,error=?,completed_at=CURRENT_TIMESTAMP,locked_by=NULL,lease_token=NULL,updated_at=CURRENT_TIMESTAMP WHERE id='corpus-regeneration' AND lease_token=? AND status='processing'", [status, result.success ? "COMPLETE" : "FAILED", result.processedCount || 0, result.success ? null : (result.error || result.reason || "CORPUS_REGENERATION_FAILED"), token]);
    if (terminal.rowsAffected !== 1) throw new Error("CORPUS_REGENERATION_LEASE_LOST");
  } catch (error: any) {
    await db.execute("UPDATE corpus_regeneration_jobs SET status='failed',stage='FAILED',error=?,completed_at=CURRENT_TIMESTAMP,locked_by=NULL,lease_token=NULL,updated_at=CURRENT_TIMESTAMP WHERE id='corpus-regeneration' AND lease_token=? AND status='processing'", [error?.message || "CORPUS_REGENERATION_FAILED", token]);
  }
  return true;
}

async function run() {
  await startWorkerHeartbeat("corpus");
  const id = `corpus-worker-${process.pid}`;
  let idleMs = 1_000;
  while (!stopping) {
    if (await processNextCorpusRegenerationJob(id)) { idleMs = 1_000; continue; }
    await new Promise((resolve) => setTimeout(resolve, idleMs));
    idleMs = Math.min(idleMs * 2, 30_000);
  }
}
const isMain = process.argv[1]?.endsWith("run-corpus-regeneration-worker.ts") || process.argv[1]?.endsWith("run-corpus-regeneration-worker");
if (isMain) void run();
