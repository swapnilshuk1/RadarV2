/**
 * tests/phase4d-rematerialization.test.ts
 *
 * RADAR V4 Phase 4D Test Suite: Controlled Canonical Re-Materialization
 */

import { describe, it, expect, beforeEach } from "vitest";
import { getDatabaseAdapter } from "../../src/data/database";
import { runMigrations } from "../../src/data/sqlite/migrations/runner";
import { EvaluationRematerializer } from "../../src/lib/intelligence/rematerialization/EvaluationRematerializer";
import {
  isCanonicalIntrinsicEvaluation,
  serveEvaluation,
} from "../../src/lib/intelligence/serving/EvaluationServingEngine";
import {
  computeIntrinsicFingerprint,
  classifyFingerprint,
} from "../../src/lib/intelligence/fingerprint/EvaluationFingerprint";
import { candidateProfile } from "../../src/data/candidate-profile";
import type { OpportunitySource } from "../../src/domain/entities";
import { setStorageProvider, createRepositories } from "../../src/data/sqlite/provider";
import { resetDatabaseAdapter } from "../../src/data/database";

describe("RADAR V4 Phase 4D: Controlled Canonical Re-Materialization", () => {
  let db: any;
  const personId = "person_remat_test";

  const sampleOpp1: OpportunitySource = {
    jobHash: "j-remat-001",
    role: "VP of Engineering",
    company: "Acme Cloud",
    location: "Bengaluru (Hybrid)",
    workModel: "Hybrid",
    description: "Looking for VP of Engineering to lead cloud platform architecture and scale team.",
    dimensions: [
      { key: "scale", value: "500+ engineers" },
      { key: "mandate", value: "Cloud transformation" },
    ],
  };

  const sampleOpp2: OpportunitySource = {
    jobHash: "j-remat-002",
    role: "Chief Technology Officer",
    company: "Nexus AI",
    location: "Bengaluru (Hybrid)",
    workModel: "Hybrid",
    description: "Executive CTO mandate for generative AI foundation models.",
    dimensions: [
      { key: "scope", value: "P&L $50M" },
      { key: "mandate", value: "AI Strategy" },
    ],
  };

  const sampleOpp3: OpportunitySource = {
    jobHash: "j-remat-003",
    role: "Director of Product",
    company: "ScaleFlow",
    location: "Bengaluru",
    workModel: "Hybrid",
    description: "Product director leading platform commercialization.",
    dimensions: [{ key: "mandate", value: "Product growth" }],
  };

  beforeEach(async () => {
    resetDatabaseAdapter();
    setStorageProvider(null);
    process.env.RADAR_ENV = "test";
    delete process.env.TURSO_CONNECTION_URL;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;

    db = getDatabaseAdapter(":memory:");
    setStorageProvider(createRepositories(db));
    await runMigrations(db);

    // Seed test person & candidate profile
    const repos = createRepositories(db);
    setStorageProvider(repos);
    await db.execute(
      `INSERT INTO people (id, name, email) VALUES (?, ?, ?)`,
      [personId, "Test Executive", "exec@test.com"]
    );
    const { syncCanonicalCandidateProjection } = await import("../../src/lib/intelligence/candidate-sync");
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

  describe("1. Rematerialization Correctness & Legacy -> Canonical Transition", () => {
    it("converts a legacy evaluation row into canonical v4.2-intrinsic format", async () => {
      // Seed a legacy row
      const legacyPayload = {
        title: sampleOpp1.role,
        role: sampleOpp1.role,
        company: sampleOpp1.company,
        verb: "PURSUE",
        qualityScore: 82.5,
      };

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
          sampleOpp1.jobHash,
          "v4.1-legacy",
          "eval_hash_legacy123",
          "PURSUE",
          82.5,
          "PURSUE",
          82.5,
          "COMPLETE",
          JSON.stringify(legacyPayload),
        ]
      );

      const report = await EvaluationRematerializer.rematerializeBatch(
        { dryRun: false, limit: 10, personId },
        db
      );

      expect(report.examined).toBe(1);
      expect(report.migrated).toBe(1);
      expect(report.failed).toBe(0);

      // Verify row in database
      const row = await db.one(`SELECT * FROM candidate_evaluations WHERE person_id = ? AND job_hash = ?`, [
        personId,
        sampleOpp1.jobHash,
      ]);

      expect(row).not.toBeNull();
      expect(row.policy_version).toBe("v4.3");
      expect(row.evaluation_input_hash.startsWith("eval_v4_")).toBe(true);
      expect(["PURSUE", "CONSIDER", "PASS"]).toContain(row.engine_verdict);

      const parsed = JSON.parse(row.evaluation_json);
      expect(isCanonicalIntrinsicEvaluation(parsed)).toBe(true);
      expect(parsed.schemaVersion).toBe("v4.2-intrinsic");
      expect(parsed.evaluationInputHash).toBe(row.evaluation_input_hash);
      expect(parsed.intrinsicVerdict).toBe(row.engine_verdict);
    });

    it("safely skips rows where the opportunity source does not exist without deleting them", async () => {
      await db.execute("PRAGMA foreign_keys = OFF");
      // Seed a row pointing to a non-existent job
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
          "j-missing-999",
          "v4.1-legacy",
          "eval_hash_missing999",
          "CONSIDER",
          60.0,
          "CONSIDER",
          60.0,
          "COMPLETE",
          JSON.stringify({ note: "orphan legacy row" }),
        ]
      );
      await db.execute("PRAGMA foreign_keys = ON");

      const report = await EvaluationRematerializer.rematerializeBatch(
        { dryRun: false, limit: 10, personId, jobHash: "j-missing-999" },
        db
      );

      expect(report.examined).toBe(1);
      expect(report.migrated).toBe(0);
      expect(report.skipped).toBe(1);
      expect(report.sourceMissing).toBe(1);

      // Verify row was NOT deleted
      const row = await db.one(`SELECT * FROM candidate_evaluations WHERE person_id = ? AND job_hash = ?`, [
        personId,
        "j-missing-999",
      ]);
      expect(row).not.toBeNull();
      expect(row.evaluation_input_hash).toBe("eval_hash_missing999");
    });
  });

  describe("2. Idempotency & Freshness Bypassing", () => {
    it("is strictly idempotent when executed multiple times", async () => {
      // Seed sample opp 1 legacy
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
          sampleOpp1.jobHash,
          "v4.1-legacy",
          "eval_hash_legacy123",
          "PURSUE",
          82.5,
          "PURSUE",
          82.5,
          "COMPLETE",
          JSON.stringify({ legacy: true }),
        ]
      );

      // First run: migrates
      const report1 = await EvaluationRematerializer.rematerializeBatch(
        { dryRun: false, limit: 10, personId },
        db
      );
      expect(report1.migrated).toBe(1);
      expect(report1.alreadyCanonical).toBe(0);

      // Second run: recognizes canonical fresh and skips write
      const report2 = await EvaluationRematerializer.rematerializeBatch(
        { dryRun: false, limit: 10, personId },
        db
      );
      expect(report2.migrated).toBe(0);
      expect(report2.alreadyCanonical).toBe(1);
      expect(report2.failed).toBe(0);
    });
  });

  describe("3. User Decision Preservation & Semantics", () => {
    it("strictly preserves user decisions in decisions table and user_decision_override", async () => {
      // Seed decisions: user marked sampleOpp1 as PURSUE
      await db.execute(
        `INSERT INTO decisions (id, person_id, opportunity_id, action) VALUES (?, ?, ?, ?)`,
        ["dec_1", personId, sampleOpp1.jobHash, "PURSUE"]
      );

      // Seed candidate_evaluation with legacy data and user override
      await db.execute(
        `
        INSERT INTO candidate_evaluations (
          person_id, job_hash, policy_version, evaluation_input_hash,
          engine_verdict, engine_quality_score, user_decision_override, effective_decision,
          quality_score, evaluation_status, evaluation_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          personId,
          sampleOpp1.jobHash,
          "v4.1",
          "legacy_hash",
          "PASS",
          40.0,
          "PURSUE",
          "PURSUE",
          100.0,
          "COMPLETE",
          JSON.stringify({ legacy: true }),
        ]
      );

      const report = await EvaluationRematerializer.rematerializeBatch(
        { dryRun: false, limit: 10, personId, jobHash: sampleOpp1.jobHash },
        db
      );

      expect(report.migrated).toBe(1);
      expect(report.decisionPreservationFailures).toBe(0);

      const row = await db.one(`SELECT * FROM candidate_evaluations WHERE person_id = ? AND job_hash = ?`, [
        personId,
        sampleOpp1.jobHash,
      ]);

      expect(row.user_decision_override).toBe("PURSUE");
      expect(row.effective_decision).toBe("PURSUE");
      expect(row.quality_score).toBe(100.0);
    });

    it("preserves PASS override even when intrinsic engine verdict is PURSUE", async () => {
      // User passed on sampleOpp2
      await db.execute(
        `INSERT INTO decisions (id, person_id, opportunity_id, action) VALUES (?, ?, ?, ?)`,
        ["dec_2", personId, sampleOpp2.jobHash, "PASS"]
      );

      await db.execute(
        `
        INSERT INTO candidate_evaluations (
          person_id, job_hash, policy_version, evaluation_input_hash,
          engine_verdict, engine_quality_score, user_decision_override, effective_decision,
          quality_score, evaluation_status, evaluation_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          personId,
          sampleOpp2.jobHash,
          "v4.1",
          "legacy_hash_2",
          "PURSUE",
          90.0,
          "PASS",
          "PASS",
          100.0,
          "COMPLETE",
          JSON.stringify({ legacy: true }),
        ]
      );

      const report = await EvaluationRematerializer.rematerializeBatch(
        { dryRun: false, limit: 10, personId, jobHash: sampleOpp2.jobHash },
        db
      );

      expect(report.migrated).toBe(1);
      expect(report.decisionPreservationFailures).toBe(0);

      const row = await db.one(`SELECT * FROM candidate_evaluations WHERE person_id = ? AND job_hash = ?`, [
        personId,
        sampleOpp2.jobHash,
      ]);

      expect(row.user_decision_override).toBe("PASS");
      expect(row.effective_decision).toBe("PASS");
    });
  });

  describe("4. Dry Run Mode & Zero Writes Guarantee", () => {
    it("computes full reconciliation report without modifying the database in dry-run mode", async () => {
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
          sampleOpp1.jobHash,
          "v4.1-legacy",
          "eval_hash_dryrun1",
          "CONSIDER",
          70.0,
          "CONSIDER",
          70.0,
          "COMPLETE",
          JSON.stringify({ legacy: true }),
        ]
      );

      const report = await EvaluationRematerializer.rematerializeBatch(
        { dryRun: true, limit: 10, personId },
        db
      );

      expect(report.dryRun).toBe(true);
      expect(report.examined).toBe(1);
      expect(report.migrated).toBe(1); // Would be migrated

      // Verify row in database is 100% UNCHANGED
      const row = await db.one(`SELECT * FROM candidate_evaluations WHERE person_id = ? AND job_hash = ?`, [
        personId,
        sampleOpp1.jobHash,
      ]);

      expect(row.policy_version).toBe("v4.1-legacy");
      expect(row.evaluation_input_hash).toBe("eval_hash_dryrun1");
    });
  });

  describe("5. Serving Invariant & Headspace Dynamic Calculation", () => {
    it("ensures stored intrinsic evaluation remains unchanged while serving dynamically applies headspace", async () => {
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
          sampleOpp1.jobHash,
          "v4.1-legacy",
          "eval_hash_hs_test",
          "PURSUE",
          85.0,
          "PURSUE",
          85.0,
          "COMPLETE",
          JSON.stringify({ legacy: true }),
        ]
      );

      await EvaluationRematerializer.rematerializeBatch(
        { dryRun: false, limit: 10, personId },
        db
      );

      const row = await db.one(`SELECT * FROM candidate_evaluations WHERE person_id = ? AND job_hash = ?`, [
        personId,
        sampleOpp1.jobHash,
      ]);

      const parsed = JSON.parse(row.evaluation_json);

      // Serving test A: activePursuits = 0 (unconstrained)
      const servingA = serveEvaluation(
        parsed,
        { personId, attentionWindow: 6, activePursuits: 0 },
        parsed,
        null
      );
      expect(servingA.engineRecommendation?.engineVerdict).toBe(parsed.intrinsicVerdict);
      expect(servingA.decision).toBe(parsed.intrinsicVerdict);

      // Serving test B: activePursuits = 6 (at capacity)
      const servingB = serveEvaluation(
        parsed,
        { personId, attentionWindow: 6, activePursuits: 6 },
        parsed,
        null
      );
      // Intrinsic stored payload unchanged
      expect(parsed.intrinsicVerdict).toBe(row.engine_verdict);
      // Dynamically capped if PURSUE
      if (parsed.intrinsicVerdict === "PURSUE") {
        expect(servingB.decision).toBe("CONSIDER");
        expect(servingB.engineRecommendation?.headspaceState).toBe("DEFERRED_HEADSPACE");
      }

      // Verify stored row was NOT mutated by serving
      expect(parsed.intrinsicVerdict).toBe(row.engine_verdict);
    });
  });

  describe("6. Batching & Cursor Pagination", () => {
    it("paginates correctly using cursor and limit", async () => {
      // Seed 3 legacy evaluations
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
            "v4.1",
            `legacy_${opp.jobHash}`,
            "CONSIDER",
            70.0,
            "CONSIDER",
            70.0,
            "COMPLETE",
            JSON.stringify({ legacy: true }),
          ]
        );
      }

      // Batch 1: limit 2
      const batch1 = await EvaluationRematerializer.rematerializeBatch(
        { dryRun: false, limit: 2, personId },
        db
      );

      expect(batch1.examined).toBe(2);
      expect(batch1.migrated).toBe(2);
      expect(batch1.nextCursor).toBe(sampleOpp2.jobHash);

      // Batch 2: resume from cursor
      const batch2 = await EvaluationRematerializer.rematerializeBatch(
        { dryRun: false, limit: 2, personId, cursor: batch1.nextCursor || undefined },
        db
      );

      expect(batch2.examined).toBe(1);
      expect(batch2.migrated).toBe(1);
      expect(batch2.nextCursor).toBeNull();
    });
  });
});
