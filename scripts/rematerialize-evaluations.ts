/**
 * scripts/rematerialize-evaluations.ts
 *
 * Controlled CLI runner for RADAR V4 Canonical Re-Materialization.
 * 
 * Features:
 *   - Batch-level prefetching and deduplication
 *   - Bounded concurrent worker execution (--concurrency <N>, default: 8)
 *   - Continuous multi-batch execution mode (--continuous, --max-batches <N>)
 *   - Automatic checkpointing and immediate hard stops on invariants
 *   - Detailed performance and latency observability
 *
 * Usage:
 *   npx tsx scripts/rematerialize-evaluations.ts --dry-run --limit 10
 *   npx tsx scripts/rematerialize-evaluations.ts --limit 50 --concurrency 8
 *   npx tsx scripts/rematerialize-evaluations.ts --cursor "indeed:c407f5824aaeac09" --limit 100
 *   npx tsx scripts/rematerialize-evaluations.ts --continuous --limit 100 --max-batches 5
 */

import { EvaluationRematerializer } from "../src/lib/intelligence/rematerialization/EvaluationRematerializer";
import type { RematerializeOptions, BatchReconciliationReport } from "../src/lib/intelligence/rematerialization/RematerializationTypes";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const continuous = args.includes("--continuous");

  let limit = 10;
  const limitIdx = args.indexOf("--limit");
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    limit = parseInt(args[limitIdx + 1], 10);
  }

  let concurrency = 8;
  const concIdx = args.indexOf("--concurrency");
  if (concIdx !== -1 && args[concIdx + 1]) {
    concurrency = parseInt(args[concIdx + 1], 10);
  }

  let maxBatches: number | undefined;
  const maxBIdx = args.indexOf("--max-batches");
  if (maxBIdx !== -1 && args[maxBIdx + 1]) {
    maxBatches = parseInt(args[maxBIdx + 1], 10);
  }

  let cursor: string | undefined;
  const cursorIdx = args.indexOf("--cursor");
  if (cursorIdx !== -1 && args[cursorIdx + 1]) {
    cursor = args[cursorIdx + 1];
  }

  let personId: string | undefined;
  const personIdx = args.indexOf("--person");
  if (personIdx !== -1 && args[personIdx + 1]) {
    personId = args[personIdx + 1];
  }

  let jobHash: string | undefined;
  const jobIdx = args.indexOf("--job");
  if (jobIdx !== -1 && args[jobIdx + 1]) {
    jobHash = args[jobIdx + 1];
  }

  console.log("============================================================");
  console.log("RADAR V4 — CONTROLLED CANONICAL RE-MATERIALIZATION (PHASE 4D-E)");
  console.log("============================================================");
  console.log(`Execution Mode : ${dryRun ? "DRY RUN (0 writes)" : "PRODUCTION WRITE"}`);
  console.log(`Continuous Mode: ${continuous ? `YES (Max batches: ${maxBatches || "Unlimited"})` : "NO (Single Batch)"}`);
  console.log(`Batch Limit    : ${limit} rows/batch`);
  console.log(`Concurrency    : ${concurrency} workers`);
  if (cursor) console.log(`Starting Cursor: ${cursor}`);
  if (personId) console.log(`Target Person  : ${personId}`);
  if (jobHash) console.log(`Target Job     : ${jobHash}`);
  console.log("------------------------------------------------------------");

  const options: RematerializeOptions = {
    dryRun,
    limit,
    cursor,
    personId,
    jobHash,
    concurrency,
    continuous,
    maxBatches,
  };

  const printBatchReport = (report: BatchReconciliationReport, batchNum?: number) => {
    console.log("\n============================================================");
    console.log(`RECONCILIATION REPORT ${batchNum ? `(Batch #${batchNum})` : ""}`);
    console.log("============================================================");
    console.log(`Batch ID       : ${report.batchId}`);
    console.log(`Duration       : ${report.performance.totalDurationMs}ms`);
    console.log(`Total Examined : ${report.examined}`);
    console.log(`Migrated       : ${report.migrated}`);
    console.log(`Already Fresh  : ${report.alreadyCanonical}`);
    console.log(`Skipped        : ${report.skipped}`);
    console.log(`Failed         : ${report.failed}`);
    console.log(`Source Missing : ${report.sourceMissing}`);
    console.log(`Profile Missing: ${report.profileMissing}`);
    console.log(`FP Mismatch    : ${report.fingerprintMismatch}`);
    console.log(`Eval Errors    : ${report.evaluationErrors}`);
    console.log(`Decision Fail  : ${report.decisionPreservationFailures}`);
    console.log(`Next Cursor    : ${report.nextCursor || "None (End of Population)"}`);
    console.log("------------------------------------------------------------");
    console.log("Verdict Distributions:");
    console.log("  Legacy Engine Verdicts   :", report.legacyVerdictDistribution);
    console.log("  New Intrinsic Verdicts   :", report.newIntrinsicVerdictDistribution);
    console.log("Quality Score Deltas:");
    console.log(
      `  Mean Old: ${report.qualityScoreDeltas.meanOld}, Mean New: ${report.qualityScoreDeltas.meanNew}, Delta: ${report.qualityScoreDeltas.meanDelta}`
    );
    console.log("Observability & Latency Breakdown:");
    console.log(`  DB Read Latency : ${report.performance.dbReadLatencyMs}ms`);
    console.log(`  Eval CPU Latency: ${report.performance.evaluationLatencyMs}ms`);
    console.log(`  DB Write Latency: ${report.performance.dbWriteLatencyMs}ms`);
    console.log(`  Avg Row Duration: ${report.performance.avgRowDurationMs}ms`);
    console.log(
      `  Workers (Config / Peak): ${report.performance.configuredConcurrency} / ${report.performance.peakConcurrency}`
    );
    console.log(`  Throughput      : ${report.performance.rowsPerSec} rows/sec`);
    console.log("============================================================\n");
  };

  if (continuous) {
    const summary = await EvaluationRematerializer.rematerializeContinuous(
      options,
      undefined,
      (report, batchIndex) => {
        printBatchReport(report, batchIndex);
      }
    );

    console.log("\n============================================================");
    console.log("CONTINUOUS RE-MATERIALIZATION SUMMARY");
    console.log("============================================================");
    console.log(`Stop Reason    : ${summary.stopReason}`);
    console.log(`Total Batches  : ${summary.totalBatches}`);
    console.log(`Total Examined : ${summary.totalExamined}`);
    console.log(`Total Migrated : ${summary.totalMigrated}`);
    console.log(`Already Fresh  : ${summary.totalAlreadyCanonical}`);
    console.log(`Total Skipped  : ${summary.totalSkipped}`);
    console.log(`Total Failed   : ${summary.totalFailed}`);
    console.log(`FP Mismatches  : ${summary.totalFingerprintMismatches}`);
    console.log(`Decision Fails : ${summary.totalDecisionPreservationFailures}`);
    console.log(`Initial Cursor : ${summary.initialCursor || "START"}`);
    console.log(`Final Cursor   : ${summary.finalCursor || "END"}`);
    console.log(`Total Duration : ${summary.totalDurationMs}ms`);
    console.log(`Overall Speed  : ${summary.overallRowsPerSec} rows/sec`);
    console.log("============================================================\n");

    if (summary.totalFailed > 0 || summary.totalDecisionPreservationFailures > 0 || summary.totalFingerprintMismatches > 0) {
      console.error("⚠️ Continuous execution terminated with anomalies. Inspect logs above.");
      process.exit(1);
    }
  } else {
    const report = await EvaluationRematerializer.rematerializeBatch(options);
    printBatchReport(report);

    if (report.failed > 0 || report.decisionPreservationFailures > 0 || report.fingerprintMismatch > 0) {
      console.error("⚠️ Anomalies detected during batch execution. Inspect failure reasons above.");
      process.exit(1);
    }
  }
}

if (process.argv[1]?.includes("rematerialize-evaluations")) {
  main().catch((err) => {
    console.error("FATAL ERROR in rematerialize-evaluations:", err);
    process.exit(1);
  });
}
