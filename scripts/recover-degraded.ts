#!/usr/bin/env tsx
import { recoverDegradedEnrichmentsForRun } from "./enrich";

async function main() {
  const targetRun = process.argv[2] || process.env.RECOVER_RUN_ID || "run-1788945245759";
  console.log(`[Recovery] Initializing run-scoped recovery for run: ${targetRun}`);
  const result = await recoverDegradedEnrichmentsForRun(targetRun);
  console.log("[Recovery] Result summary:", result);
}

main().catch(err => {
  console.error("[Recovery] Fatal error:", err);
  process.exit(1);
});
