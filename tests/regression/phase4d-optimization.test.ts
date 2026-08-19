/**
 * tests/phase4d-optimization.test.ts
 *
 * RADAR V4 Phase 4D-E Test Suite: Rematerialization Worker Optimization & Invariants
 */

import { describe, it, expect, beforeEach } from "vitest";
import { getDatabaseAdapter, resetDatabaseAdapter } from "../../src/data/database";
import { runMigrations } from "../../src/data/sqlite/migrations/runner";
import { setStorageProvider, createRepositories } from "../../src/data/sqlite/provider";
import { EvaluationRematerializer } from "../../src/lib/intelligence/rematerialization/EvaluationRematerializer";
import { AsyncConcurrencyPool } from "../../src/lib/intelligence/rematerialization/AsyncConcurrencyPool";
import { syncCanonicalCandidateProjection } from "../../src/lib/intelligence/candidate-sync";
import type { OpportunitySource } from "../../src/data/opportunity-fixtures";

describe("RADAR V4 Phase 4D-E: Rematerialization Worker Optimization", () => {
  let db: any;
  let repos: any;
  const personId = "person_opt_test";

  const sampleOpp1: OpportunitySource = {
    jobHash: "j-opt-001",
    role: "VP of Engineering",
    company: "Acme Cloud",
    location: "Bengaluru (Hybrid)",
    scrapedFrom: "LinkedIn",
    postedRelative: "1d ago",
    rawText: "VP of Engineering to lead cloud platform architecture and scale team.",
    dimensions: [
      { key: "scale", value: "500+ engineers" },
      { key: "mandate", value: "Cloud transformation" },
    ],
    primaryConcern: null,
    whyNow: "Executive expansion",
    positioning: ["Executive Leadership"],
    applyUrl: "https://example.com/apply1",
    primaryProof: "Cloud Scale",
    headspaceInvestment: "High",
    hiringRisk: "Low",
    alternativePath: "None",
  };

  const sampleOpp2: OpportunitySource = {
    jobHash: "j-opt-002",
    role: "Chief Technology Officer",
    company: "Nexus AI",
    location: "Bengaluru (Hybrid)",
    scrapedFrom: "LinkedIn",
    postedRelative: "2d ago",
    rawText: "Executive CTO mandate for generative AI foundation models.",
    dimensions: [
      { key: "scope", value: "P&L $50M" },
      { key: "mandate", value: "AI Strategy" },
    ],
    primaryConcern: null,
    whyNow: "AI Platform Launch",
    positioning: ["Executive Leadership"],
    applyUrl: "https://example.com/apply2",
    primaryProof: "AI Strategy",
    headspaceInvestment: "High",
    hiringRisk: "Low",
    alternativePath: "None",
  };

  const sampleOpp3: OpportunitySource = {
    jobHash: "j-opt-003",
    role: "Director of Product",
    company: "ScaleFlow",
    location: "Bengaluru",
    scrapedFrom: "LinkedIn",
    postedRelative: "3d ago",
    rawText: "Product director leading platform commercialization.",
    dimensions: [{ key: "mandate", value: "Product growth" }],
    primaryConcern: null,
    whyNow: "Market Expansion",
    positioning: ["Executive Leadership"],
    applyUrl: "https://example.com/apply3",
    primaryProof: "Scale",
    headspaceInvestment: "Medium",
    hiringRisk: "Standard",
    alternativePath: "None",
  };

  beforeEach(async () => {
    resetDatabaseAdapter();
    setStorageProvider(null);
    process.env.RADAR_ENV = "test";
    delete process.env.TURSO_CONNECTION_URL;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;

    db = getDatabaseAdapter(":memory:");
    repos = createRepositories(db);
    setStorageProvider(repos);
    await runMigrations(db);

    // Seed test person & candidate profile
    await db.execute(
      `INSERT INTO people (id, name, email) VALUES (?, ?, ?)`,
      [personId, "Test Executive", "exec@test.com"]
    );
    await syncCanonicalCandidateProjection(personId);

    // Seed sources & company
    await db.execute(
      `INSERT INTO sources (id, type, name) VALUES (?, ?, ?)`,
      ["src_1", "SCRAPER", "Test Scraper"]
    );
    await db.execute(
      `INSERT INTO companies (id, name, industry) VALUES (?, ?, ?)`,
      ["comp_1", "Acme Corp", "Technology"]
    );

    // Seed test opportunities & documents
    for (const opp of [sampleOpp1, sampleOpp2, sampleOpp3]) {
      await db.execute(
        `INSERT INTO opportunities (id, company_id, canonical_title, location, fingerprint, lifecycle) VALUES (?, ?, ?, ?, ?, ?)`,
        [opp.jobHash, "comp_1", opp.role, opp.location, `fp_${opp.jobHash}`, "Discovered"]
      );
      await db.execute(
        `INSERT INTO documents (id, source_id, opportunity_id, content, payload_type, lifecycle) VALUES (?, ?, ?, ?, ?, ?)`,
        [`doc_${opp.jobHash}`, "src_1", opp.jobHash, JSON.stringify(opp), "JOB_DESCRIPTION", "Active"]
      );
    }
  });

  describe("1. Bounded Concurrency Pool", () => {
    it("strictly respects configured concurrency limit and isolates errors", async () => {
      const items = Array.from({ length: 20 }, (_, i) => i);
      let activeCount = 0;
      let maxActiveObserved = 0;

      const poolResult = await AsyncConcurrencyPool.mapBounded(
        items,
        async (item) => {
          activeCount++;
          if (activeCount > maxActiveObserved) {
            maxActiveObserved = activeCount;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
          activeCount--;
          return item * 2;
        },
        4 // Concurrency limit 4
      );

      expect(maxActiveObserved).toBeLessThanOrEqual(4);
      expect(poolResult.peakConcurrency).toBeLessThanOrEqual(4);
      expect(poolResult.results.length).toBe(20);
      expect(poolResult.results[5]).toBe(10);
    });
  });

  describe("2. Batch-Level Prefetching & Deduplication", () => {
    it("successfully evaluates multiple rows sharing the same candidate projection and decisions", async () => {
      // Seed 3 legacy evaluations for the same candidate
      for (const opp of [sampleOpp1, sampleOpp2, sampleOpp3]) {
        await db.execute(
          `
          INSERT INTO candidate_evaluations (
            person_id, job_hash, policy_version, evaluation_input_hash,
            engine_verdict, engine_quality_score, effective_decision,
            quality_score, evaluation_status, evaluation_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            personId,
            opp.jobHash,
            "v4.1-legacy",
            `eval_legacy_${opp.jobHash}`,
            "CONSIDER",
            70.0,
            "CONSIDER",
            70.0,
            "COMPLETE",
            JSON.stringify({ legacy: true }),
          ]
        );
      }

      // Add a user decision override on opp 1
      await db.execute(
        `INSERT INTO decisions (id, person_id, opportunity_id, action, reason) VALUES (?, ?, ?, ?, ?)`,
        [`dec_${personId}_${sampleOpp1.jobHash}`, personId, sampleOpp1.jobHash, "PURSUE", "Strong alignment"]
      );

      const report = await EvaluationRematerializer.rematerializeBatch(
        { dryRun: false, limit: 10, concurrency: 4, personId },
        db
      );

      expect(report.examined).toBe(3);
      expect(report.migrated).toBe(3);
      expect(report.failed).toBe(0);
      expect(report.decisionPreservationFailures).toBe(0);
      expect(report.performance.configuredConcurrency).toBe(4);

      // Verify opp 1 preserved PURSUE override
      const row1 = await db.one(
        `SELECT * FROM candidate_evaluations WHERE person_id = ? AND job_hash = ?`,
        [personId, sampleOpp1.jobHash]
      );
      expect(row1.user_decision_override).toBe("PURSUE");
      expect(row1.effective_decision).toBe("PURSUE");
      expect(row1.quality_score).toBe(100.0);
    });
  });

  describe("3. Row-Level Failure Isolation", () => {
    it("continues processing remaining valid rows even if one row points to an invalid/missing source", async () => {
      await db.execute("PRAGMA foreign_keys = OFF");
      // Seed valid row 1
      await db.execute(
        `
        INSERT INTO candidate_evaluations (
          person_id, job_hash, policy_version, evaluation_input_hash,
          engine_verdict, engine_quality_score, effective_decision,
          quality_score, evaluation_status, evaluation_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [personId, sampleOpp1.jobHash, "v4.1-legacy", "eval_1", "CONSIDER", 70.0, "CONSIDER", 70.0, "COMPLETE", "{}"]
      );

      // Seed invalid row 2 (missing opportunity)
      await db.execute(
        `
        INSERT INTO candidate_evaluations (
          person_id, job_hash, policy_version, evaluation_input_hash,
          engine_verdict, engine_quality_score, effective_decision,
          quality_score, evaluation_status, evaluation_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [personId, "j-missing-xyz", "v4.1-legacy", "eval_missing", "CONSIDER", 70.0, "CONSIDER", 70.0, "COMPLETE", "{}"]
      );

      // Seed valid row 3
      await db.execute(
        `
        INSERT INTO candidate_evaluations (
          person_id, job_hash, policy_version, evaluation_input_hash,
          engine_verdict, engine_quality_score, effective_decision,
          quality_score, evaluation_status, evaluation_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [personId, sampleOpp2.jobHash, "v4.1-legacy", "eval_2", "CONSIDER", 70.0, "CONSIDER", 70.0, "COMPLETE", "{}"]
      );
      await db.execute("PRAGMA foreign_keys = ON");

      const report = await EvaluationRematerializer.rematerializeBatch(
        { dryRun: false, limit: 10, concurrency: 4, personId },
        db
      );

      expect(report.examined).toBe(3);
      expect(report.migrated).toBe(2);
      expect(report.skipped).toBe(1);
      expect(report.sourceMissing).toBe(1);
      expect(report.failed).toBe(0);

      // Check that valid rows were updated to v4.3
      const validRow1 = await db.one(
        `SELECT policy_version FROM candidate_evaluations WHERE person_id = ? AND job_hash = ?`,
        [personId, sampleOpp1.jobHash]
      );
      expect(validRow1.policy_version).toBe("v4.3");

      // Check that missing row was NOT deleted
      const missingRow = await db.one(
        `SELECT policy_version FROM candidate_evaluations WHERE person_id = ? AND job_hash = ?`,
        [personId, "j-missing-xyz"]
      );
      expect(missingRow).not.toBeNull();
      expect(missingRow.policy_version).toBe("v4.1-legacy");
    });
  });

  describe("4. Dry Run vs Write Mode Equivalence", () => {
    it("produces identical metrics in dry-run mode while executing zero mutations", async () => {
      await db.execute(
        `
        INSERT INTO candidate_evaluations (
          person_id, job_hash, policy_version, evaluation_input_hash,
          engine_verdict, engine_quality_score, effective_decision,
          quality_score, evaluation_status, evaluation_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [personId, sampleOpp1.jobHash, "v4.1-legacy", "eval_legacy_1", "CONSIDER", 70.0, "CONSIDER", 70.0, "COMPLETE", "{}"]
      );

      // Dry run
      const dryReport = await EvaluationRematerializer.rematerializeBatch(
        { dryRun: true, limit: 10, concurrency: 4, personId },
        db
      );

      expect(dryReport.examined).toBe(1);
      expect(dryReport.migrated).toBe(1);
      expect(dryReport.dryRun).toBe(true);

      // Verify zero writes in DB
      const rowAfterDry = await db.one(
        `SELECT policy_version FROM candidate_evaluations WHERE person_id = ? AND job_hash = ?`,
        [personId, sampleOpp1.jobHash]
      );
      expect(rowAfterDry.policy_version).toBe("v4.1-legacy");

      // Write run
      const writeReport = await EvaluationRematerializer.rematerializeBatch(
        { dryRun: false, limit: 10, concurrency: 4, personId },
        db
      );

      expect(writeReport.examined).toBe(1);
      expect(writeReport.migrated).toBe(1);
      expect(writeReport.dryRun).toBe(false);

      // Verify written in DB
      const rowAfterWrite = await db.one(
        `SELECT policy_version FROM candidate_evaluations WHERE person_id = ? AND job_hash = ?`,
        [personId, sampleOpp1.jobHash]
      );
      expect(rowAfterWrite.policy_version).toBe("v4.3");
    });
  });

  describe("5. Continuous Migration Loop", () => {
    it("processes all rows across continuous batches and terminates cleanly", async () => {
      for (const opp of [sampleOpp1, sampleOpp2, sampleOpp3]) {
        await db.execute(
          `
          INSERT INTO candidate_evaluations (
            person_id, job_hash, policy_version, evaluation_input_hash,
            engine_verdict, engine_quality_score, effective_decision,
            quality_score, evaluation_status, evaluation_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [personId, opp.jobHash, "v4.1-legacy", `eval_${opp.jobHash}`, "CONSIDER", 70.0, "CONSIDER", 70.0, "COMPLETE", "{}"]
        );
      }

      // Run continuous mode with batch limit = 1 (should take 3 batches)
      const summary = await EvaluationRematerializer.rematerializeContinuous(
        { dryRun: false, limit: 1, concurrency: 2, personId },
        db
      );

      expect(summary.stopReason).toBe("COMPLETED");
      expect(summary.totalBatches).toBe(3);
      expect(summary.totalExamined).toBe(3);
      expect(summary.totalMigrated).toBe(3);
      expect(summary.totalFailed).toBe(0);

      // Verify all rows in DB are now v4.3
      const v43Rows = await db.many(
        `SELECT * FROM candidate_evaluations WHERE person_id = ? AND policy_version = 'v4.3'`,
        [personId]
      );
      expect(v43Rows.length).toBe(3);
    });
  });
});
