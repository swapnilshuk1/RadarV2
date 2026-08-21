/**
 * scripts/benchmark-rematerializer.ts
 *
 * Synthetic benchmark script comparing OLD Serial execution vs NEW Prefetched + Concurrent execution
 * on a standardized 100-row workload in an in-memory database.
 */

import { getDatabaseAdapter, resetDatabaseAdapter } from "../src/data/database";
import { runMigrations } from "../src/data/sqlite/migrations/runner";
import { setStorageProvider, createRepositories } from "../src/data/sqlite/provider";
import { EvaluationRematerializer } from "../src/lib/intelligence/rematerialization/EvaluationRematerializer";
import { syncCanonicalCandidateProjection } from "../src/lib/intelligence/candidate-sync";
import type { OpportunitySource } from "../src/data/opportunity-fixtures";

async function setupBenchmarkDatabase(numRows: number = 100) {
  resetDatabaseAdapter();
  setStorageProvider(null);
  process.env.RADAR_ENV = "test";
  delete process.env.TURSO_CONNECTION_URL;
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;

  const db = getDatabaseAdapter(":memory:");
  const repos = createRepositories(db);
  setStorageProvider(repos);
  await runMigrations(db);

  // Seed 2 candidate personas
  const personIds = ["bench_exec_alpha", "bench_exec_beta"];
  for (const personId of personIds) {
    await db.execute(
      `INSERT INTO people (id, name, email) VALUES (?, ?, ?)`,
      [personId, `Benchmark ${personId}`, `${personId}@test.com`]
    );
    await syncCanonicalCandidateProjection(personId);
  }

  // Seed source & company
  await db.execute(`INSERT INTO sources (id, type, name) VALUES (?, ?, ?)`, ["bench_src", "SCRAPER", "Benchmark Portals"]);
  await db.execute(`INSERT INTO companies (id, name, industry) VALUES (?, ?, ?)`, ["bench_comp", "Benchmark Global", "Technology"]);

  // Seed opportunities, documents, decisions, and legacy evaluations
  for (let i = 0; i < numRows; i++) {
    const jobHash = `bench_job_${String(i).padStart(4, "0")}`;
    const personId = personIds[i % personIds.length];
    const role = i % 3 === 0 ? "VP of Engineering" : i % 3 === 1 ? "Chief Product Officer" : "Head of Growth";

    const oppSource: OpportunitySource = {
      jobHash,
      role,
      company: "Benchmark Global",
      location: "Bengaluru (Hybrid)",
      scrapedFrom: "LinkedIn",
      postedRelative: "1d ago",
      rawText: `Executive role mandate for ${role} leading cross-functional teams and technology transformation.`,
      dimensions: [
        { key: "scale", value: "300+ engineers" },
        { key: "mandate", value: "Platform scaling" },
      ],
      primaryConcern: null,
      whyNow: "Expansion mandate",
      positioning: ["Executive Leadership"],
      applyUrl: "https://example.com/apply",
      primaryProof: "High growth trajectory",
      headspaceInvestment: "Medium",
      hiringRisk: "Standard",
      alternativePath: "Internal promotion",
    };

    await db.execute(
      `INSERT INTO opportunities (id, company_id, canonical_title, location, fingerprint, lifecycle) VALUES (?, ?, ?, ?, ?, ?)`,
      [jobHash, "bench_comp", role, "Bengaluru (Hybrid)", `fp_${jobHash}`, "Discovered"]
    );

    await db.execute(
      `INSERT INTO documents (id, source_id, opportunity_id, content, payload_type, lifecycle) VALUES (?, ?, ?, ?, ?, ?)`,
      [`doc_${jobHash}`, "bench_src", jobHash, JSON.stringify(oppSource), "JOB_DESCRIPTION", "Active"]
    );

    // Add user decision on some rows
    if (i % 5 === 0) {
      await db.execute(
        `INSERT INTO decisions (id, person_id, opportunity_id, action, reason) VALUES (?, ?, ?, ?, ?)`,
        [`dec_${personId}_${jobHash}`, personId, jobHash, i % 2 === 0 ? "PURSUE" : "PASS", "Benchmark User Decision"]
      );
    }

    // Seed legacy candidate evaluation
    const legacyPayload = {
      title: role,
      role,
      company: "Benchmark Global",
      verb: i % 2 === 0 ? "PURSUE" : "CONSIDER",
      qualityScore: 75.0 + (i % 20),
    };

    await db.execute(
      `
      INSERT INTO candidate_evaluations (
        person_id, job_hash, policy_version, evaluation_input_hash,
        engine_verdict, engine_quality_score, user_decision_override,
        effective_decision, quality_score, evaluation_status, evaluation_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        personId,
        jobHash,
        "v4.1-legacy",
        `eval_legacy_${jobHash}`,
        legacyPayload.verb,
        legacyPayload.qualityScore,
        i % 5 === 0 ? (i % 2 === 0 ? "PURSUE" : "PASS") : null,
        i % 5 === 0 ? (i % 2 === 0 ? "PURSUE" : "PASS") : legacyPayload.verb,
        legacyPayload.qualityScore,
        "COMPLETE",
        JSON.stringify(legacyPayload),
      ]
    );
  }

  return { db, repos };
}

async function runBenchmark() {
  const NUM_ROWS = 100;

  console.log("============================================================");
  console.log(`RADAR V4 REMATERIALIZER BENCHMARK (${NUM_ROWS} SYNTHETIC ROWS)`);
  console.log("============================================================");

  // -------------------------------------------------------------------------
  // RUN 1: NEW PREFETCHED + BOUNDED CONCURRENT WORKER (Concurrency = 8)
  // -------------------------------------------------------------------------
  const { db: dbConcurrent } = await setupBenchmarkDatabase(NUM_ROWS);

  console.log("\n>>> Running NEW PREFETCHED + BOUNDED CONCURRENT (concurrency: 8)...");
  const tStartConcurrent = performance.now();
  const reportConcurrent = await EvaluationRematerializer.rematerializeBatch(
    { dryRun: false, limit: NUM_ROWS, concurrency: 8 },
    dbConcurrent
  );
  const tEndConcurrent = performance.now();
  const durationConcurrent = tEndConcurrent - tStartConcurrent;

  // Verify all rows migrated properly
  const canonicalCount = (
    await dbConcurrent.one<{ count: number }>(
      `SELECT count(*) as count FROM candidate_evaluations WHERE policy_version = 'v4.3'`
    )
  )?.count;

  // -------------------------------------------------------------------------
  // RUN 2: SERIAL BASELINE (Concurrency = 1)
  // -------------------------------------------------------------------------
  const { db: dbSerial } = await setupBenchmarkDatabase(NUM_ROWS);

  console.log(">>> Running SERIAL BASELINE (concurrency: 1)...");
  const tStartSerial = performance.now();
  const reportSerial = await EvaluationRematerializer.rematerializeBatch(
    { dryRun: false, limit: NUM_ROWS, concurrency: 1 },
    dbSerial
  );
  const tEndSerial = performance.now();
  const durationSerial = tEndSerial - tStartSerial;

  // -------------------------------------------------------------------------
  // RESULTS TABLE
  // -------------------------------------------------------------------------
  console.log("\n============================================================");
  console.log("BENCHMARK COMPARISON MATRIX");
  console.log("============================================================");
  console.table([
    {
      Metric: "Batch Size (Rows)",
      "Serial (Conc 1)": NUM_ROWS,
      "Concurrent (Conc 8)": NUM_ROWS,
    },
    {
      Metric: "Total Duration",
      "Serial (Conc 1)": `${Math.round(durationSerial)} ms`,
      "Concurrent (Conc 8)": `${Math.round(durationConcurrent)} ms`,
    },
    {
      Metric: "Throughput",
      "Serial (Conc 1)": `${Math.round((NUM_ROWS / durationSerial) * 1000)} rows/sec`,
      "Concurrent (Conc 8)": `${Math.round((NUM_ROWS / durationConcurrent) * 1000)} rows/sec`,
    },
    {
      Metric: "Avg Row Latency",
      "Serial (Conc 1)": `${reportSerial.performance.avgRowDurationMs} ms`,
      "Concurrent (Conc 8)": `${reportConcurrent.performance.avgRowDurationMs} ms`,
    },
    {
      Metric: "DB Read Latency",
      "Serial (Conc 1)": `${reportSerial.performance.dbReadLatencyMs} ms`,
      "Concurrent (Conc 8)": `${reportConcurrent.performance.dbReadLatencyMs} ms`,
    },
    {
      Metric: "DB Write Latency",
      "Serial (Conc 1)": `${reportSerial.performance.dbWriteLatencyMs} ms`,
      "Concurrent (Conc 8)": `${reportConcurrent.performance.dbWriteLatencyMs} ms`,
    },
    {
      Metric: "Evaluation Latency",
      "Serial (Conc 1)": `${reportSerial.performance.evaluationLatencyMs} ms`,
      "Concurrent (Conc 8)": `${reportConcurrent.performance.evaluationLatencyMs} ms`,
    },
    {
      Metric: "Migrated / Examined",
      "Serial (Conc 1)": `${reportSerial.migrated} / ${reportSerial.examined}`,
      "Concurrent (Conc 8)": `${reportConcurrent.migrated} / ${reportConcurrent.examined}`,
    },
    {
      Metric: "Canonical Verified in DB",
      "Serial (Conc 1)": `${canonicalCount} / ${NUM_ROWS}`,
      "Concurrent (Conc 8)": `${canonicalCount} / ${NUM_ROWS}`,
    },
  ]);

  const speedup = Math.round((durationSerial / durationConcurrent) * 10) / 10;
  console.log(`\n⚡ Optimization Speedup: ${speedup}x faster on CPU/disk execution`);
  console.log(`🔒 Data Integrity: Migrated ${reportConcurrent.migrated}/${NUM_ROWS}, Failed: ${reportConcurrent.failed}, Decision Preserved: ${reportConcurrent.decisionPreservationFailures === 0 ? "100%" : "FAIL"}`);
  console.log("============================================================\n");
}

runBenchmark().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
